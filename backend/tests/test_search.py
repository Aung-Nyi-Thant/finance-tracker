"""Smart search: the query parser (pure) and the endpoint."""
from datetime import date

import pytest

import search
from tests.conftest import add_tx

TODAY = date(2026, 10, 15)


def parse(q):
    return search.parse_query(q, TODAY)


def test_category_amount_and_relative_month():
    p = parse("food over 200 last month")
    assert p.category == "Food" and p.min_amount > 200 and not p.terms
    assert (p.date_from, p.date_to) == (date(2026, 9, 1), date(2026, 9, 30))


def test_merchant_text_comparator_and_month_name():
    p = parse("uber >500 august")
    assert p.terms == ["uber"] and p.min_amount > 500
    assert (p.date_from, p.date_to) == (date(2026, 8, 1), date(2026, 8, 31))


def test_a_month_later_than_today_means_last_year():
    assert parse("december").date_from == date(2025, 12, 1)


def test_category_alias_k_suffix_and_this_week():
    p = parse("games under 1.5k this week")
    assert p.category == "Entertainment" and p.max_amount < 1500
    assert (p.date_from, p.date_to) == (date(2026, 10, 9), TODAY)


@pytest.mark.parametrize(
    ("query", "low", "high"),
    [
        ("more than 100 less than 300", 100.005, 299.995),
        (">= 99 <= 120", 99, 120),
        ("฿85", 84.995, 85.005),
        ("over 50", 50.005, None),
        ("under 50", None, 49.995),
    ],
)
def test_amount_expressions(query, low, high):
    p = parse(query)
    assert (p.min_amount, p.max_amount) == (low, high)


def test_burmese_digits_words_and_categories():
    p = parse("၂၀၀၀ ဒီလ အစားအသောက်")
    assert p.category == "Food" and 1999 < p.min_amount < 2001
    assert (p.date_from, p.date_to) == (date(2026, 10, 1), TODAY)


def test_dates_merchants_with_digits_and_empty_queries():
    assert parse("7-eleven yesterday").terms == ["7-eleven"]
    assert parse("7-eleven yesterday").date_from == date(2026, 10, 14)
    assert parse("2026-09").date_from == date(2026, 9, 1)
    assert parse("2026-09-03").date_to == date(2026, 9, 3)
    empty = parse("")
    assert not empty.notes and not empty.terms and empty.category is None


@pytest.fixture
async def shop(client):
    await add_tx(client, 250, "Nobu", "Food", days_ago=1)
    await add_tx(client, 85, "Cafe Amazon", "Food", days_ago=2)
    await add_tx(client, 520, "Uber", "Transport", days_ago=3)
    await add_tx(client, 299, "Steam", "Entertainment", days_ago=0)
    await add_tx(client, 1250, "မုန့်ဟင်းခါးဆိုင်", "Food", days_ago=4)


async def names(client, q, **params):
    response = await client.get("/api/transactions/search", params={"q": q, **params})
    assert response.status_code == 200, response.text
    return [t["merchant_name"] for t in response.json()["results"]], response.json()["interpretation"]


async def test_search_endpoint(shop, client):
    found, why = await names(client, "food over 200")
    assert set(found) == {"Nobu", "မုန့်ဟင်းခါးဆိုင်"} and "Food" in why and "over 200" in why
    assert (await names(client, "uber"))[0] == ["Uber"]
    assert (await names(client, "CAFE"))[0] == ["Cafe Amazon"]  # case-insensitive
    assert (await names(client, "games"))[0] == ["Steam"]
    assert (await names(client, "85"))[0] == ["Cafe Amazon"]  # exact amount
    assert (await names(client, "today"))[0] == ["Steam"]
    assert (await names(client, "nothing matches this"))[0] == []


async def test_search_in_burmese(shop, client):
    assert (await names(client, "အစားအသောက်"))[0] == ["Nobu", "Cafe Amazon", "မုန့်ဟင်းခါးဆိုင်"]
    assert (await names(client, "မုန့်ဟင်း"))[0] == ["မုန့်ဟင်းခါးဆိုင်"]


async def test_category_param_is_an_explicit_filter(shop, client):
    assert (await names(client, "", category="Transport"))[0] == ["Uber"]
    assert (await names(client, "over 100", category="food"))[0] == ["Nobu", "မုန့်ဟင်းခါးဆိုင်"]


async def test_empty_query_lists_everything_newest_first_and_respects_limit(shop, client):
    everything, _ = await names(client, "")
    assert everything[0] == "Steam" and len(everything) == 5
    assert len((await names(client, "", limit=2))[0]) == 2


async def test_pending_slips_are_not_searchable_and_long_queries_are_rejected(shop, client, db):
    from models import Transaction

    db.add(Transaction(amount=1, merchant_name="Hidden", category="Food", transaction_date=date.today().isoformat(), status="pending"))
    db.commit()
    assert (await names(client, "hidden"))[0] == []
    assert (await client.get("/api/transactions/search", params={"q": "x" * 300})).status_code == 422
