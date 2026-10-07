"""Rule-based reader for bank payment slips: no AI, no image upload.

The phone runs on-device OCR (Apple Vision) and sends only the recognised text lines. This module turns those
lines into the same ``ParsedReceipt`` the Gemini path produced. Written against Bangkok Bank PromptPay slips
but only relies on generic anchors (an "Amount" label with THB, a date, the From/To blocks), so other Thai
bank slips with the same shape usually parse too. Anything unrecognised returns ``None`` (not a slip).
"""
import hashlib
import re
from datetime import date

from models import ParsedReceipt

_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}

_MONEY = re.compile(r"^(?:THB|฿)?\s*([\d,]+\.\d{2})\s*(?:THB|฿|Baht)?$", re.IGNORECASE)
_HAS_CURRENCY = re.compile(r"THB|฿|baht", re.IGNORECASE)
_DATE = re.compile(r"(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4}|\d{2})(?:,?\s+\d{1,2}:\d{2})?")
_MASKED_ACCOUNT = re.compile(r"^[\dxX*]{2,}(?:[-\s][\dxX*]+)+$")
_TITLE = re.compile(r"^(?:mr|mrs|ms|miss|mstr)\.?\s+", re.IGNORECASE)
_LABELS = {"from", "to", "amount", "fee", "scan to verify"}

# Keyword -> category, checked in order against the recipient and the other slip text.
_CATEGORY_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("Groceries", ("7-eleven", "7eleven", "seven eleven", "lotus", "big c", "makro", "tops", "gourmet market",
                   "supermarket", "mart", "villa market")),
    ("Transport", ("grab", "bolt", "taxi", "bts", "mrt", "airport rail", "lineman ride", "transport", "parking",
                   "ptt", "shell", "bangchak", "caltex", "fuel", "expressway", "easy pass")),
    ("Bills", ("ais", "true", "dtac", "true money", "electric", "mea", "pea", "metropolitan", "waterworks",
               "water supply", "internet", "3bb", "insurance", "rent", "bill payment", "utility")),
    ("Health", ("hospital", "clinic", "pharmacy", "drugstore", "boots", "watsons", "dental", "medical")),
    ("Entertainment", ("netflix", "spotify", "steam", "garena", "playstation", "nintendo", "youtube", "cinema",
                       "major cineplex", "sf cinema", "game")),
    ("Shopping", ("lazada", "shopee", "central", "robinson", "uniqlo", "zara", "h&m", "ikea", "homepro",
                  "power buy", "jd central")),
    ("Food", ("restaurant", "cafe", "café", "coffee", "kitchen", "noodle", "pizza", "sushi", "bbq", "grill",
              "starbucks", "mcdonald", "kfc", "burger", "bakery", "tea", "bistro", "food", "foodpanda",
              "lineman", "grabfood", "shabu", "ramen", "steak", "dessert", "bubble")),
]


def _norm(lines: list[str]) -> list[str]:
    return [re.sub(r"\s+", " ", str(line)).strip() for line in lines if str(line).strip()]


def _parse_amount(lines: list[str]) -> float | None:
    """The value right after the "Amount" label; falls back to the first THB figure that isn't the fee."""
    for i, line in enumerate(lines):
        if line.lower() == "amount":
            for nxt in lines[i + 1:i + 3]:
                m = _MONEY.match(nxt)
                if m and _HAS_CURRENCY.search(nxt):
                    return float(m.group(1).replace(",", ""))
    for i, line in enumerate(lines):
        m = _MONEY.match(line)
        if m and _HAS_CURRENCY.search(line) and not (i and lines[i - 1].lower() == "fee"):
            value = float(m.group(1).replace(",", ""))
            if value > 0:
                return value
    return None


def _parse_date(lines: list[str]) -> str | None:
    for line in lines:
        m = _DATE.search(line)
        if not m:
            continue
        month = _MONTHS.get(m.group(2).lower())
        if not month:
            continue
        year = int(m.group(3))
        if year < 100:
            year += 2000
        if year > 2400:  # Buddhist Era
            year -= 543
        try:
            return date(year, month, int(m.group(1))).isoformat()
        except ValueError:
            continue
    return None


def _clean_name(raw: str) -> str:
    name = _TITLE.sub("", raw).strip()
    return name.title() if name.isupper() else name


def _recipient(lines: list[str]) -> str | None:
    """The "To" party. OCR order varies between slips, so anchor on the sender's masked account number."""
    for i, line in enumerate(lines):
        if _MASKED_ACCOUNT.match(line) and i + 1 < len(lines):
            # sender account -> sender bank -> (optional "To" label) -> recipient
            for cand in lines[i + 2:i + 5]:
                if cand.lower() not in _LABELS and not _MASKED_ACCOUNT.match(cand):
                    return _clean_name(cand)
    for i, line in enumerate(lines):
        if line.lower() == "to":
            for cand in lines[i + 1:i + 3]:
                if cand.lower() not in _LABELS and not _MASKED_ACCOUNT.match(cand):
                    return _clean_name(cand)
    return None


def _to_block(lines: list[str], recipient: str | None) -> str:
    """The recipient's lines (name, PromptPay / wallet details) up to the fee, lower-cased."""
    if not recipient:
        return ""
    for i, line in enumerate(lines):
        if _clean_name(line) == recipient:
            block = []
            for nxt in lines[i:i + 7]:
                if nxt.lower() in ("fee", "bank reference no."):
                    break
                block.append(nxt)
            return " ".join(block).lower()
    return recipient.lower()


def _category(lines: list[str], recipient: str | None) -> str:
    haystack = _to_block(lines, recipient)
    for category, words in _CATEGORY_RULES:
        if any(re.search(rf"(?<![a-z0-9]){re.escape(w)}(?![a-z0-9])", haystack) for w in words):
            return category
    return "Other"


def parse_slip(lines: list[str]) -> ParsedReceipt | None:
    """Fields from the OCR text of a payment slip, or None when the text isn't a payment slip."""
    lines = _norm(lines)
    amount = _parse_amount(lines)
    when = _parse_date(lines)
    if amount is None or when is None:
        return None
    recipient = _recipient(lines)
    return ParsedReceipt(
        amount=amount,
        merchant_name=recipient or "Bank transfer",
        category=_category(lines, recipient),
        transaction_date=when,
    )


def slip_fingerprint(lines: list[str]) -> str:
    """Stable id for de-duplication: the bank's transaction reference when present, else a hash of the text.

    Stored in Transaction.image_hash, so re-reading the same slip never creates a second pending entry.
    """
    lines = _norm(lines)
    for i, line in enumerate(lines):
        if "transaction reference" in line.lower() or line.lower().startswith("ref"):
            for nxt in lines[i + 1:i + 2]:
                if re.fullmatch(r"[A-Za-z0-9]{8,}", nxt):
                    return "slip:" + hashlib.sha256(nxt.encode()).hexdigest()
    return "slip:" + hashlib.sha256("\n".join(lines).encode()).hexdigest()
