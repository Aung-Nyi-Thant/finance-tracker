"""Language handling for the AI assistant: detect Burmese input and tell Gemini exactly how to answer.

Detection is deterministic (Unicode ranges), so the reply language never depends on the model guessing.
All financial numbers still come from the database / query tools; only the *conversation* is localised.
"""
from __future__ import annotations

import re

# Myanmar, Myanmar Extended-A and Extended-B blocks.
_MYANMAR = re.compile(r"[က-႟ꩠ-ꩿꧠ-꧿]")
# Code points that appear in Zawgyi (the legacy, non-Unicode encoding) but almost never in Unicode Burmese,
# or an e-vowel stranded at a word start / after a virama or asat, which Unicode never produces.
_ZAWGYI_HINT = re.compile(r"[ဳဴၠ-႗]|(?:^|[\s္်၊။])ေ")
_LATIN = re.compile(r"[A-Za-z]")
_BURMESE_DIGITS = str.maketrans("၀၁၂၃၄၅၆၇၈၉", "0123456789")


def westernize_digits(text: str) -> str:
    """Burmese digits -> 0-9, so every number in a reply matches the amounts the app shows."""
    return text.translate(_BURMESE_DIGITS)


def _is_burmese(text: str) -> bool:
    mm = len(_MYANMAR.findall(text))
    if mm == 0:
        return False
    letters = sum(1 for c in text if c.isalpha() or _MYANMAR.match(c))
    return mm >= 3 or mm / max(letters, 1) >= 0.3


def _has_words(text: str) -> bool:
    return bool(_LATIN.search(text)) or bool(_MYANMAR.search(text))


def detect_language(message: str, history: list[dict] | None = None) -> str:
    """"my" when the user is writing Burmese, otherwise "en" (meaning: mirror whatever they wrote).

    A message with no words at all ("5000?", "👍") inherits the language of the user's previous message,
    so a Burmese conversation doesn't flip to English on a short follow-up.
    """
    if _is_burmese(message):
        return "my"
    if _has_words(message):
        return "en"
    for past in reversed(history or []):
        if past.get("role") == "user" and _has_words(past.get("content", "")):
            return "my" if _is_burmese(past["content"]) else "en"
    return "en"


def looks_like_zawgyi(text: str) -> bool:
    return bool(_ZAWGYI_HINT.search(text))


BURMESE_RULES = """LANGUAGE (Burmese / မြန်မာဘာသာ):
- Understand Burmese in Myanmar Unicode AND in Zawgyi, and mixed Burmese-English messages (merchant and brand names are usually English). Understand questions about money, spending, budgets, saving and affordability asked in Burmese exactly as if they were asked in English.
- When the user writes in Burmese, answer ENTIRELY in natural, polite, clear Burmese using Myanmar Unicode (never romanised Burmese, never Zawgyi). Use the friendly spoken-polite register ("...ပါတယ်", "...ပါ", "...မယ်", "...လို့ရပါတယ်"). Do NOT use the formal literary register: never end sentences with "...သည်", "...ပါသည်", "...မည်", "...ပါတော့သည်", "...သဖြင့်" or "...၍". Do NOT use gendered address particles such as ခင်ဗျာ or ရှင်, because the user's gender is unknown; address them directly without a pronoun when possible. Keep English only for merchant names and the currency symbol.
- Accuracy first: every figure comes from DATA or the tools, never from guesswork. Keep amounts, percentages and dates in Western digits exactly as the app shows them (e.g. ฿1,299.00, 87%, 2026-10-06). Do not convert or re-round them.
- Read Burmese digits as numbers: ၀=0 ၁=1 ၂=2 ၃=3 ၄=4 ၅=5 ၆=6 ၇=7 ၈=8 ၉=9.
- Burmese quantity words: ရာ=100, ထောင်=1,000, သောင်း=10,000, သိန်း=100,000, သန်း=1,000,000 (e.g. "၂ သောင်း ၅ ထောင်" = 25,000; "၃ သိန်း" = 300,000; "၁၅၀၀ ဘတ်" = 1,500 baht). Currency words: ဘတ် = baht (THB), ကျပ် = kyat (MMK), ဒေါ်လာ = dollar. If the user names an amount without a currency, assume the app's currency.
- Time words: ဒီနေ့/ယနေ့ = today, မနေ့က = yesterday, ဒီအပတ် = this week, ပြီးခဲ့တဲ့အပတ် = last week, ဒီလ = this month, ပြီးခဲ့တဲ့လ = last month, ဒီနှစ် = this year. Turn them into explicit YYYY-MM-DD dates before calling a tool.
- Tool arguments are ALWAYS English: dates as YYYY-MM-DD and category names exactly one of Food, Groceries, Transport, Shopping, Entertainment, Bills, Health, Income, Other.
- Preferred Burmese terms: spending = အသုံးစရိတ်, budget = ဘတ်ဂျက်, income = ဝင်ငွေ, savings = စုငွေ, remaining = ကျန်ငွေ, over budget = ဘတ်ဂျက်ကျော်, Food = အစားအသောက်, Groceries = ကုန်စုံ, Transport = ခရီးသွားလာစရိတ်, Shopping = ဈေးဝယ်စရိတ်, Entertainment/Games = ဂိမ်းနှင့် ဖျော်ဖြေရေး, Bills/Utilities = မီး၊ ရေ၊ အင်တာနက် စသည့် ဝန်ဆောင်ခများ, Health = ကျန်းမာရေး, Other = အခြား.
- Length in Burmese: about 4 to 7 short sentences. Same advice rules apply: supportive, non-judgmental, not licensed financial advice."""

_BURMESE_NOW = (
    "LANGUAGE FOR THIS REPLY: Burmese. The user's latest message is in Burmese, so write your whole answer "
    "in polite, natural Myanmar-Unicode Burmese (numbers stay in Western digits)."
)
_ENGLISH_NOW = (
    "LANGUAGE FOR THIS REPLY: English. The user wrote in English, so answer in English only, even if earlier "
    "messages in this chat were in another language."
)
_OTHER_NOW = (
    "LANGUAGE FOR THIS REPLY: reply in the same language as the user's latest message (English if unclear)."
)
_ZAWGYI_NOTE = (
    " The user's text looks Zawgyi-encoded: interpret it as Burmese, but write your reply in Myanmar Unicode."
)


def reply_directive(message: str, history: list[dict] | None = None) -> str:
    """The per-request language instruction appended to the system prompt."""
    if detect_language(message, history) == "my":
        note = _ZAWGYI_NOTE if looks_like_zawgyi(message) else ""
        return _BURMESE_NOW + note
    return _ENGLISH_NOW if _LATIN.search(message) else _OTHER_NOW


def system_rules(message: str, history: list[dict] | None = None) -> str:
    """Burmese rules are only added for Burmese conversations. Always including them made weaker models
    answer English questions in Burmese."""
    return BURMESE_RULES if detect_language(message, history) == "my" else ""


def max_output_tokens(message: str, history: list[dict] | None = None) -> int:
    """Burmese script costs several times more tokens than English; leave room so replies aren't cut off."""
    return 4096 if detect_language(message, history) == "my" else 2048
