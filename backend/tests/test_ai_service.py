"""Unit tests for ai_service: Gemini is faked, so these check OUR parsing, validation and prompts."""
import json
from datetime import date

import pytest

import ai_service
from ai_service import AIServiceError, NotAReceiptError
from models import CATEGORIES, ParsedReceipt, Tip
from tests.conftest import PNG, receipt_json

pytestmark = pytest.mark.usefixtures("gemini")


# ------------------------------------------------------------ extract_receipt


def test_extract_receipt_returns_the_four_required_fields(gemini):
    gemini.queue(receipt_json(amount=123.45, merchant_name="7-Eleven", category="Groceries", transaction_date="2026-10-05"))

    parsed = ai_service.extract_receipt(PNG, "image/png")

    assert isinstance(parsed, ParsedReceipt)
    assert set(parsed.model_dump()) == {"amount", "merchant_name", "category", "transaction_date"}
    assert parsed.amount == 123.45
    assert parsed.merchant_name == "7-Eleven"
    assert parsed.category == "Groceries"
    assert parsed.transaction_date == "2026-10-05"


def test_image_bytes_and_strict_json_settings_are_sent_to_gemini(gemini):
    ai_service.extract_receipt(PNG, "image/png")

    call = gemini.last
    image_part, prompt = call.contents
    assert image_part.inline_data.data == PNG  # the raw bytes, in memory, no file involved
    assert image_part.inline_data.mime_type == "image/png"
    assert all(category in prompt for category in CATEGORIES)  # model is told the allowed categories
    assert date.today().isoformat() in prompt  # ...and today's date, as the fallback
    assert call.config.response_mime_type == "application/json"
    assert call.config.temperature == 0
    schema = call.config.response_schema.model_json_schema()
    assert {"is_receipt", "amount", "merchant_name", "category", "transaction_date"} <= set(schema["properties"])


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Food", "Food"),
        ("food", "Food"),
        ("  GROCERIES ", "Groceries"),
        ("Spaceships", "Other"),
        ("", "Other"),
        (None, "Other"),
    ],
)
def test_category_is_normalised_to_a_known_value(gemini, raw, expected):
    gemini.queue(receipt_json(category=raw))
    assert ai_service.extract_receipt(PNG, "image/png").category == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("2026-10-05", "2026-10-05"),
        ("2026/10/05", "2026-10-05"),
        ("Oct 5, 2026", "2026-10-05"),
        ("5 Oct 2026", "2026-10-05"),
        ("10/25/2026", "2026-10-25"),
    ],
)
def test_date_formats_are_converted_to_iso(gemini, raw, expected):
    gemini.queue(receipt_json(transaction_date=raw))
    assert ai_service.extract_receipt(PNG, "image/png").transaction_date == expected


@pytest.mark.parametrize("raw", ["not a date", "", None, "2026-13-45"])
def test_unreadable_date_falls_back_to_today(gemini, raw):
    gemini.queue(receipt_json(transaction_date=raw))
    assert ai_service.extract_receipt(PNG, "image/png").transaction_date == date.today().isoformat()


@pytest.mark.parametrize(
    ("raw", "expected"),
    [(42, 42.0), (12.345, 12.35), ("฿1,234.50", 1234.5), ("$ 9.99", 9.99), ("7", 7.0)],
)
def test_amount_is_parsed_from_numbers_and_currency_strings(gemini, raw, expected):
    gemini.queue(receipt_json(amount=raw))
    assert ai_service.extract_receipt(PNG, "image/png").amount == expected


@pytest.mark.parametrize("raw", [None, "", "free"])
def test_missing_or_unreadable_amount_is_an_error(gemini, raw):
    gemini.queue(receipt_json(amount=raw))
    with pytest.raises(AIServiceError, match="total amount"):
        ai_service.extract_receipt(PNG, "image/png")


def test_blank_merchant_gets_a_placeholder(gemini):
    gemini.queue(receipt_json(merchant_name="   "))
    assert ai_service.extract_receipt(PNG, "image/png").merchant_name == "Unknown merchant"


def test_non_receipt_images_are_rejected(gemini):
    gemini.queue(receipt_json(is_receipt=False))
    with pytest.raises(NotAReceiptError):
        ai_service.extract_receipt(PNG, "image/png")


@pytest.mark.parametrize(
    ("response", "message"),
    [("this is not json", "malformed JSON"), ("[1, 2, 3]", "unexpected response shape")],
)
def test_bad_model_output_becomes_a_clear_error(gemini, response, message):
    gemini.queue(response)
    with pytest.raises(AIServiceError, match=message):
        ai_service.extract_receipt(PNG, "image/png")


def test_api_failures_are_wrapped(gemini):
    gemini.fail_with(RuntimeError("429 quota exceeded"))
    with pytest.raises(AIServiceError, match="Gemini request failed: 429 quota exceeded"):
        ai_service.extract_receipt(PNG, "image/png")


def test_missing_api_key_is_reported(mocker, monkeypatch):
    mocker.stopall()  # use the real _client()
    monkeypatch.setenv("GEMINI_API_KEY", "")
    with pytest.raises(AIServiceError, match="GEMINI_API_KEY is not set"):
        ai_service.extract_receipt(PNG, "image/png")


# ------------------------------------------------------------ generate_advice


def _advice(**tip_overrides):
    tip = {"title": "Cut back on dining", "body": "You spent a lot on food.", "severity": "warning", "category": "food"}
    tip.update(tip_overrides)
    return json.dumps({"headline": "Dining is your biggest spend", "tips": [tip]})


FACTS = [Tip(title="Over budget", body="Food is over.", severity="warning", category="Food")]
CONTEXT = {"currency": "THB", "total_spent": 100}


def test_advice_is_parsed_and_normalised(gemini):
    gemini.queue(_advice())
    headline, tips = ai_service.generate_advice(CONTEXT, FACTS)

    assert headline == "Dining is your biggest spend"
    assert tips == [Tip(title="Cut back on dining", body="You spent a lot on food.", severity="warning", category="Food")]


def test_advice_prompt_contains_the_stats_and_facts(gemini):
    gemini.queue(_advice())
    ai_service.generate_advice({"currency": "THB", "merchant_in_context": "มาม่า"}, FACTS)

    prompt = gemini.last.contents
    assert "THB" in prompt and "Food is over." in prompt
    assert "มาม่า" in prompt  # non-ASCII text goes through as text, not \u escapes


@pytest.mark.parametrize("overrides", [{"severity": "catastrophic"}, {"severity": None}])
def test_unknown_severity_defaults_to_info(gemini, overrides):
    gemini.queue(_advice(**overrides))
    assert ai_service.generate_advice(CONTEXT, FACTS)[1][0].severity == "info"


def test_empty_category_means_a_general_tip(gemini):
    gemini.queue(_advice(category=""))
    assert ai_service.generate_advice(CONTEXT, FACTS)[1][0].category is None


def test_advice_drops_unusable_tips_and_fails_when_none_remain(gemini):
    gemini.queue(json.dumps({"headline": "h", "tips": [{"title": "", "body": "x"}, {"title": "t"}]}))
    with pytest.raises(AIServiceError, match="no usable tips"):
        ai_service.generate_advice(CONTEXT, FACTS)


@pytest.mark.parametrize("payload", [{"headline": "", "tips": []}, {"tips": [{"title": "t", "body": "b"}]}, []])
def test_empty_advice_is_an_error(gemini, payload):
    gemini.queue(json.dumps(payload))
    with pytest.raises(AIServiceError):
        ai_service.generate_advice(CONTEXT, FACTS)


# ------------------------------------------------------------ chat


def test_chat_puts_the_context_in_the_system_prompt(gemini):
    gemini.queue("You spent ฿520 on food.")
    context = {"currency": "THB", "today": "2026-10-06", "month": "2026-10", "top_merchants_last_90_days": [{"merchant": "Som Tam Nua", "total": 520}]}
    tools = [lambda: None]

    reply = ai_service.chat("How much on food?", [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}], context, tools)

    assert reply == "You spent ฿520 on food."
    system = gemini.last.config.system_instruction
    assert "Som Tam Nua" in system and "520" in system  # the user's history is in the prompt
    assert "Today is 2026-10-06" in system and "2026-10" in system
    assert "never ask them to tell you what they bought" in system.lower()
    assert gemini.last.config.tools == tools
    roles = [c.role for c in gemini.last.contents]
    assert roles == ["user", "model", "user"]  # prior turns + the new question
    assert gemini.last.contents[-1].parts[0].text == "How much on food?"


def test_chat_only_sends_the_last_ten_turns(gemini):
    history = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"m{i}"} for i in range(30)]
    ai_service.chat("now", history, {"currency": "THB"}, [])
    assert len(gemini.last.contents) == 11


def test_empty_chat_answer_is_an_error(gemini):
    gemini.queue("   ")
    with pytest.raises(AIServiceError, match="empty answer"):
        ai_service.chat("hi", [], {"currency": "THB"}, [])


def test_chat_api_failure_is_wrapped(gemini):
    gemini.fail_with(ConnectionError("offline"))
    with pytest.raises(AIServiceError, match="offline"):
        ai_service.chat("hi", [], {"currency": "THB"}, [])
