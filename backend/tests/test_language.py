"""Burmese (and mixed-language) handling: detection, prompt rules, and data round-trips."""
import pytest

import language
from tests.conftest import add_tx, day

Q_FOOD = "ဒီလ အစားအသောက်အတွက် ဘယ်လောက်သုံးခဲ့လဲ"  # How much did I spend on food this month?
Q_GAME = "ဂိမ်းတစ်ခု ၁၅၀၀ ဘတ်နဲ့ ဝယ်လို့ရမလား"  # Can I buy a game for 1500 baht?
Q_MIXED = "Starbucks မှာ ဘယ်လောက်သုံးခဲ့လဲ"  # How much did I spend at Starbucks?
Q_ZAWGYI = "ကၽြန္ေတာ္ ဘယ္ေလာက္ သံုးခဲ့လဲ"  # Zawgyi-encoded


@pytest.mark.parametrize("text", [Q_FOOD, Q_GAME, Q_MIXED, Q_ZAWGYI, "၅၀၀၀?"])
def test_burmese_is_detected(text):
    assert language.detect_language(text) == "my"


@pytest.mark.parametrize("text", ["How much did I spend on food?", "Can I afford a game?", "ok", "5000?", "👍", ""])
def test_everything_else_is_not_burmese(text):
    assert language.detect_language(text) == "en"


def test_short_follow_ups_keep_the_conversation_language():
    history = [{"role": "user", "content": Q_FOOD}, {"role": "assistant", "content": "အစားအသောက်အတွက် ၅၂၀ ဘတ်ပါ"}]
    assert language.detect_language("5000?", history) == "my"
    assert language.detect_language("👍", history) == "my"
    assert language.detect_language("thanks", history) == "en"  # real English wins


def test_zawgyi_is_recognised_but_unicode_is_not():
    assert language.looks_like_zawgyi(Q_ZAWGYI)
    assert not any(language.looks_like_zawgyi(t) for t in (Q_FOOD, Q_GAME, Q_MIXED, "English only"))


def test_reply_directive_and_token_budget():
    assert "LANGUAGE FOR THIS REPLY: Burmese" in language.reply_directive(Q_FOOD)
    assert "Zawgyi-encoded" in language.reply_directive(Q_ZAWGYI)
    assert "Zawgyi" not in language.reply_directive(Q_FOOD)
    assert "English only" in language.reply_directive("hello")
    assert "same language as the user's latest message" in language.reply_directive("5000?")  # nothing to go on
    assert language.max_output_tokens(Q_FOOD) > language.max_output_tokens("hello")


async def test_burmese_chat_prompt_and_data_round_trip(client, gemini):
    await add_tx(client, 520, "မုန့်ဟင်းခါးဆိုင်", "Food", days_ago=1)
    gemini.queue("ဒီလ အစားအသောက်အတွက် ၅၂၀ ဘတ် သုံးထားပါတယ်")

    response = await client.post("/api/assistant/chat", json={"message": Q_GAME, "history": [{"role": "user", "content": Q_FOOD}]})

    assert response.json()["reply"].startswith("ဒီလ")  # Burmese survives JSON in and out
    system = gemini.last.config.system_instruction
    assert "LANGUAGE FOR THIS REPLY: Burmese" in system and "Myanmar-Unicode" in system
    for rule in ("သောင်း=10,000", "သိန်း=100,000", "ဘတ် = baht", "ပြီးခဲ့တဲ့အပတ် = last week", "၅=5", "ခင်ဗျာ", "Western digits", "ALWAYS English"):
        assert rule in system
    assert "မုန့်ဟင်းခါးဆိုင်" in system and "\\u1019" not in system  # Burmese merchant names go in as text
    assert gemini.last.config.max_output_tokens == 4096
    assert gemini.last.contents[-1].parts[0].text == Q_GAME  # the user's words are passed through untouched


async def test_english_and_zawgyi_and_follow_up_prompts(client, gemini):
    await client.post("/api/assistant/chat", json={"message": "Can I afford a game for 1500?"})
    system = gemini.last.config.system_instruction
    assert "LANGUAGE FOR THIS REPLY: English" in system and gemini.last.config.max_output_tokens == 2048
    # The Burmese rules are NOT sent for English chats: with them present, weaker models answered in Burmese.
    assert "Burmese / မြန်မာဘာသာ" not in system and "သိန်း" not in system

    await client.post("/api/assistant/chat", json={"message": Q_ZAWGYI})
    assert "Zawgyi-encoded" in gemini.last.config.system_instruction
    assert "Burmese / မြန်မာဘာသာ" in gemini.last.config.system_instruction  # Zawgyi is Burmese: rules included

    english_after_burmese = {"message": "thanks!", "history": [{"role": "user", "content": Q_GAME}, {"role": "assistant", "content": "ရပါတယ်"}]}
    await client.post("/api/assistant/chat", json=english_after_burmese)
    assert "LANGUAGE FOR THIS REPLY: English" in gemini.last.config.system_instruction  # real English wins over history
    assert "Burmese / မြန်မာဘာသာ" not in gemini.last.config.system_instruction

    follow_up = {"message": "5000?", "history": [{"role": "user", "content": Q_GAME}, {"role": "assistant", "content": "ရပါတယ်"}]}
    await client.post("/api/assistant/chat", json=follow_up)
    assert "LANGUAGE FOR THIS REPLY: Burmese" in gemini.last.config.system_instruction


async def test_tools_accept_burmese_merchants_and_category_names(client, gemini, db):
    import memory

    await add_tx(client, 520, "မုန့်ဟင်းခါးဆိုင်", "Food", days_ago=1)
    await add_tx(client, 85, "Cafe Amazon", "Food", days_ago=1)
    await client.post("/api/assistant/chat", json={"message": "hi"})
    assert gemini.last.config.tools  # the request carries the tools; exercise them on our own session
    get_spending = memory.make_tools(db)[0]

    by_merchant = get_spending(day(30), day(0), merchant="မုန့်ဟင်း")
    assert by_merchant["total"] == 520 and by_merchant["top_merchants"][0]["merchant"] == "မုန့်ဟင်းခါးဆိုင်"
    by_category = get_spending(day(30), day(0), "အစားအသောက်")  # Burmese category name resolves too
    assert by_category["category"] == "Food" and by_category["total"] == 605


def test_burmese_digits_in_replies_become_western_digits(gemini):
    import ai_service

    gemini.queue("ဖျော်ဖြေရေး ဘတ်ဂျက် ၁,၂၀၁.၀၀ ဘတ် ကျန်ပါတယ် (၈၀%)")
    reply = ai_service.chat("ဂိမ်း ဝယ်လို့ရမလား", [], {"currency": "THB"}, [])
    assert reply == "ဖျော်ဖြေရေး ဘတ်ဂျက် 1,201.00 ဘတ် ကျန်ပါတယ် (80%)"
    assert language.westernize_digits("၀၁၂၃၄၅၆၇၈၉ 5") == "0123456789 5"


def test_the_burmese_rules_ask_for_the_spoken_polite_register():
    assert "formal literary register" in language.BURMESE_RULES and "ပါတော့သည်" in language.BURMESE_RULES
