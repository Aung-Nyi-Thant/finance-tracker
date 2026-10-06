"""Budgets and the AI financial assistant (advice + chat)."""
import json
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import ai_service
import insights
import memory
from database import get_db
from models import (
    CATEGORIES,
    TOTAL_BUDGET,
    AdviceCache,
    AdviceOut,
    Budget,
    BudgetIn,
    BudgetOut,
    ChatReply,
    ChatRequest,
    SettingsIn,
    SettingsOut,
    Setting,
    Tip,
)
from security import require_token

router = APIRouter(prefix="/api", dependencies=[Depends(require_token)])

MONTH_PATTERN = r"^\d{4}-\d{2}$"
BUDGET_KEYS = [TOTAL_BUDGET] + [c for c in CATEGORIES if c != "Income"]


def _month(month: str | None) -> str:
    return month or date.today().strftime("%Y-%m")


# ---------- settings ----------


@router.get("/settings", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    return SettingsOut(currency=insights.get_currency(db))


@router.put("/settings", response_model=SettingsOut)
def update_settings(body: SettingsIn, db: Session = Depends(get_db)):
    row = db.get(Setting, "currency")
    if row:
        row.value = body.currency
    else:
        db.add(Setting(key="currency", value=body.currency))
    db.commit()
    return SettingsOut(currency=body.currency)


# ---------- budgets ----------


@router.get("/budgets", response_model=list[BudgetOut])
def list_budgets(month: str | None = Query(None, pattern=MONTH_PATTERN), db: Session = Depends(get_db)):
    return insights.budget_outputs(insights.compute_stats(db, _month(month)))


@router.put("/budgets/{category}", response_model=BudgetOut)
def set_budget(category: str, body: BudgetIn, db: Session = Depends(get_db)):
    if category not in BUDGET_KEYS:
        raise HTTPException(422, f"category must be one of {BUDGET_KEYS}")
    for attempt in range(2):  # retry once if two requests race to create the same row
        budget = db.query(Budget).filter(Budget.category == category).first()
        if budget:
            budget.monthly_limit = body.monthly_limit
        else:
            db.add(Budget(category=category, monthly_limit=body.monthly_limit))
        try:
            db.commit()
            break
        except IntegrityError:
            db.rollback()
            if attempt:
                raise
    stats = insights.compute_stats(db, _month(None))
    return next(b for b in insights.budget_outputs(stats) if b.category == category)


@router.delete("/budgets/{category}", status_code=204)
def delete_budget(category: str, db: Session = Depends(get_db)):
    budget = db.query(Budget).filter(Budget.category == category).first()
    if budget is None:
        raise HTTPException(404, "No budget set for that category")
    db.delete(budget)
    db.commit()


# ---------- advice ----------


def _from_cache(row: AdviceCache) -> AdviceOut:
    data = json.loads(row.payload)
    return AdviceOut(
        month=row.month,
        headline=data["headline"],
        tips=[Tip(**t) for t in data["tips"]],
        source="ai",
        generated_at=row.created_at if row.created_at.tzinfo else row.created_at.replace(tzinfo=timezone.utc),
    )


@router.get("/assistant/advice", response_model=AdviceOut)
def advice(
    month: str | None = Query(None, pattern=MONTH_PATTERN),
    ai: bool = Query(True, description="false = never call Gemini; return cached AI advice or rule-based advice"),
    refresh: bool = Query(False, description="ignore the cache and ask Gemini again"),
    db: Session = Depends(get_db),
):
    month = _month(month)
    # Full live context (history, weekly trend, merchants, budgets, latest slips): any newly saved slip
    # changes it, which changes the digest, so advice is regenerated from the up-to-date picture.
    stats = memory.build_context(db, month)
    digest = insights.stats_hash(stats)

    if not refresh:
        cached = db.query(AdviceCache).filter_by(month=month, stats_hash=digest).first()
        if cached:
            return _from_cache(cached)

    facts = insights.rule_based_tips(stats)
    now = datetime.now(timezone.utc)
    rules = AdviceOut(
        month=month,
        headline=insights.rule_based_headline(stats, facts),
        tips=facts,
        source="rules",
        generated_at=now,
    )
    if not ai or stats["total_spent"] == 0:
        return rules

    try:
        headline, tips = ai_service.generate_advice(stats, facts)
    except ai_service.AIServiceError as exc:
        rules.ai_error = str(exc)
        return rules

    payload = json.dumps({"headline": headline, "tips": [t.model_dump() for t in tips]})
    db.query(AdviceCache).filter_by(month=month, stats_hash=digest).delete()
    # keep the cache small: only the latest few entries per month are useful
    old = db.query(AdviceCache).filter_by(month=month).order_by(AdviceCache.id.desc()).offset(4).all()
    for row in old:
        db.delete(row)
    row = AdviceCache(month=month, stats_hash=digest, payload=payload, created_at=now)
    db.add(row)
    db.commit()
    return AdviceOut(month=month, headline=headline, tips=tips, source="ai", generated_at=now)


# ---------- chat ----------


@router.post("/assistant/chat", response_model=ChatReply)
def chat(body: ChatRequest, db: Session = Depends(get_db)):
    context = memory.build_context(db)
    try:
        reply = ai_service.chat(body.message, [m.model_dump() for m in body.history], context, memory.make_tools(db))
    except ai_service.AIServiceError as exc:
        raise HTTPException(502, str(exc)) from exc
    return ChatReply(reply=reply)
