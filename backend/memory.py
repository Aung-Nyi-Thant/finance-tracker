"""The assistant's memory of the user's money.

Nothing is stored separately: the context is rebuilt from SQLite on every chat / advice request, so a
transaction confirmed one second ago is already known. Two layers keep prompts small but complete:

* ``build_context``  – a compact summary (this month, last month, 6-month history, weekly trend, merchants,
  budgets, affordability and the latest slips) injected into the Gemini prompt.
* ``make_tools``     – query functions Gemini can call to get exact numbers for any date range,
  category or merchant ("food this month vs. last week", "how much at Starbucks in August").
"""
# NOTE: do not add `from __future__ import annotations` here. The Gemini SDK runs the tools below by checking
# arguments against their annotations, which must therefore be real types, not strings.
import calendar
from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

import insights
from models import CATEGORIES, TOTAL_BUDGET, Impact, Transaction, resolve_category

HISTORY_MONTHS = 6
WEEKS = 6
RECENT_LIMIT = 30
MAX_RANGE_DAYS = 3660


# ---------- context ----------


def _month_start(d: date, back: int = 0) -> date:
    y, m = d.year, d.month - back
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, 1)


def _spend_rows(db: Session, start: date, end: date):
    return (
        db.query(Transaction.transaction_date, Transaction.category, Transaction.amount)
        .filter(
            Transaction.status == "confirmed",
            Transaction.category != "Income",
            Transaction.transaction_date >= start.isoformat(),
            Transaction.transaction_date <= end.isoformat(),
        )
        .all()
    )


def _monthly_history(db: Session, today: date) -> list[dict]:
    first = _month_start(today, HISTORY_MONTHS - 1)
    month_expr = func.substr(Transaction.transaction_date, 1, 7)
    rows = (
        db.query(month_expr, Transaction.category, func.sum(Transaction.amount))
        .filter(Transaction.status == "confirmed", Transaction.transaction_date >= first.isoformat())
        .group_by(month_expr, Transaction.category)
        .all()
    )
    by_month: dict[str, dict] = {}
    for month, cat, total in rows:
        entry = by_month.setdefault(month, {"month": month, "total_spent": 0.0, "income": 0.0, "by_category": {}})
        if cat == "Income":
            entry["income"] += total
        else:
            entry["total_spent"] += total
            entry["by_category"][cat] = round(total, 2)
    out = []
    for back in range(HISTORY_MONTHS - 1, -1, -1):
        key = _month_start(today, back).strftime("%Y-%m")
        e = by_month.get(key, {"month": key, "total_spent": 0.0, "income": 0.0, "by_category": {}})
        e["total_spent"], e["income"] = round(e["total_spent"], 2), round(e["income"], 2)
        out.append(e)
    return out


def _weekly(db: Session, today: date) -> list[dict]:
    """Rolling 7-day windows ending today (index 0 = the most recent)."""
    start = today - timedelta(days=7 * WEEKS - 1)
    windows = [{"from": (today - timedelta(days=7 * i + 6)).isoformat(), "to": (today - timedelta(days=7 * i)).isoformat(),
                "total_spent": 0.0, "by_category": {}} for i in range(WEEKS)]
    for day, cat, amount in _spend_rows(db, start, today):
        age = (today - date.fromisoformat(day)).days
        if 0 <= age < 7 * WEEKS:
            w = windows[age // 7]
            w["total_spent"] += amount
            w["by_category"][cat] = round(w["by_category"].get(cat, 0.0) + amount, 2)
    for w in windows:
        w["total_spent"] = round(w["total_spent"], 2)
    return windows


def _merchants(db: Session, start: date, end: date, limit: int = 6) -> list[dict]:
    rows = (
        db.query(Transaction.merchant_name, func.sum(Transaction.amount), func.count(Transaction.id))
        .filter(
            Transaction.status == "confirmed",
            Transaction.category != "Income",
            Transaction.transaction_date >= start.isoformat(),
            Transaction.transaction_date <= end.isoformat(),
        )
        .group_by(Transaction.merchant_name)
        .order_by(func.sum(Transaction.amount).desc())
        .limit(limit)
        .all()
    )
    return [{"merchant": m, "total": round(t, 2), "visits": n} for m, t, n in rows]


def _affordability(stats: dict) -> dict:
    """Pre-computed numbers for "can I afford X?" so the model doesn't have to do the arithmetic."""
    budgets = {b["category"]: b for b in stats["budgets"]}
    total = budgets.get(TOTAL_BUDGET)
    days_left = stats["days_in_month"] - stats["days_elapsed"] + 1 if stats["is_current_month"] else 0
    remaining_total = round(total["limit"] - total["spent"], 2) if total else None
    return {
        "days_left_in_month_including_today": days_left,
        "total_budget_remaining": remaining_total,
        "safe_daily_spend": round(max(remaining_total, 0) / days_left, 2) if remaining_total is not None and days_left else None,
        "category_budget_remaining": {c: round(b["limit"] - b["spent"], 2) for c, b in budgets.items() if c != TOTAL_BUDGET},
        "income_minus_spent_this_month": round(stats["income"] - stats["total_spent"], 2),
        "note": "Negative remaining = already over budget. No budget set => value is null/absent.",
    }


def build_context(db: Session, month: str | None = None) -> dict:
    """Everything the assistant should already know, as plain JSON-able data."""
    stats = insights.compute_stats(db, month or date.today().strftime("%Y-%m"))
    today = date.fromisoformat(stats["today"])

    extent = db.query(func.min(Transaction.transaction_date), func.max(Transaction.transaction_date), func.count(Transaction.id)).filter(
        Transaction.status == "confirmed"
    ).one()
    recent = (
        db.query(Transaction)
        .filter(Transaction.status == "confirmed")
        .order_by(Transaction.transaction_date.desc(), Transaction.id.desc())
        .limit(RECENT_LIMIT)
        .all()
    )
    return {
        **stats,
        "data_range": {"first_transaction": extent[0], "last_transaction": extent[1], "confirmed_transactions": extent[2]},
        "monthly_history": _monthly_history(db, today),
        "weekly_spending_recent_first": _weekly(db, today),
        "top_merchants_last_90_days": _merchants(db, today - timedelta(days=89), today),
        "affordability": _affordability(stats),
        "recent_transactions": [
            {"date": t.transaction_date, "merchant": t.merchant_name, "category": t.category, "amount": t.amount} for t in recent
        ],
    }


# ---------- query tools for Gemini ----------


def _parse_range(start_date: str, end_date: str) -> tuple[date, date] | str:
    try:
        start, end = date.fromisoformat(start_date), date.fromisoformat(end_date)
    except (TypeError, ValueError):
        return "Dates must be YYYY-MM-DD."
    if start > end:
        start, end = end, start
    if (end - start).days > MAX_RANGE_DAYS:
        return "Date range is too large (max 10 years)."
    return start, end


def _filters(query, start: date, end: date, category: str | None, merchant: str):
    query = query.filter(
        Transaction.status == "confirmed",
        Transaction.transaction_date >= start.isoformat(),
        Transaction.transaction_date <= end.isoformat(),
    )
    if category:
        query = query.filter(Transaction.category == category)
    else:
        query = query.filter(Transaction.category != "Income")
    if merchant.strip():
        query = query.filter(Transaction.merchant_name.ilike(f"%{merchant.strip()}%"))
    return query


def make_tools(db: Session) -> list:
    """Query functions bound to this request's DB session. Docstrings are what Gemini reads."""
    currency = insights.get_currency(db)

    def _resolve(category: str):
        if not category.strip():
            return None, None
        cat = resolve_category(category)
        if cat is None:
            return None, f"Unknown category '{category}'. Use one of: {', '.join(CATEGORIES)}."
        return cat, None

    def get_spending(start_date: str, end_date: str, category: str = "", merchant: str = "") -> dict:
        """Exact spending total for any period from the user's real transaction history.

        Use this for questions about a specific date range (a week, a month, "last Friday", a year...),
        a category (Food, Groceries, Transport, Shopping, Entertainment/games, Bills/utilities, Health,
        Income, Other) or a merchant. Both dates are inclusive, format YYYY-MM-DD. Leave category and
        merchant empty for all spending (income is excluded unless category is 'Income').
        """
        rng = _parse_range(start_date, end_date)
        if isinstance(rng, str):
            return {"error": rng}
        cat, err = _resolve(category)
        if err:
            return {"error": err}
        start, end = rng
        total, count = _filters(db.query(func.coalesce(func.sum(Transaction.amount), 0.0), func.count(Transaction.id)), start, end, cat, merchant).one()
        result = {
            "period": [start.isoformat(), end.isoformat()],
            "category": cat or "all spending",
            "merchant_filter": merchant.strip() or None,
            "currency": currency,
            "total": round(total, 2),
            "transaction_count": count,
        }
        if not cat:
            by_cat = _filters(db.query(Transaction.category, func.sum(Transaction.amount)), start, end, None, merchant).group_by(Transaction.category).all()
            result["by_category"] = {c: round(t, 2) for c, t in sorted(by_cat, key=lambda r: -r[1])}
        top = (
            _filters(db.query(Transaction.merchant_name, func.sum(Transaction.amount)), start, end, cat, merchant)
            .group_by(Transaction.merchant_name)
            .order_by(func.sum(Transaction.amount).desc())
            .limit(5)
            .all()
        )
        result["top_merchants"] = [{"merchant": m, "total": round(t, 2)} for m, t in top]
        return result

    def list_transactions(start_date: str, end_date: str, category: str = "", merchant: str = "", limit: int = 15) -> dict:
        """List individual transactions (newest first) in a date range, optionally for one category or merchant.

        Use this when the user asks what they bought, wants examples, or asks about a specific purchase.
        Dates are inclusive, format YYYY-MM-DD. At most 30 rows are returned.
        """
        rng = _parse_range(start_date, end_date)
        if isinstance(rng, str):
            return {"error": rng}
        cat, err = _resolve(category)
        if err:
            return {"error": err}
        start, end = rng
        rows = (
            _filters(db.query(Transaction), start, end, cat, merchant)
            .order_by(Transaction.transaction_date.desc(), Transaction.id.desc())
            .limit(max(1, min(int(limit), 30)))
            .all()
        )
        return {
            "currency": currency,
            "transactions": [
                {"date": t.transaction_date, "merchant": t.merchant_name, "category": t.category, "amount": t.amount} for t in rows
            ],
        }

    return [get_spending, list_transactions]


# ---------- immediate feedback after saving a slip ----------


def impact_for(db: Session, tx: Transaction) -> Impact:
    """Budget picture for the month of a just-saved transaction (what the assistant now 'knows')."""
    stats = insights.compute_stats(db, tx.transaction_date[:7])
    fmt = lambda v: insights.money(v, stats["currency"])  # noqa: E731
    budgets = {b["category"]: b for b in stats["budgets"]}
    cat_total = next((c["total"] for c in stats["categories"] if c["category"] == tx.category), 0.0)
    cat_b, tot_b = budgets.get(tx.category), budgets.get(TOTAL_BUDGET)
    name = insights.label(tx.category)

    if tx.category == "Income":
        message = f"Income recorded: {fmt(tx.amount)}. This month so far: {fmt(stats['income'])}."
    elif cat_b:
        message = f"{name}: {fmt(cat_total)} of {fmt(cat_b['limit'])} ({cat_b['percent']:.0f}%)."
    elif tot_b:
        message = f"This month: {fmt(stats['total_spent'])} of {fmt(tot_b['limit'])} ({tot_b['percent']:.0f}%)."
    else:
        message = f"{name} this month: {fmt(cat_total)}."
    rank = {"ok": 0, "warning": 1, "over": 2}
    status = max((b["status"] for b in (cat_b, tot_b) if b), key=rank.get, default="ok")
    if status == "over":
        message += " Over budget."
    elif status == "warning":
        message += " Getting close to your limit."
    return Impact(
        message=message,
        category=tx.category,
        category_spent=cat_total,
        category_budget=cat_b["limit"] if cat_b else None,
        category_percent=cat_b["percent"] if cat_b else None,
        total_spent=stats["total_spent"],
        total_budget=tot_b["limit"] if tot_b else None,
        total_percent=tot_b["percent"] if tot_b else None,
        status=status,
    )
