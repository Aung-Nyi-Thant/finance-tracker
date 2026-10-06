"""Budgets, alerts, settings and the advice endpoint (rule-based fallback, AI path, caching)."""
import ai_service
import pytest
from models import Tip
from tests.conftest import add_tx


async def put_budget(client, category, limit):
    return await client.put(f"/api/budgets/{category}", json={"monthly_limit": limit})


# ------------------------------------------------------------------ budgets


async def test_budget_lifecycle(client):
    await add_tx(client, 105, "Nobu", "Food", days_ago=0)
    assert (await put_budget(client, "Food", 100)).status_code == 200
    assert (await put_budget(client, "Total", 150)).status_code == 200

    budgets = {b["category"]: b for b in (await client.get("/api/budgets")).json()}
    assert budgets["Food"]["spent"] == 105 and budgets["Food"]["status"] == "over" and budgets["Food"]["percent"] == 105.0
    assert (budgets["Total"]["percent"], budgets["Total"]["status"]) == (70.0, "ok")
    assert (await client.delete("/api/budgets/Food")).status_code == 204
    assert (await client.delete("/api/budgets/Food")).status_code == 404
    assert [b["category"] for b in (await client.get("/api/budgets")).json()] == ["Total"]


@pytest.mark.parametrize(
    ("category", "limit", "status"),
    [("Nope", 100, 422), ("Income", 100, 422), ("Food", 0, 422), ("Food", -5, 422), ("Food", 100, 200), ("Total", 5, 200)],
)
async def test_budget_validation(client, category, limit, status):
    assert (await put_budget(client, category, limit)).status_code == status


@pytest.mark.parametrize(("spent", "status"), [(50, "ok"), (79, "ok"), (80, "warning"), (99, "warning"), (100, "over"), (150, "over")])
async def test_budget_status_thresholds(client, spent, status):
    await add_tx(client, spent, "Shop", "Shopping", days_ago=0)
    await put_budget(client, "Shopping", 100)
    budget = (await client.get("/api/budgets")).json()[0]
    assert budget["status"] == status


async def test_putting_a_budget_twice_updates_it(client):
    await put_budget(client, "Food", 100)
    await put_budget(client, "Food", 250)
    budgets = (await client.get("/api/budgets")).json()
    assert [(b["category"], b["monthly_limit"]) for b in budgets] == [("Food", 250)]


# ------------------------------------------------------------------ settings


async def test_currency_setting_changes_alert_text(client):
    await add_tx(client, 120, "Nobu", "Food", days_ago=0)
    await put_budget(client, "Food", 100)

    assert (await client.get("/api/settings")).json() == {"currency": "THB"}  # default
    alerts = lambda: client.get("/api/summary")  # noqa: E731
    assert "฿" in (await alerts()).json()["alerts"][0]["message"]

    assert (await client.put("/api/settings", json={"currency": "eur"})).json() == {"currency": "EUR"}
    assert "€" in (await alerts()).json()["alerts"][0]["message"]
    assert (await client.put("/api/settings", json={"currency": "XXX"})).status_code == 422
    assert (await client.get("/api/settings")).json() == {"currency": "EUR"}


# ------------------------------------------------------------------ advice


async def test_advice_for_an_empty_account_is_friendly_and_free(client, gemini):
    advice = (await client.get("/api/assistant/advice")).json()
    assert advice["source"] == "rules" and "Nothing tracked" in advice["tips"][0]["title"]
    assert gemini.calls == []  # nothing to analyse, so no AI call


async def test_advice_falls_back_to_rules_when_the_ai_fails(client, gemini):
    await add_tx(client, 120, "Nobu", "Food", days_ago=0)
    await put_budget(client, "Food", 100)
    gemini.fail_with(RuntimeError("quota exceeded"))

    advice = (await client.get("/api/assistant/advice")).json()

    assert advice["source"] == "rules" and "quota exceeded" in advice["ai_error"]
    assert any(t["severity"] == "warning" and "budget" in t["title"].lower() for t in advice["tips"])


async def test_advice_ai_path_is_cached_until_spending_changes(client, mocker):
    await add_tx(client, 120, "Nobu", "Food", days_ago=0)
    generate = mocker.patch.object(ai_service, "generate_advice", return_value=("AI headline", [Tip(title="t", body="b", severity="info")]))

    first = (await client.get("/api/assistant/advice")).json()
    again = (await client.get("/api/assistant/advice")).json()
    assert first["source"] == again["source"] == "ai" and first["headline"] == "AI headline"
    assert generate.call_count == 1  # served from cache

    assert (await client.get("/api/assistant/advice", params={"ai": "false"})).json()["source"] == "ai"  # cache reused, no AI call
    assert generate.call_count == 1

    await client.get("/api/assistant/advice", params={"refresh": "true"})
    assert generate.call_count == 2  # explicit refresh

    await add_tx(client, 10, "New", "Food", days_ago=0)  # new slip => new snapshot => regenerated
    await client.get("/api/assistant/advice")
    assert generate.call_count == 3


async def test_advice_ai_false_never_calls_gemini(client, gemini):
    await add_tx(client, 120, "Nobu", "Food", days_ago=0)
    advice = (await client.get("/api/assistant/advice", params={"ai": "false"})).json()
    assert advice["source"] == "rules" and advice["ai_error"] is None
    assert gemini.calls == []


async def test_rule_based_week_over_week_tip_needs_a_real_previous_week(client):
    await add_tx(client, 300, "Nobu", "Food", days_ago=1)
    brand_new = (await client.get("/api/assistant/advice", params={"ai": "false"})).json()
    assert not any("this week" in t["title"] for t in brand_new["tips"])  # nothing to compare against yet

    await add_tx(client, 100, "Old", "Food", days_ago=9)
    compared = (await client.get("/api/assistant/advice", params={"ai": "false"})).json()
    assert any("this week" in t["title"] and "Food" == t["category"] for t in compared["tips"])


async def test_advice_for_a_past_month_does_not_say_this_month(client):
    await add_tx(client, 200, "Salary", "Income", on="2026-01-02")
    await add_tx(client, 100, "Cafe", "Food", on="2026-01-10")
    advice = (await client.get("/api/assistant/advice", params={"month": "2026-01", "ai": "false"})).json()
    text = " ".join(t["body"] for t in advice["tips"])
    assert "that month" in text and "this month" not in text
    empty = (await client.get("/api/assistant/advice", params={"month": "2020-01", "ai": "false"})).json()
    assert "Nothing tracked" in empty["tips"][0]["title"]
