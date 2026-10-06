"""Spending statistics, budget status and deterministic (rule-based) insights.

Everything here is computed from the user's confirmed transactions in SQLite. The AI layer only
*phrases* and prioritises these facts, so advice never invents numbers.
"""
import calendar
import hashlib
import json
from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import CURRENCIES, DEFAULT_CURRENCY, TOTAL_BUDGET, Alert, Budget, BudgetOut, Setting, Tip, Transaction

WARN_AT = 80.0  # % of budget
DISCRETIONARY = {"Food", "Entertainment", "Shopping"}
LABELS = {"Food": "Dining out", "Entertainment": "Games", "Bills": "Utilities"}


def money(value: float, currency: str = DEFAULT_CURRENCY) -> str:
    symbol, decimals = CURRENCIES.get(currency, CURRENCIES[DEFAULT_CURRENCY])
    return f"{symbol}{value:,.{decimals}f}"


def get_currency(db: Session) -> str:
    row = db.get(Setting, "currency")
    return row.value if row and row.value in CURRENCIES else DEFAULT_CURRENCY


def label(category: str) -> str:
    return LABELS.get(category, category)


def budget_status(spent: float, limit: float) -> tuple[float, str]:
    percent = round(spent / limit * 100, 1) if limit else 0.0
    status = "over" if percent >= 100 else "warning" if percent >= WARN_AT else "ok"
    return percent, status


def _month_bounds(month: str) -> tuple[date, date]:
    year, mon = map(int, month.split("-"))
    return date(year, mon, 1), date(year, mon, calendar.monthrange(year, mon)[1])


def _spend_by_category(db: Session, start: date, end: date) -> dict[str, dict]:
    rows = (
        db.query(Transaction.category, func.sum(Transaction.amount), func.count(Transaction.id))
        .filter(
            Transaction.status == "confirmed",
            Transaction.category != "Income",
            Transaction.transaction_date >= start.isoformat(),
            Transaction.transaction_date <= end.isoformat(),
        )
        .group_by(Transaction.category)
        .all()
    )
    return {cat: {"total": round(total, 2), "count": n} for cat, total, n in rows}


def _income(db: Session, start: date, end: date) -> float:
    total = (
        db.query(func.sum(Transaction.amount))
        .filter(
            Transaction.status == "confirmed",
            Transaction.category == "Income",
            Transaction.transaction_date >= start.isoformat(),
            Transaction.transaction_date <= end.isoformat(),
        )
        .scalar()
    )
    return round(total or 0.0, 2)


def get_budgets(db: Session) -> dict[str, float]:
    return {b.category: b.monthly_limit for b in db.query(Budget).all()}


def compute_stats(db: Session, month: str, today: date | None = None) -> dict:
    today = today or date.today()
    start, end = _month_bounds(month)
    is_current = start <= today <= end
    ref = today if is_current else end  # "now" for weekly comparisons / projections
    days_in_month = end.day
    days_elapsed = ref.day if is_current else days_in_month

    by_cat = _spend_by_category(db, start, end)
    total_spent = round(sum(c["total"] for c in by_cat.values()), 2)
    categories = [
        {
            "category": cat,
            "total": v["total"],
            "count": v["count"],
            "percent": round(v["total"] / total_spent * 100, 1) if total_spent else 0.0,
        }
        for cat, v in sorted(by_cat.items(), key=lambda kv: kv[1]["total"], reverse=True)
    ]

    prev_start, prev_end = _month_bounds((start - timedelta(days=1)).strftime("%Y-%m"))
    prev_by_cat = _spend_by_category(db, prev_start, prev_end)
    prev_total = round(sum(c["total"] for c in prev_by_cat.values()), 2)

    week_start, prev_week_start = ref - timedelta(days=6), ref - timedelta(days=13)
    last7 = _spend_by_category(db, max(week_start, start), ref)
    prev7 = _spend_by_category(db, prev_week_start, week_start - timedelta(days=1))

    merchants = (
        db.query(Transaction.merchant_name, func.sum(Transaction.amount), func.count(Transaction.id))
        .filter(
            Transaction.status == "confirmed",
            Transaction.category != "Income",
            Transaction.transaction_date >= start.isoformat(),
            Transaction.transaction_date <= end.isoformat(),
        )
        .group_by(Transaction.merchant_name)
        .order_by(func.sum(Transaction.amount).desc())
        .limit(5)
        .all()
    )

    projected = None
    if total_spent and (not is_current or days_elapsed >= 3):
        projected = round(total_spent / days_elapsed * days_in_month, 2) if is_current else total_spent

    budgets = get_budgets(db)
    budget_rows = []
    for cat, limit in budgets.items():
        spent = total_spent if cat == TOTAL_BUDGET else by_cat.get(cat, {}).get("total", 0.0)
        percent, status = budget_status(spent, limit)
        budget_rows.append({"category": cat, "limit": limit, "spent": round(spent, 2), "percent": percent, "status": status})

    return {
        "month": month,
        "currency": get_currency(db),
        "today": ref.isoformat(),
        "days_elapsed": days_elapsed,
        "days_in_month": days_in_month,
        "is_current_month": is_current,
        "total_spent": total_spent,
        "income": _income(db, start, end),
        "transaction_count": sum(c["count"] for c in by_cat.values()),
        "categories": categories,
        "projected_month_total": projected,
        "previous_month_total": prev_total,
        "previous_month_by_category": {c: v["total"] for c, v in prev_by_cat.items()},
        "last_7_days": {c: v["total"] for c, v in last7.items()},
        "previous_7_days": {c: v["total"] for c, v in prev7.items()},
        "top_merchants": [{"merchant": m, "total": round(t, 2), "visits": n} for m, t, n in merchants],
        "budgets": budget_rows,
    }


def stats_hash(stats: dict) -> str:
    return hashlib.sha256(json.dumps(stats, sort_keys=True, default=str).encode()).hexdigest()


def budget_outputs(stats: dict) -> list[BudgetOut]:
    return [
        BudgetOut(category=b["category"], monthly_limit=b["limit"], spent=b["spent"], percent=b["percent"], status=b["status"])
        for b in sorted(stats["budgets"], key=lambda b: (b["category"] != TOTAL_BUDGET, b["category"]))
    ]


def alerts_from(stats: dict) -> list[Alert]:
    fmt = lambda value: money(value, stats["currency"])  # noqa: E731
    alerts = []
    for b in stats["budgets"]:
        if b["status"] == "ok":
            continue
        name = "Your monthly budget" if b["category"] == TOTAL_BUDGET else f"{label(b['category'])} budget"
        verb = "is exceeded" if b["status"] == "over" else "is almost used up"
        alerts.append(
            Alert(
                level=b["status"],
                category=None if b["category"] == TOTAL_BUDGET else b["category"],
                message=f"{name} {verb}: {fmt(b['spent'])} of {fmt(b['limit'])} ({b['percent']:.0f}%)",
            )
        )
    alerts.sort(key=lambda a: a.level != "over")
    return alerts


def rule_based_tips(stats: dict) -> list[Tip]:
    """Deterministic advice; also the fallback when the AI is unavailable."""
    fmt = lambda value: money(value, stats["currency"])  # noqa: E731
    tips: list[Tip] = []
    total = stats["total_spent"]
    this_month = "this month" if stats["is_current_month"] else "that month"  # the dashboard can show a past month

    if total == 0:
        return [
            Tip(
                title="Nothing tracked yet",
                body="Screenshot a payment slip or share it from Photos and your spending insights will appear here.",
                severity="info",
            )
        ]

    # Budgets
    for b in stats["budgets"]:
        if b["status"] == "ok":
            continue
        cat = None if b["category"] == TOTAL_BUDGET else b["category"]
        name = "monthly budget" if cat is None else f"{label(cat)} budget"
        if b["status"] == "over":
            tips.append(
                Tip(
                    title=f"Over your {name}",
                    body=f"You've spent {fmt(b['spent'])} against a {fmt(b['limit'])} limit — {fmt(b['spent'] - b['limit'])} over.",
                    severity="warning",
                    category=cat,
                )
            )
        else:
            tips.append(
                Tip(
                    title=f"{name.capitalize()} almost used",
                    body=f"{b['percent']:.0f}% used ({fmt(b['spent'])} of {fmt(b['limit'])}). {fmt(b['limit'] - b['spent'])} left.",
                    severity="warning",
                    category=cat,
                )
            )

    # Projection vs total budget / last month
    projected = stats["projected_month_total"]
    total_budget = next((b for b in stats["budgets"] if b["category"] == TOTAL_BUDGET), None)
    if projected and stats["is_current_month"] and total_budget and total_budget["status"] != "over" and projected > total_budget["limit"]:
        tips.append(
            Tip(
                title="On pace to overspend",
                body=f"At this rate you'll spend about {fmt(projected)} this month, {fmt(projected - total_budget['limit'])} above your {fmt(total_budget['limit'])} budget.",
                severity="warning",
            )
        )
    prev_total = stats["previous_month_total"]
    if projected and prev_total:
        change = (projected - prev_total) / prev_total * 100
        if change <= -10:
            tips.append(
                Tip(
                    title="Spending less than last month",
                    body=f"You're on track to spend about {abs(change):.0f}% less than last month ({fmt(prev_total)}). Nice work.",
                    severity="positive",
                )
            )
        elif change >= 20:
            tips.append(
                Tip(
                    title="Spending more than last month",
                    body=f"At this pace you'll spend about {change:.0f}% more than last month ({fmt(projected)} vs {fmt(prev_total)}).",
                    severity="warning",
                )
            )

    # Week over week, per category
    for cat in sorted(stats["last_7_days"], key=lambda c: -stats["last_7_days"][c]):
        now, before = stats["last_7_days"][cat], stats["previous_7_days"].get(cat, 0.0)
        # Only compare against a real previous week; with a brand-new history everything would look "up".
        if before > 0 and now - before >= 20 and now >= before * 1.3:
            how = f"up from {fmt(before)} the week before"
            advice = " Consider cutting back." if cat in DISCRETIONARY else ""
            tips.append(
                Tip(
                    title=f"More on {label(cat).lower()} this week",
                    body=f"You spent {fmt(now)} on {label(cat).lower()} in the last 7 days, {how}.{advice}",
                    severity="warning" if cat in DISCRETIONARY else "info",
                    category=cat,
                )
            )

    # Concentration
    top = stats["categories"][0]
    if top["percent"] >= 40 and top["category"] in DISCRETIONARY and len(stats["categories"]) > 1:
        tips.append(
            Tip(
                title=f"{label(top['category'])} dominates your spending",
                body=f"{top['percent']:.0f}% of {this_month}'s spending ({fmt(top['total'])}) went to {label(top['category']).lower()}.",
                severity="info",
                category=top["category"],
            )
        )

    # Savings rate
    income = stats["income"]
    if income > 0:
        saved = income - total
        rate = saved / income * 100
        if rate >= 20:
            tips.append(
                Tip(
                    title="Healthy savings rate",
                    body=f"You've kept {rate:.0f}% of {this_month}'s income ({fmt(saved)}). Consider moving some of it to savings.",
                    severity="positive",
                )
            )
        elif saved < 0:
            tips.append(
                Tip(
                    title="Spending exceeds income",
                    body=f"You've spent {fmt(total)} against {fmt(income)} of income {this_month}.",
                    severity="warning",
                )
            )

    if not tips:
        tips.append(
            Tip(
                title="Spending looks steady",
                body=f"You've spent {fmt(total)} across {stats['transaction_count']} transactions, with no budget or trend concerns right now.",
                severity="positive",
            )
        )
    order = {"warning": 0, "info": 1, "positive": 2}
    return sorted(tips, key=lambda t: order[t.severity])[:6]


def rule_based_headline(stats: dict, tips: list[Tip]) -> str:
    fmt = lambda value: money(value, stats["currency"])  # noqa: E731
    if stats["total_spent"] == 0:
        return "No spending tracked yet this month" if stats["is_current_month"] else "No spending tracked in that month"
    warnings = sum(t.severity == "warning" for t in tips)
    spent = fmt(stats["total_spent"])
    if warnings:
        return f"{spent} spent, {warnings} thing{'s' if warnings != 1 else ''} to watch"
    return f"{spent} spent, you're in good shape"
