"""Shared fixtures.

The suite runs against a throwaway SQLite file (never ``finance.db``), with Gemini replaced by a fake client,
so it needs no network, no API key and leaves nothing behind.

Set TEST_DB_URL to run the very same tests on another database, e.g. a throwaway Postgres
(``python tests/run_on_postgres.py`` does that for you). Never point it at data you care about:
every test drops and recreates the tables.
"""
import os
import tempfile
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

# These must be set BEFORE the app modules are imported: database.py reads FINANCE_DB_URL at import time and
# main.py / ai_service.py call load_dotenv() (which never overrides variables that already exist).
_TMP_ROOT = Path(tempfile.mkdtemp(prefix="finance-tests-"))
os.environ["FINANCE_DB_URL"] = os.environ.get("TEST_DB_URL") or f"sqlite:///{_TMP_ROOT / 'test.db'}"
os.environ.pop("DATABASE_URL", None)
os.environ["GEMINI_API_KEY"] = ""
os.environ["API_TOKEN"] = ""

import httpx  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402

import ai_service  # noqa: E402
from database import Base, SessionLocal, engine  # noqa: E402
from main import app  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_database(monkeypatch):
    """Every test starts from empty tables and a clean environment."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("API_TOKEN", "")
    yield


@pytest.fixture(autouse=True)
def instant_ai_retries(monkeypatch):
    """No real sleeping between retries, no cooldown memory carried between tests, default model chain."""
    monkeypatch.setattr(ai_service, "_sleep", lambda seconds: None)
    ai_service._cooldown.clear()
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    monkeypatch.delenv("GEMINI_FALLBACK_MODELS", raising=False)
    yield
    ai_service._cooldown.clear()


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest_asyncio.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
def spool_dir(tmp_path, monkeypatch):
    """Point Python's temp dir at an empty folder so a test can prove nothing is left on disk."""
    spool = tmp_path / "spool"
    spool.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(spool))
    return spool


# ---------------------------------------------------------------- fake Gemini


class FakeGemini:
    """Stands in for ``google.genai.Client``: records every request and returns queued responses.

    ``queue`` / ``queue_for`` accept either response text or an Exception instance (which is raised), so a test
    can script "503, then success" or "model A is out of quota, model B works".
    """

    def __init__(self):
        self.calls: list[SimpleNamespace] = []
        self._queue: list = []
        self._per_model: dict[str, list] = {}
        self._error: Exception | None = None
        self.default = '{"is_receipt": true, "amount": 12.5, "merchant_name": "Cafe", "category": "Food", "transaction_date": "2026-10-05"}'
        self.models = SimpleNamespace(generate_content=self._generate_content)

    def queue(self, item) -> "FakeGemini":
        self._queue.append(item)
        return self

    def queue_for(self, model: str, *items) -> "FakeGemini":
        self._per_model.setdefault(model, []).extend(items)
        return self

    @property
    def models_called(self) -> list[str]:
        return [c.model for c in self.calls]

    def fail_with(self, error: Exception) -> "FakeGemini":
        self._error = error
        return self

    @property
    def last(self) -> SimpleNamespace:
        return self.calls[-1]

    def _generate_content(self, model, contents, config):
        self.calls.append(SimpleNamespace(model=model, contents=contents, config=config))
        if self._error:
            raise self._error
        if self._per_model.get(model):
            item = self._per_model[model].pop(0)
        elif self._queue:
            item = self._queue.pop(0)
        else:
            item = self.default
        if isinstance(item, Exception):
            raise item
        return SimpleNamespace(text=item)


@pytest.fixture
def gemini(mocker) -> FakeGemini:
    fake = FakeGemini()
    mocker.patch.object(ai_service, "_client", return_value=fake)
    return fake


# ---------------------------------------------------------------- helpers

# 1x1 transparent PNG
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360f8cfc0f01f0005000100f6e0b6ed0000000049454e44ae426082"
)


def png_of_size(n_bytes: int) -> bytes:
    """A valid PNG signature followed by padding, so it is detected as PNG but has a chosen size."""
    return PNG[:8] + b"\0" * (n_bytes - 8)


def day(days_ago: int = 0) -> str:
    return (date.today() - timedelta(days=days_ago)).isoformat()


async def add_tx(client, amount, merchant, category, days_ago=0, on=None):
    response = await client.post(
        "/api/transactions",
        json={"amount": amount, "merchant_name": merchant, "category": category, "transaction_date": on or day(days_ago)},
    )
    assert response.status_code == 201, response.text
    return response.json()


def receipt_json(**overrides) -> str:
    import json

    payload = {"is_receipt": True, "amount": 12.5, "merchant_name": "Cafe", "category": "Food", "transaction_date": "2026-10-05"}
    payload.update(overrides)
    return json.dumps(payload)
