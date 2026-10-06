"""Editing and deleting saved slips, and browsing a single month."""
from datetime import date

from models import Transaction
from tests.conftest import add_tx, day


# ------------------------------------------------------------------ edit


async def test_editing_a_saved_slip_changes_only_the_fields_sent(client):
    slip = await add_tx(client, 100, "Cafe", "Food", on="2026-03-10")

    response = await client.patch(f"/api/transactions/{slip['id']}", json={"amount": 120.5, "category": "Groceries"})

    assert response.status_code == 200
    body = response.json()
    assert (body["amount"], body["category"], body["merchant_name"], body["transaction_date"]) == (120.5, "Groceries", "Cafe", "2026-03-10")
    assert body["status"] == "confirmed" and body["impact"]["category"] == "Groceries"
    listed = (await client.get("/api/transactions")).json()
    assert [(t["amount"], t["category"]) for t in listed] == [(120.5, "Groceries")]


async def test_all_four_fields_can_be_edited_and_the_summaries_follow(client):
    slip = await add_tx(client, 100, "Cafe", "Food", on="2026-03-10")
    await client.patch(f"/api/transactions/{slip['id']}", json={"merchant_name": " Cafe Amazon ", "transaction_date": "2026-04-02", "amount": 250})

    assert (await client.get("/api/summary", params={"month": "2026-03"})).json()["total_spent"] == 0  # moved out of March
    april = (await client.get("/api/summary", params={"month": "2026-04"})).json()
    assert april["total_spent"] == 250
    assert (await client.get("/api/transactions")).json()[0]["merchant_name"] == "Cafe Amazon"


async def test_edits_are_validated(client):
    slip = await add_tx(client, 100, "Cafe", "Food", on="2026-03-10")
    url = f"/api/transactions/{slip['id']}"
    for bad in ({"amount": 0}, {"amount": -5}, {"category": "Nope"}, {"transaction_date": "2026-02-30"}, {"transaction_date": "10/03/2026"}, {"merchant_name": ""}, {}):
        assert (await client.patch(url, json=bad)).status_code == 422, bad
    assert (await client.patch("/api/transactions/9999", json={"amount": 5})).status_code == 404
    assert (await client.get("/api/transactions")).json()[0]["amount"] == 100  # nothing changed


async def test_editing_into_an_over_budget_month_reports_the_impact(client):
    await client.put("/api/budgets/Food", json={"monthly_limit": 100})
    slip = await add_tx(client, 50, "Cafe", "Food", days_ago=0)
    impact = (await client.patch(f"/api/transactions/{slip['id']}", json={"amount": 150})).json()["impact"]
    assert impact["status"] == "over" and "Over budget" in impact["message"]


# ------------------------------------------------------------------ delete


async def test_deleting_a_saved_slip_removes_it_from_everything(client, db):
    keep = await add_tx(client, 40, "Keep", "Food", on="2026-03-10")
    gone = await add_tx(client, 60, "Gone", "Food", on="2026-03-11")

    assert (await client.delete(f"/api/transactions/{gone['id']}")).status_code == 204

    assert [t["id"] for t in (await client.get("/api/transactions")).json()] == [keep["id"]]
    assert (await client.get("/api/summary", params={"month": "2026-03"})).json()["total_spent"] == 40
    assert db.query(Transaction).count() == 1
    assert (await client.delete(f"/api/transactions/{gone['id']}")).status_code == 404


# ------------------------------------------------------------------ months


async def test_transactions_can_be_listed_for_one_month(client):
    await add_tx(client, 10, "Jan A", "Food", on="2026-01-05")
    await add_tx(client, 20, "Jan B", "Food", on="2026-01-31")
    await add_tx(client, 30, "Feb", "Food", on="2026-02-01")
    await add_tx(client, 40, "Dec", "Food", on="2025-12-31")

    january = (await client.get("/api/transactions", params={"month": "2026-01"})).json()
    assert [t["merchant_name"] for t in january] == ["Jan B", "Jan A"]
    assert [t["merchant_name"] for t in (await client.get("/api/transactions", params={"month": "2026-02"})).json()] == ["Feb"]
    assert (await client.get("/api/transactions", params={"month": "2020-06"})).json() == []
    assert len((await client.get("/api/transactions")).json()) == 4  # no month = everything
    for bad in ("2026-13", "2026-1", "January", "2026-00"):
        assert (await client.get("/api/transactions", params={"month": bad})).status_code == 422, bad


async def test_search_stays_inside_the_month_being_viewed(client):
    await add_tx(client, 100, "Cafe Amazon", "Food", on="2026-01-05")
    await add_tx(client, 200, "Cafe Amazon", "Food", on="2026-02-05")

    async def names(**params):
        r = await client.get("/api/transactions/search", params=params)
        return [(t["transaction_date"]) for t in r.json()["results"]]

    assert await names(q="cafe", month="2026-01") == ["2026-01-05"]
    assert await names(q="cafe", month="2026-02") == ["2026-02-05"]
    assert len(await names(q="cafe")) == 2  # no month: all of history
    assert await names(q="cafe 2026-02", month="2026-01") == ["2026-02-05"]  # a date typed in the query wins over the screen's month


async def test_past_month_budgets_show_that_months_spending(client):
    await add_tx(client, 80, "Old", "Food", on="2026-01-10")
    await client.put("/api/budgets/Food", json={"monthly_limit": 100})
    january = {b["category"]: b for b in (await client.get("/api/budgets", params={"month": "2026-01"})).json()}
    assert (january["Food"]["spent"], january["Food"]["status"]) == (80, "warning")
    assert (await client.get("/api/budgets", params={"month": day(0)[:7]})).json()[0]["spent"] == 0
