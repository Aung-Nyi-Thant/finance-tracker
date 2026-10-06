"""Retries, model fallback, cooldowns, friendly errors and markdown stripping around the Gemini calls."""
import json

import httpx
import pytest
from google.genai import errors

import ai_service
from ai_service import AIServiceError
from tests.conftest import PNG, receipt_json


def server_error(code=503):
    return errors.ServerError(code, {"error": {"message": "This model is currently experiencing high demand.", "status": "UNAVAILABLE"}})


def daily_quota_error(retry_seconds=22108):
    return errors.ClientError(
        429,
        {"error": {"message": "You exceeded your current quota. Quota exceeded for metric: free_tier_requests, limit: 20",
                   "status": "RESOURCE_EXHAUSTED",
                   "details": [{"@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]},
                               {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": f"{retry_seconds}s"}]}},
    )


def per_minute_error(retry_seconds=20):
    return errors.ClientError(
        429,
        {"error": {"message": "Rate limit", "status": "RESOURCE_EXHAUSTED",
                   "details": [{"@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": [{"quotaId": "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]},
                               {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": f"{retry_seconds}s"}]}},
    )


def not_found_error():
    return errors.ClientError(404, {"error": {"message": "This model is no longer available to new users.", "status": "NOT_FOUND"}})


def bad_key_error():
    return errors.ClientError(403, {"error": {"message": "API key not valid. Please pass a valid API key.", "status": "PERMISSION_DENIED"}})


PRIMARY, SECOND, THIRD = "gemini-flash-latest", "gemini-3.7-flash", "gemini-3.6-flash"


def extract():
    return ai_service.extract_receipt(PNG, "image/png")


# ------------------------------------------------------------------ retries on the same model


def test_a_single_overload_is_retried_transparently(gemini):
    gemini.queue(server_error()).queue(receipt_json(amount=77))
    assert extract().amount == 77
    assert gemini.models_called == [PRIMARY, PRIMARY]


def test_per_minute_rate_limit_waits_then_retries(gemini, mocker):
    sleeps = mocker.patch.object(ai_service, "_sleep")
    gemini.queue(per_minute_error(retry_seconds=20)).queue(receipt_json())
    extract()
    assert gemini.models_called == [PRIMARY, PRIMARY]
    sleeps.assert_called_once_with(10.0)  # the server asked for 20s; we cap the wait so the phone isn't kept waiting


# ------------------------------------------------------------------ fallback models


def test_persistent_overload_falls_back_to_the_next_model(gemini):
    gemini.queue_for(PRIMARY, server_error(), server_error()).queue_for(SECOND, receipt_json(amount=5))
    assert extract().amount == 5
    assert gemini.models_called == [PRIMARY, PRIMARY, SECOND]


def test_a_failing_model_is_skipped_for_a_while(gemini):
    gemini.queue_for(PRIMARY, server_error(), server_error())
    extract()
    gemini.calls.clear()
    extract()
    assert gemini.models_called == [SECOND]  # no wasted attempt on the model that just failed


def test_daily_quota_moves_on_immediately_and_is_remembered(gemini):
    gemini.queue_for(PRIMARY, daily_quota_error())
    extract()
    assert gemini.models_called == [PRIMARY, SECOND]  # no pointless retry of an exhausted model
    assert ai_service._cooldown[PRIMARY][0] > ai_service.time.time() + 20000  # honours the 22108s retry hint
    assert ai_service._cooldown[PRIMARY][1] == "daily_quota"

    gemini.calls.clear()
    extract()
    assert gemini.models_called == [SECOND]


def test_model_not_offered_to_the_key_is_skipped_for_a_day(gemini):
    gemini.queue_for(PRIMARY, not_found_error())
    extract()
    assert gemini.models_called == [PRIMARY, SECOND]
    assert ai_service._cooldown[PRIMARY][0] > ai_service.time.time() + 80000


def test_every_model_out_of_daily_quota_gives_a_clear_message_then_stops_calling(gemini):
    for model in ai_service._model_chain():
        gemini.queue_for(model, daily_quota_error(7200))

    with pytest.raises(AIServiceError, match="free daily limit is used up.*resets in about 1h"):
        extract()
    calls = len(gemini.calls)
    assert calls == len(ai_service._model_chain())  # exactly one try per model

    with pytest.raises(AIServiceError, match="free daily limit is used up"):
        extract()
    assert len(gemini.calls) == calls  # all models cooling down: zero further requests


def test_models_that_were_briefly_busy_are_not_reported_as_out_of_quota(gemini):
    gemini.fail_with(server_error())
    with pytest.raises(AIServiceError, match="busy"):
        extract()  # every model now has a 30-second "busy" cooldown
    calls = len(gemini.calls)
    with pytest.raises(AIServiceError, match="busy right now") as info:
        extract()
    assert "daily limit" not in str(info.value)
    assert len(gemini.calls) == calls  # still no requests while they cool down


def test_all_models_overloaded_gives_a_friendly_message(gemini):
    gemini.fail_with(server_error())
    with pytest.raises(AIServiceError, match="Gemini is busy right now. Please try again in a minute"):
        extract()
    assert set(gemini.models_called) == set(ai_service._model_chain())


# ------------------------------------------------------------------ errors that must NOT trigger fallback


def test_a_bad_api_key_fails_fast_without_trying_other_models(gemini):
    gemini.fail_with(bad_key_error())
    with pytest.raises(AIServiceError, match="Gemini request failed: .*API key not valid"):
        extract()
    assert len(gemini.calls) == 1


def test_no_internet_is_retried_once_then_reported_without_cycling_models(gemini):
    gemini.fail_with(httpx.ConnectError("offline"))
    with pytest.raises(AIServiceError, match="Can't reach Gemini.*offline"):
        extract()
    assert gemini.models_called == [PRIMARY, PRIMARY]


def test_the_total_wait_is_bounded(gemini, monkeypatch):
    monkeypatch.setattr(ai_service, "DEADLINE_SECONDS", 0)  # out of time immediately
    gemini.fail_with(server_error())
    with pytest.raises(AIServiceError, match="busy"):
        extract()
    assert len(gemini.calls) == 1  # one try on one model, then give up instead of cycling through all of them


# ------------------------------------------------------------------ configuration


def test_model_order_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "my-model")
    monkeypatch.setenv("GEMINI_FALLBACK_MODELS", " a , b ,my-model, ,a")
    assert ai_service._model_chain() == ["my-model", "a", "b"]  # trimmed, de-duplicated, primary first


def test_defaults_start_with_the_latest_alias():
    assert ai_service._model_chain()[0] == "gemini-flash-latest"
    assert len(ai_service._model_chain()) >= 3


# ------------------------------------------------------------------ every Gemini feature is covered


@pytest.mark.parametrize("feature", ["receipt", "advice", "chat"])
def test_each_feature_recovers_from_an_overload(gemini, feature):
    advice = json.dumps({"headline": "H", "tips": [{"title": "T", "body": "B", "severity": "info", "category": ""}]})
    ok = {"receipt": receipt_json(), "advice": advice, "chat": "All good."}[feature]
    gemini.queue(server_error()).queue(ok)
    if feature == "receipt":
        assert extract().merchant_name == "Cafe"
    elif feature == "advice":
        assert ai_service.generate_advice({"currency": "THB"}, [])[0] == "H"
    else:
        assert ai_service.chat("hi", [], {"currency": "THB"}, []) == "All good."
    assert len(gemini.calls) == 2


async def test_upload_endpoint_survives_an_overload_and_reports_a_total_outage(client, gemini):
    gemini.queue(server_error()).queue(receipt_json(amount=250))
    ok = await client.post("/api/transactions/upload", files={"file": ("a.png", PNG, "image/png")})
    assert ok.status_code == 200 and ok.json()["amount"] == 250

    gemini.fail_with(server_error())
    ai_service._cooldown.clear()
    down = await client.post("/api/transactions/upload", files={"file": ("b.png", PNG, "image/png")})
    assert down.status_code == 502 and "Gemini is busy right now" in down.json()["detail"]


async def test_advice_endpoint_falls_back_to_built_in_tips_with_a_readable_reason(client, gemini):
    from tests.conftest import add_tx

    await add_tx(client, 120, "Nobu", "Food", days_ago=0)
    gemini.fail_with(server_error())
    advice = (await client.get("/api/assistant/advice")).json()
    assert advice["source"] == "rules" and "busy" in advice["ai_error"]
    assert advice["tips"]


# ------------------------------------------------------------------ plain text only


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("You spent **฿470.00** on food", "You spent ฿470.00 on food"),
        ("__bold__ and *italic*", "bold and italic"),
        ("## Heading\nBody", "Heading\nBody"),
        ("* one\n- two\n  * nested", "• one\n• two\n  • nested"),
        ("Run `get_spending` now", "Run get_spending now"),
        ("2 * 3 = 6 and 5*4=20", "2 * 3 = 6 and 5*4=20"),  # arithmetic is left alone
        ("ဒီလ **အစားအသောက်** ၅၂၀ ဘတ်", "ဒီလ အစားအသောက် ၅၂၀ ဘတ်"),
        ("  padded  ", "padded"),
    ],
)
def test_strip_markdown(raw, expected):
    assert ai_service.strip_markdown(raw) == expected


def test_chat_replies_and_advice_are_returned_as_plain_text(gemini):
    gemini.queue("**฿470.00** this month.\n* Food: ฿470\n* Total: ฿5,012")
    assert ai_service.chat("hi", [], {"currency": "THB"}, []) == "฿470.00 this month.\n• Food: ฿470\n• Total: ฿5,012"

    gemini.queue(json.dumps({"headline": "**Big** month", "tips": [{"title": "**Watch** food", "body": "You spent *a lot*.", "severity": "warning", "category": "Food"}]}))
    headline, tips = ai_service.generate_advice({"currency": "THB"}, [])
    assert headline == "Big month" and (tips[0].title, tips[0].body) == ("Watch food", "You spent a lot.")


def test_the_prompt_forbids_markdown(gemini):
    ai_service.chat("hi", [], {"currency": "THB"}, [])
    assert "PLAIN TEXT only" in gemini.last.config.system_instruction
