"""Receipt OCR via Gemini Flash with strict JSON output."""
import json
import logging
import os
import re
import time
from datetime import date, datetime

from dotenv import load_dotenv
import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel

from typing import Literal

import language
from models import CATEGORIES, ParsedReceipt, Tip

load_dotenv()

DEFAULT_MODEL = "gemini-flash-latest"

class _ReceiptSchema(BaseModel):
    """Schema Gemini is forced to follow (constrained JSON decoding)."""

    is_receipt: bool
    amount: float
    merchant_name: str
    category: Literal[*CATEGORIES]  # type: ignore[valid-type]
    transaction_date: str


PROMPT = f"""You are a receipt parser. The image may be a paper receipt photo, a payment slip, or a screenshot of a payment confirmation / order / invoice. Return ONLY a JSON object with exactly these keys:
- "is_receipt": true only if the image shows a completed payment, receipt, invoice or payment slip with a total; false for anything else (chats, photos, home screens, etc.). If false, fill the other fields with placeholders.
- "amount": the final total paid (including tax and tip) as a number, no currency symbol
- "merchant_name": the store or restaurant name
- "category": exactly one of {CATEGORIES}
- "transaction_date": the purchase date formatted YYYY-MM-DD

If the date is missing or unreadable, use today's date: {{today}}. If the category is unclear, use "Other"."""


class AIServiceError(Exception):
    """Raised when the receipt cannot be parsed."""


class NotAReceiptError(AIServiceError):
    """The image is valid but does not show a receipt / payment slip."""


def _client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise AIServiceError("GEMINI_API_KEY is not set. Add it to backend/.env")
    return genai.Client(api_key=api_key)


# ---------- Resilient Gemini calls: retries, model fallback, friendly errors ----------

log = logging.getLogger("finance.ai")

# Tried in order after GEMINI_MODEL. Model names change over time; unknown ones just 404 and are skipped.
DEFAULT_FALLBACK_MODELS = "gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.1-flash-lite"
ATTEMPTS_PER_MODEL = 2  # first try + one retry
RETRY_PAUSE_SECONDS = 1.5
BREAKER_SECONDS = 30  # after a model keeps failing transiently, skip it briefly
UNAVAILABLE_SECONDS = 24 * 3600  # "model no longer available to new users"
DEADLINE_SECONDS = 45  # never keep the phone waiting longer than this across all attempts

_sleep = time.sleep  # patched in tests
_cooldown: dict[str, tuple[float, str]] = {}  # model -> (unix time until which it is skipped, why)


def _model_chain() -> list[str]:
    primary = (os.getenv("GEMINI_MODEL") or DEFAULT_MODEL).strip()
    fallbacks = os.getenv("GEMINI_FALLBACK_MODELS", DEFAULT_FALLBACK_MODELS)
    chain: list[str] = []
    for name in [primary, *fallbacks.split(",")]:
        name = name.strip()
        if name and name not in chain:
            chain.append(name)
    return chain


def _retry_delay_seconds(text: str) -> float | None:
    match = re.search(r"retryDelay['\"]?\s*:\s*['\"](\d+(?:\.\d+)?)s", text)
    return float(match.group(1)) if match else None


def _classify(exc: Exception) -> tuple[str, float | None]:
    """-> (kind, seconds). kind: transient | rate_limit | daily_quota | model_unavailable | network | fatal"""
    text = str(exc)
    if isinstance(exc, genai_errors.APIError):
        code = getattr(exc, "code", None)
        if code == 429 or "RESOURCE_EXHAUSTED" in text[:120]:
            if "PerDay" in text:
                return "daily_quota", _retry_delay_seconds(text) or 3600.0
            return "rate_limit", min(_retry_delay_seconds(text) or 5.0, 10.0)
        if code in (500, 502, 503, 504) or "UNAVAILABLE" in text[:120]:
            return "transient", None
        if code == 404:
            return "model_unavailable", None
        return "fatal", None  # 400 bad request, 401/403 bad key, ...
    if isinstance(exc, (httpx.TransportError, TimeoutError, ConnectionError)):
        return "network", None
    return "fatal", None


def _cool(model: str, seconds: float, why: str) -> None:
    _cooldown[model] = (time.time() + seconds, why)


def _friendly_failure(last: Exception | None, kinds: set[str], quota_resets_in: float | None) -> str:
    detail = re.sub(r"\s+", " ", str(last))[:140] if last else "no model available"
    if kinds == {"daily_quota"}:
        wait = int(quota_resets_in or 0)
        when = f"about {wait // 3600}h {wait % 3600 // 60}m" if wait >= 3600 else f"about {max(wait // 60, 1)} min"
        return f"Gemini's free daily limit is used up on every model I can try; it resets in {when}. ({detail})"
    if "model_unavailable" in kinds and len(kinds) == 1:
        return f"None of the configured Gemini models is available to this key. Check GEMINI_MODEL. ({detail})"
    return f"Gemini is busy right now. Please try again in a minute. ({detail})"


def _generate_content(client: genai.Client, contents, config):
    """generate_content with retries and fallback models.

    * 503/500/network blips: one quick retry, then the next model (and the failing model is skipped for 30 s).
    * 429 per-minute: short pause + retry. 429 per-day: that model is skipped until its quota resets.
    * 404 (model not offered to this key): skipped for a day.
    * 400/401/403 and anything unexpected: raised immediately, because another model won't help.
    """
    deadline = time.monotonic() + DEADLINE_SECONDS
    last: Exception | None = None
    kinds: set[str] = set()
    chain = _model_chain()
    now = time.time()
    available = [m for m in chain if _cooldown.get(m, (0.0, ""))[0] <= now]

    for model in available:
        for attempt in range(ATTEMPTS_PER_MODEL):
            try:
                response = client.models.generate_content(model=model, contents=contents, config=config)
                if model != chain[0]:
                    log.info("Gemini fallback model in use: %s", model)
                return response
            except Exception as exc:  # classified below
                kind, seconds = _classify(exc)
                last = exc
                if kind == "fatal":
                    raise AIServiceError(f"Gemini request failed: {exc}") from exc
                kinds.add(kind)
                if kind == "network":  # no internet / DNS / timeout: another model can't help, so don't cycle through them
                    if attempt + 1 < ATTEMPTS_PER_MODEL and time.monotonic() + RETRY_PAUSE_SECONDS < deadline:
                        _sleep(RETRY_PAUSE_SECONDS)
                        continue
                    detail = re.sub(r"\s+", " ", str(exc))[:140]
                    raise AIServiceError(f"Can't reach Gemini. Check the backend's internet connection. ({detail})") from exc
                if kind == "daily_quota":
                    _cool(model, seconds or 3600.0, "daily_quota")
                    break
                if kind == "model_unavailable":
                    _cool(model, UNAVAILABLE_SECONDS, "model_unavailable")
                    break
                pause = seconds if kind == "rate_limit" and seconds else RETRY_PAUSE_SECONDS
                if attempt + 1 < ATTEMPTS_PER_MODEL and time.monotonic() + pause < deadline:
                    log.warning("Gemini %s on %s, retrying in %.1fs", kind, model, pause)
                    _sleep(pause)
                    continue
                _cool(model, BREAKER_SECONDS, "busy")
                break
        if time.monotonic() >= deadline:
            break

    if not available:  # every model was already cooling down, so nothing was tried in this call
        kinds = {_cooldown[m][1] for m in chain if m in _cooldown}
    now = time.time()
    quota_waits = [until - now for until, why in (_cooldown.get(m, (0.0, "")) for m in chain) if why == "daily_quota" and until > now]
    raise AIServiceError(_friendly_failure(last, kinds, min(quota_waits) if quota_waits else None))


_MD_BOLD = re.compile(r"(\*\*|__)(.+?)\1", re.DOTALL)
_MD_ITALIC = re.compile(r"(?<![\*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\*\w])")


def strip_markdown(text: str) -> str:
    """The app shows plain text, so turn markdown the model sometimes emits anyway into plain text."""
    text = _MD_BOLD.sub(r"\2", text)
    text = _MD_ITALIC.sub(r"\1", text)
    text = re.sub(r"^\s*#{1,6}\s+", "", text, flags=re.MULTILINE)  # headings
    text = re.sub(r"^(\s*)[*\-]\s+", r"\1• ", text, flags=re.MULTILINE)  # bullets
    return text.replace("`", "").strip()


def _normalize_date(raw: object) -> str:
    text = str(raw or "").strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%d/%m/%Y", "%b %d, %Y", "%d %b %Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return date.today().isoformat()


def _normalize_category(raw: object) -> str:
    text = str(raw or "").strip().lower()
    for cat in CATEGORIES:
        if cat.lower() == text:
            return cat
    return "Other"


def _parse_amount(raw: object) -> float:
    if isinstance(raw, (int, float)):
        return round(float(raw), 2)
    cleaned = re.sub(r"[^0-9.\-]", "", str(raw or ""))
    try:
        return round(float(cleaned), 2)
    except ValueError as exc:
        raise AIServiceError("Could not read a total amount from the receipt") from exc


def extract_receipt(image_bytes: bytes, mime_type: str) -> ParsedReceipt:
    client = _client()
    prompt = PROMPT.format(today=date.today().isoformat())
    response = _generate_content(
        client,
        contents=[types.Part.from_bytes(data=image_bytes, mime_type=mime_type), prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_ReceiptSchema,
            temperature=0,
        ),
    )
    try:
        payload = json.loads(response.text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise AIServiceError("AI returned malformed JSON") from exc

    if not isinstance(payload, dict):
        raise AIServiceError("AI returned an unexpected response shape")

    if payload.get("is_receipt") is False:
        raise NotAReceiptError("This image does not look like a receipt")

    merchant = str(payload.get("merchant_name") or "").strip() or "Unknown merchant"
    return ParsedReceipt(
        amount=_parse_amount(payload.get("amount")),
        merchant_name=merchant,
        category=_normalize_category(payload.get("category")),
        transaction_date=_normalize_date(payload.get("transaction_date")),
    )


# ---------- Financial advice & chat ----------


class _TipSchema(BaseModel):
    title: str
    body: str
    severity: Literal["info", "warning", "positive"]
    category: str  # one of the spending categories, or "" when the tip is general


class _AdviceSchema(BaseModel):
    headline: str
    tips: list[_TipSchema]


ADVICE_PROMPT = """You are a warm, concise personal finance coach reviewing one person's spending in a budgeting app. Amounts are in {currency}.

You are given (1) STATS: their real finances computed from the database (this month, last month, 6-month history, weekly trend, merchants, budgets, affordability, latest slips) and (2) FACTS, rule-based observations already verified against the stats. You already know their history; never ask them to list purchases.
Write a monthly review:
- "headline": one friendly sentence (max 90 chars) capturing the overall picture.
- "tips": 3 to 5 items ordered by importance. Each has "title" (max 45 chars), "body" (1-2 sentences, max 220 chars, specific and actionable), "severity" ("warning" for overspending/budget risks, "positive" for good habits, "info" otherwise) and "category" (one of {categories}, or "" if general).
Rules: use ONLY numbers present in STATS/FACTS, never invent amounts; use the history to spot trends (e.g. this month vs previous months); compare categories such as food vs games vs transport when useful; mention budget limits when they are near or exceeded; be supportive, not preachy; no markdown.

STATS:
{stats}

FACTS:
{facts}
"""

CHAT_SYSTEM = """You are a friendly personal finance assistant inside the user's private expense tracker. You ALREADY know their finances: the DATA below is read live from their database (amounts in {currency}; confirmed transactions only) and was updated the moment their latest slip was saved. Never ask them to tell you what they bought or spent.

How to answer:
- Today is {today}. "This month" = {month}. "Last week" / "this week" are rolling 7-day windows ending today unless the user says otherwise.
- For any specific period, category or merchant that DATA does not already show exactly, CALL the tools get_spending / list_transactions and use their numbers. Convert phrases like "last week", "in August", "last month" into explicit YYYY-MM-DD dates yourself. Compare periods by calling the tool once per period. Never state a total, a count or "no spending" for a period unless it is shown exactly in DATA or returned by a tool; if a tool returns an error, say you could not look it up right now and do not guess a number.
- "Can I afford X?": use DATA.affordability (budget remaining overall and per category, safe daily spend, days left). Give a clear yes / yes-but / no, show the arithmetic briefly (price vs. remaining budget), and mention the effect on the rest of the month. If no budget is set, say so and judge from income minus spending and the monthly trend instead.
- Be concise (about 130 words or fewer in English), concrete numbers, supportive and non-judgmental. You are not a licensed financial advisor; no investment, tax or legal advice. Politely decline unrelated requests. If data is missing say so briefly.
- Output PLAIN TEXT only: never use markdown (no **bold**, no *italics*, no # headings, no backticks, no tables). For a list put one item per line starting with "• ".
- Reply in the language the user writes in (see LANGUAGE below). Facts and numbers must be identical whatever the language.

{language_rules}

{language_now}

DATA:
{context}
"""


def generate_advice(stats: dict, facts: list[Tip]) -> tuple[str, list[Tip]]:
    """Personalised monthly review. Raises AIServiceError on any failure (callers fall back to rules)."""
    client = _client()
    prompt = ADVICE_PROMPT.format(
        currency=stats.get("currency", "THB"),
        categories=CATEGORIES,
        stats=json.dumps(stats, default=str, ensure_ascii=False),
        facts="\n".join(f"- [{t.severity}] {t.title}: {t.body}" for t in facts) or "- none",
    )
    response = _generate_content(
        client,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json", response_schema=_AdviceSchema, temperature=0.4
        ),
    )
    try:
        payload = json.loads(response.text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise AIServiceError("AI returned malformed JSON") from exc

    raw_tips = payload.get("tips") if isinstance(payload, dict) else None
    headline = str(payload.get("headline", "")).strip() if isinstance(payload, dict) else ""
    if not headline or not isinstance(raw_tips, list) or not raw_tips:
        raise AIServiceError("AI returned an empty review")

    tips = []
    for item in raw_tips[:6]:
        if not isinstance(item, dict) or not item.get("title") or not item.get("body"):
            continue
        category = str(item.get("category") or "").strip()
        severity = item.get("severity") if item.get("severity") in ("info", "warning", "positive") else "info"
        tips.append(
            Tip(
                title=language.westernize_digits(strip_markdown(str(item["title"])))[:80],
                body=language.westernize_digits(strip_markdown(str(item["body"])))[:400],
                severity=severity,
                category=_normalize_category(category) if category else None,
            )
        )
    if not tips:
        raise AIServiceError("AI returned no usable tips")
    return language.westernize_digits(strip_markdown(headline))[:140], tips


def chat(message: str, history: list[dict], context: dict, tools: list | None = None) -> str:
    """Answer a question about the user's own money. ``context`` is injected into the system prompt and
    ``tools`` are query callables Gemini may call (executed automatically against SQLite).
    Raises AIServiceError on failure."""
    client = _client()
    prior = history[-10:]
    contents = [
        types.Content(role="user" if m["role"] == "user" else "model", parts=[types.Part(text=m["content"])])
        for m in prior
    ]
    contents.append(types.Content(role="user", parts=[types.Part(text=message)]))
    response = _generate_content(
        client,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=CHAT_SYSTEM.format(
                language_rules=language.system_rules(message, prior),
                language_now=language.reply_directive(message, prior),
                currency=context.get("currency", "THB"),
                today=context.get("today"),
                month=context.get("month"),
                context=json.dumps(context, default=str, ensure_ascii=False),
            ),
            tools=tools or None,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(maximum_remote_calls=6),
            temperature=0.3,
            max_output_tokens=language.max_output_tokens(message, prior),
        ),
    )
    text = language.westernize_digits(strip_markdown(response.text or ""))
    if not text:
        raise AIServiceError("The assistant returned an empty answer")
    return text
