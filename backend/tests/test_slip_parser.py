"""Slip parsing from on-device OCR text. Fixtures are the real Apple Vision output for two Bangkok Bank slips."""
import pytest

from slip_parser import parse_slip, slip_fingerprint

SLIP_PERSON = [
    "Bangkok Bank", "Transaction successful", "07 Oct 26, 17:10", "Amount", "35.00 THB", "From", "To",
    "MR. AUNG NYI NYI THANT", "672-0-xxx086", "Bangkok Bank", "WILAIWAN TREETHAWAT", "1-4106-0xxxx-41-5",
    "PromptPay", "Fee", "0.00 THB", "Bank reference no.", "370575", "Transaction reference",
    "2026100717105324009619408", "Scan to verify",
]

SLIP_WALLET = [
    "Bangkok Bank", "Transaction successful", "07 Oct 26, 17:14", "Amount", "60.00 THB", "From",
    "MR. AUNG NYI NYI THANT", "672-0-xxx086", "Bangkok Bank", "To", "MR. aya mayerk", "PromptPay Top up /",
    "G-Wallet", "K Plus Wallet", "e-wallet number", "00499-900-984-0686", "Fee", "0.00 THB",
    "Bank reference no.", "427256", "Transaction reference", "2026100717140023006016008", "Scan to verify",
]


def test_person_to_person_transfer():
    slip = parse_slip(SLIP_PERSON)
    assert slip.model_dump() == {
        "amount": 35.0, "merchant_name": "Wilaiwan Treethawat", "category": "Other", "transaction_date": "2026-10-07",
    }


def test_wallet_top_up_where_the_to_label_comes_after_the_sender():
    slip = parse_slip(SLIP_WALLET)
    assert slip.amount == 60.0
    assert slip.merchant_name == "aya mayerk"  # title stripped, mixed case left alone
    assert slip.transaction_date == "2026-10-07"


def test_the_fee_is_never_mistaken_for_the_amount():
    lines = [x for x in SLIP_PERSON if x != "Amount"]  # no label: fall back to the first non-fee THB figure
    assert parse_slip(lines).amount == 35.0


def test_amount_with_thousands_separator():
    lines = ["Amount", "12,345.50 THB"] + SLIP_PERSON[2:3]
    assert parse_slip(lines).amount == 12345.5


@pytest.mark.parametrize("raw,expected", [
    ("07 Oct 26, 17:10", "2026-10-07"),
    ("7 October 2026", "2026-10-07"),
    ("01 Jan 2569", "2026-01-01"),  # Buddhist Era
])
def test_date_formats(raw, expected):
    assert parse_slip(["Amount", "1.00 THB", raw]).transaction_date == expected


@pytest.mark.parametrize("recipient,category", [
    ("Starbucks Thailand", "Food"),
    ("7-Eleven Sukhumvit", "Groceries"),
    ("Grab Thailand", "Transport"),
    ("AIS Fibre", "Bills"),
    ("Bumrungrad Hospital", "Health"),
    ("Netflix", "Entertainment"),
    ("Shopee Thailand", "Shopping"),
    ("Somchai Teaprasert", "Other"),  # "tea" inside a name must not make it Food
])
def test_category_rules_use_whole_words_in_the_recipient_block_only(recipient, category):
    lines = ["Amount", "100.00 THB", "07 Oct 26, 10:00", "From", "MR. A B", "672-0-xxx086", "Bangkok Bank",
             "To", recipient, "PromptPay", "Fee", "0.00 THB"]
    assert parse_slip(lines).category == category


@pytest.mark.parametrize("lines", [
    [],
    ["Hello", "World"],
    ["Amount", "35.00 THB"],  # no date
    ["07 Oct 26, 17:10", "Transaction successful"],  # no amount
    ["IMG_1234", "Sunset at the beach"],
])
def test_not_a_slip_returns_none(lines):
    assert parse_slip(lines) is None


def test_fingerprint_uses_the_bank_reference_so_reordered_text_still_dedupes():
    shuffled = list(reversed(SLIP_PERSON[:15])) + SLIP_PERSON[15:]
    assert slip_fingerprint(SLIP_PERSON) == slip_fingerprint(SLIP_PERSON)
    assert slip_fingerprint(SLIP_PERSON) != slip_fingerprint(SLIP_WALLET)
    assert slip_fingerprint(shuffled) == slip_fingerprint(SLIP_PERSON)


def test_fingerprint_without_a_reference_falls_back_to_the_text():
    a, b = ["Amount", "1.00 THB"], ["Amount", "2.00 THB"]
    assert slip_fingerprint(a).startswith("slip:") and slip_fingerprint(a) != slip_fingerprint(b)
