"""The assistant's live memory: context, query tools and the budget impact of a freshly saved slip."""
import pytest
from google import genai
from google.genai import types

import memory
from tests.conftest import add_tx, day


@pytest.fixture
async def history(client):
    """A realistic few weeks, all within the last 40 days so month boundaries don't matter."""
    await add_tx(client, 100, "Nobu", "Food", days_ago=2)
    await add_tx(client, 40, "Starbucks", "Food", days_ago=9)
    await add_tx(client, 60, "Starbucks", "Food", days_ago=11)
    await add_tx(client, 300, "Omakase", "Food", days_ago=40)
    await add_tx(client, 80, "Tops", "Groceries", days_ago=1)
    await add_tx(client, 30, "Steam", "Entertainment", days_ago=4)
    await add_tx(client, 5000, "Salary", "Income", days_ago=1)
    await client.put("/api/budgets/Total", json={"monthly_limit": 1000})
    await client.put("/api/budgets/Entertainment", json={"monthly_limit": 200})


async def test_context_carries_the_whole_picture(history, db):
    ctx = memory.build_context(db)

    assert {"monthly_history", "weekly_spending_recent_first", "top_merchants_last_90_days", "affordability", "recent_transactions", "data_range", "categories", "budgets", "currency", "today"} <= set(ctx)
    months = ctx["monthly_history"]
    assert len(months) == 6 and months[-1]["month"] == day(0)[:7]
    assert round(sum(m["total_spent"] for m in months), 2) == 610  # 100+40+60+300+80+30
    assert sum(m["income"] for m in months) == 5000
    assert ctx["data_range"] == {"first_transaction": day(40), "last_transaction": day(1), "confirmed_transactions": 7}
    assert ctx["top_merchants_last_90_days"][0]["merchant"] == "Omakase"
    assert ctx["recent_transactions"][0]["date"] == day(1)


async def test_weekly_trend_uses_rolling_seven_day_windows(history, db):
    weeks = memory.build_context(db)["weekly_spending_recent_first"]
    assert weeks[0]["total_spent"] == 210 and weeks[0]["by_category"] == {"Food": 100, "Groceries": 80, "Entertainment": 30}  # income excluded
    assert weeks[1]["total_spent"] == 100 and weeks[1]["by_category"] == {"Food": 100}  # 40 + 60 the week before


async def test_affordability_numbers_are_precomputed(history, db):
    ctx = memory.build_context(db)
    aff = ctx["affordability"]
    assert aff["total_budget_remaining"] == round(1000 - ctx["total_spent"], 2)
    assert aff["category_budget_remaining"] == {"Entertainment": 170}
    assert aff["income_minus_spent_this_month"] == round(ctx["income"] - ctx["total_spent"], 2)
    assert aff["days_left_in_month_including_today"] >= 1


async def test_spending_tool_answers_food_this_week_vs_the_week_before(history, db):
    get_spending, _ = memory.make_tools(db)
    this_week = get_spending(day(6), day(0), "Food")
    last_week = get_spending(day(13), day(7), "dining")  # alias
    assert (this_week["total"], this_week["transaction_count"]) == (100, 1)
    assert (last_week["total"], last_week["transaction_count"], last_week["category"]) == (100, 2, "Food")
    assert this_week["currency"] == "THB" and this_week["top_merchants"][0]["merchant"] == "Nobu"


async def test_spending_tool_filters(history, db):
    get_spending, _ = memory.make_tools(db)
    everything = get_spending(day(6), day(0))
    assert everything["total"] == 210 and "Income" not in everything["by_category"]
    assert get_spending(day(6), day(0), "Income")["total"] == 5000
    assert get_spending(day(0), day(6), "Food")["total"] == 100  # reversed range is swapped
    starbucks = get_spending(day(60), day(0), merchant="starbucks")
    assert (starbucks["total"], starbucks["transaction_count"]) == (100, 2)
    assert get_spending(day(60), day(0), "games")["category"] == "Entertainment"


async def test_spending_tool_rejects_bad_input(history, db):
    get_spending, list_transactions = memory.make_tools(db)
    assert "Unknown category" in get_spending(day(6), day(0), "Spaceships")["error"]
    assert "YYYY-MM-DD" in get_spending("yesterday", "today")["error"]
    assert "too large" in get_spending("1900-01-01", "2026-01-01")["error"]
    assert "error" in list_transactions("nope", "nope")


async def test_list_tool_returns_newest_first_and_caps_rows(history, db):
    _, list_transactions = memory.make_tools(db)
    rows = list_transactions(day(60), day(0), "Food", limit=2)["transactions"]
    assert [r["merchant"] for r in rows] == ["Nobu", "Starbucks"]
    assert len(list_transactions(day(60), day(0), limit=999)["transactions"]) == 6  # 6 spending rows exist (income excluded)


async def test_tool_signatures_are_valid_for_the_gemini_sdk(history, db):
    tools = memory.make_tools(db)
    client = genai.Client(api_key="unused")
    for fn in tools:
        declaration = types.FunctionDeclaration.from_callable(client=client, callable=fn)
        assert declaration.name == fn.__name__ and declaration.description
        assert {"start_date", "end_date"} <= set(declaration.parameters.properties)
    types.GenerateContentConfig(tools=tools, automatic_function_calling=types.AutomaticFunctionCallingConfig(maximum_remote_calls=6))


async def test_saving_a_slip_reports_its_budget_impact(client, history):
    first = await add_tx(client, 50, "Steam", "Entertainment", days_ago=0)
    impact = first["impact"]
    assert (impact["category"], impact["category_budget"], impact["status"]) == ("Entertainment", 200, "ok")
    assert "Games" in impact["message"] and "%" in impact["message"] and impact["total_budget"] == 1000

    over = (await add_tx(client, 200, "Steam", "Entertainment", days_ago=0))["impact"]
    assert over["status"] == "over" and "Over budget" in over["message"]

    no_category_budget = (await add_tx(client, 25, "Grab", "Transport", days_ago=0))["impact"]
    assert "This month" in no_category_budget["message"]


async def test_the_gemini_sdk_can_actually_run_the_tools(history, db):
    """Regression: with string annotations the SDK's own invoker failed ("isinstance() arg 2 must be a type"),
    so every real tool call errored. Describing a tool is not enough; run it the way the SDK does."""
    from google.genai import _extra_utils

    get_spending, list_transactions = memory.make_tools(db)
    for fn in (get_spending, list_transactions):
        assert all(not isinstance(a, str) for a in fn.__annotations__.values()), fn.__name__

    result = _extra_utils.invoke_function_from_dict_args(
        {"start_date": day(6), "end_date": day(0), "category": "Food"}, get_spending
    )
    assert "error" not in result and result["total"] == 100 and result["category"] == "Food"

    listing = _extra_utils.invoke_function_from_dict_args(
        {"start_date": day(60), "end_date": day(0), "merchant": "starbucks", "limit": 5}, list_transactions
    )
    assert [r["merchant"] for r in listing["transactions"]] == ["Starbucks", "Starbucks"]
