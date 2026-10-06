"""Smart transaction search: free text such as "food over 200 last month" or "uber >500 august".

The query is split into recognisable parts (category, amount comparison, date range) and whatever is
left must appear in the merchant name. Understands English and the common Burmese time words, plus
Burmese digits. Everything runs as SQL on confirmed transactions only.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy.orm import Session

import insights
from models import Transaction, resolve_category

_BURMESE_DIGITS = str.maketrans("၀၁၂၃၄၅၆၇၈၉", "0123456789")
_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
_MONTH_LOOKUP = {m: i + 1 for i, m in enumerate(_MONTHS)} | {m[:3]: i + 1 for i, m in enumerate(_MONTHS)} | {"sept": 9}

_OVER = {"over", "above", "exceeding", "more", ">"}
_UNDER = {"under", "below", "less", "<"}
_FILLER = {"than", "at", "least", "most", "of", "the", "in", "on", "for", "spent", "spend", "my"}
_COMPARATOR = re.compile(r"^(>=|<=|>|<|=)?\s*[฿$€£¥]?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?$")
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ISO_MONTH = re.compile(r"^\d{4}-\d{2}$")

# phrase -> (relative-range name). Burmese: ဒီနေ့/ယနေ့ today, မနေ့က yesterday, ဒီအပတ် this week, ...
_RANGE_WORDS = {
    "today": "today", "ဒီနေ့": "today", "ယနေ့": "today",
    "yesterday": "yesterday", "မနေ့က": "yesterday",
    "ဒီအပတ်": "this week", "ပြီးခဲ့တဲ့အပတ်": "last week",
    "ဒီလ": "this month", "ပြီးခဲ့တဲ့လ": "last month",
    "ဒီနှစ်": "this year",
}
_RANGE_PHRASES = {
    ("this", "week"): "this week", ("last", "week"): "last week",
    ("this", "month"): "this month", ("last", "month"): "last month",
    ("this", "year"): "this year", ("last", "year"): "last year",
    ("past", "week"): "this week", ("past", "month"): "past 30 days",
}


@dataclass
class Parsed:
    category: str | None = None
    min_amount: float | None = None   # inclusive
    max_amount: float | None = None   # inclusive
    date_from: date | None = None
    date_to: date | None = None
    terms: list[str] = field(default_factory=list)  # all must be in the merchant name
    notes: list[str] = field(default_factory=list)  # human-readable interpretation


def _range(name: str, today: date) -> tuple[date, date]:
    if name == "today":
        return today, today
    if name == "yesterday":
        y = today - timedelta(days=1)
        return y, y
    if name == "this week":
        return today - timedelta(days=6), today
    if name == "last week":
        return today - timedelta(days=13), today - timedelta(days=7)
    if name == "this month":
        return today.replace(day=1), today
    if name == "last month":
        end = today.replace(day=1) - timedelta(days=1)
        return end.replace(day=1), end
    if name == "this year":
        return today.replace(month=1, day=1), today
    if name == "last year":
        return date(today.year - 1, 1, 1), date(today.year - 1, 12, 31)
    return today - timedelta(days=29), today  # past 30 days


def _month_range(year: int, month: int) -> tuple[date, date]:
    first = date(year, month, 1)
    nxt = date(year + (month == 12), month % 12 + 1, 1)
    return first, nxt - timedelta(days=1)


def _amount(token: str) -> tuple[str | None, float] | None:
    m = _COMPARATOR.match(token.replace(" ", ""))
    if not m:
        return None
    value = float(m.group(2).replace(",", ""))
    if m.group(3):
        value *= 1000
    return m.group(1), value


def parse_query(q: str, today: date | None = None) -> Parsed:
    today = today or date.today()
    out = Parsed()
    tokens = q.translate(_BURMESE_DIGITS).strip().split()
    tokens = [t.lower() if t.isascii() else t for t in tokens]
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        nxt = tokens[i + 1] if i + 1 < len(tokens) else ""

        if tok in _RANGE_WORDS:
            out.date_from, out.date_to = _range(_RANGE_WORDS[tok], today)
            out.notes.append(_RANGE_WORDS[tok])
        elif (tok, nxt) in _RANGE_PHRASES:
            name = _RANGE_PHRASES[(tok, nxt)]
            out.date_from, out.date_to = _range(name, today)
            out.notes.append(name)
            i += 1
        elif _ISO_DAY.match(tok):
            try:
                out.date_from = out.date_to = date.fromisoformat(tok)
                out.notes.append(tok)
            except ValueError:
                out.terms.append(tok)
        elif _ISO_MONTH.match(tok):
            y, mth = map(int, tok.split("-"))
            if 1 <= mth <= 12:
                out.date_from, out.date_to = _month_range(y, mth)
                out.notes.append(tok)
            else:
                out.terms.append(tok)
        elif tok in _MONTH_LOOKUP:
            mth = _MONTH_LOOKUP[tok]
            year = today.year if mth <= today.month else today.year - 1
            out.date_from, out.date_to = _month_range(year, mth)
            out.notes.append(_MONTHS[mth - 1].capitalize() + f" {year}")
        elif tok in _OVER | _UNDER | {">=", "<=", "="} and _amount(nxt):
            # "over 200", "> 200", "more than 200" (the "than" filler is skipped below)
            op = ">" if tok in _OVER else "<" if tok in _UNDER else tok
            _, value = _amount(nxt)  # type: ignore[misc]
            _apply_comparison(out, op, value)
            i += 1
        elif tok in ("more", "less") and nxt == "than" and i + 2 < len(tokens) and _amount(tokens[i + 2]):
            _, value = _amount(tokens[i + 2])  # type: ignore[misc]
            _apply_comparison(out, ">" if tok == "more" else "<", value)
            i += 2
        elif (parsed := _amount(tok)) is not None:
            op, value = parsed
            _apply_comparison(out, op or "==", value)
        elif tok in _FILLER:
            pass
        elif (cat := resolve_category(tok)) is not None:
            out.category = cat
            out.notes.append(cat)
        else:
            out.terms.append(tok)
        i += 1
    return out


def _apply_comparison(out: Parsed, op: str, value: float) -> None:
    if op == ">":
        out.min_amount, note = value + 0.005, f"over {value:g}"
    elif op == ">=":
        out.min_amount, note = value, f"at least {value:g}"
    elif op == "<":
        out.max_amount, note = value - 0.005, f"under {value:g}"
    elif op == "<=":
        out.max_amount, note = value, f"at most {value:g}"
    else:  # exact amount
        out.min_amount, out.max_amount, note = value - 0.005, value + 0.005, f"exactly {value:g}"
    out.notes.append(note)


def search(
    db: Session, q: str, category: str | None = None, limit: int = 50, today: date | None = None, month: str | None = None
) -> tuple[list[Transaction], Parsed]:
    parsed = parse_query(q, today)
    if month and parsed.date_from is None:  # the screen is showing one month: search within it unless the query names its own dates
        year, mon = map(int, month.split("-"))
        parsed.date_from, parsed.date_to = _month_range(year, mon)
    if category:  # an explicit category filter (e.g. a tapped chip) wins over words in the text
        parsed.category = resolve_category(category) or parsed.category
        if parsed.category and parsed.category not in parsed.notes:
            parsed.notes.insert(0, parsed.category)
    query = db.query(Transaction).filter(Transaction.status == "confirmed")
    if parsed.category:
        query = query.filter(Transaction.category == parsed.category)
    if parsed.min_amount is not None:
        query = query.filter(Transaction.amount >= parsed.min_amount)
    if parsed.max_amount is not None:
        query = query.filter(Transaction.amount <= parsed.max_amount)
    if parsed.date_from:
        query = query.filter(Transaction.transaction_date >= parsed.date_from.isoformat())
    if parsed.date_to:
        query = query.filter(Transaction.transaction_date <= parsed.date_to.isoformat())
    for term in parsed.terms:
        query = query.filter(Transaction.merchant_name.ilike(f"%{term}%"))
    if parsed.terms:
        parsed.notes.extend(f"“{t}”" for t in parsed.terms)
    rows = query.order_by(Transaction.transaction_date.desc(), Transaction.id.desc()).limit(max(1, min(limit, 200))).all()
    return rows, parsed
