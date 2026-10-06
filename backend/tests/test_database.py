"""Startup migration for databases created by older versions, and the legacy-image purge script."""
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text

import database

BACKEND_DIR = Path(__file__).resolve().parent.parent


def make_legacy_db(path: Path):
    db = sqlite3.connect(path)
    db.execute(
        "CREATE TABLE transactions (id INTEGER PRIMARY KEY, amount FLOAT NOT NULL, merchant_name VARCHAR NOT NULL, "
        "category VARCHAR NOT NULL, transaction_date VARCHAR NOT NULL, image_path VARCHAR, created_at DATETIME NOT NULL)"
    )
    db.execute("INSERT INTO transactions VALUES (1, 9.5, 'Old Shop', 'Food', '2026-10-01', 'uploads/old1.jpg', '2026-10-01 10:00:00')")
    db.commit()
    db.close()


def test_migration_adds_missing_columns_and_keeps_old_rows(tmp_path, monkeypatch):
    legacy = tmp_path / "legacy.db"
    make_legacy_db(legacy)
    engine = create_engine(f"sqlite:///{legacy}")
    monkeypatch.setattr(database, "engine", engine)

    database.run_migrations()
    database.run_migrations()  # idempotent

    columns = {c["name"] for c in inspect(engine).get_columns("transactions")}
    assert {"status", "image_hash"} <= columns
    with engine.connect() as conn:
        assert conn.execute(text("SELECT merchant_name, status FROM transactions")).all() == [("Old Shop", "confirmed")]


async def test_the_app_still_works_on_a_legacy_row(client, db):
    """The old image_path column is ignored by the current model; the old row is still listed and new ones insert fine."""
    db.execute(text("ALTER TABLE transactions ADD COLUMN image_path VARCHAR"))
    db.execute(text("INSERT INTO transactions (amount, merchant_name, category, transaction_date, status, image_path, created_at) VALUES (9.5, 'Old Shop', 'Food', '2026-10-01', 'confirmed', 'uploads/x.jpg', '2026-10-01 10:00:00')"))
    db.commit()

    listed = (await client.get("/api/transactions")).json()
    assert [t["merchant_name"] for t in listed] == ["Old Shop"] and "image_path" not in listed[0]
    created = await client.post("/api/transactions", json={"amount": 3, "merchant_name": "New", "category": "Food", "transaction_date": "2026-10-02"})
    assert created.status_code == 201


def run_purge(cwd: Path, *args):
    return subprocess.run([sys.executable, str(cwd / "purge_legacy_images.py"), *args], capture_output=True, text=True, cwd=cwd).stdout


def test_purge_script_dry_run_then_delete(tmp_path):
    (tmp_path / "uploads").mkdir()
    (tmp_path / "uploads" / "old1.jpg").write_bytes(b"x" * 500_000)
    (tmp_path / "uploads" / "old2.png").write_bytes(b"y" * 300_000)
    make_legacy_db(tmp_path / "finance.db")
    (tmp_path / "purge_legacy_images.py").write_text((BACKEND_DIR / "purge_legacy_images.py").read_text())

    dry = run_purge(tmp_path)
    assert "2 file(s)" in dry and "Dry run" in dry
    assert (tmp_path / "uploads" / "old1.jpg").exists()  # nothing deleted without --yes

    done = run_purge(tmp_path, "--yes")
    assert "Done" in done and not (tmp_path / "uploads").exists()
    columns = [r[1] for r in sqlite3.connect(tmp_path / "finance.db").execute("PRAGMA table_info(transactions)")]
    assert "image_path" not in columns
    assert sqlite3.connect(tmp_path / "finance.db").execute("SELECT merchant_name FROM transactions").fetchall() == [("Old Shop",)]


# ------------------------------------------------------------------ which database is used


def test_the_suite_runs_on_the_database_it_was_asked_to(monkeypatch):
    """Guards the Postgres run: if TEST_DB_URL is set we must really be on that engine, not a SQLite fallback."""
    import os

    expected = "postgresql" if (os.environ.get("TEST_DB_URL") or "").startswith("postgres") else "sqlite"
    assert database.engine.dialect.name == expected
    assert database.IS_SQLITE == (expected == "sqlite")


@pytest.mark.parametrize(
    ("env", "expected"),
    [
        ({}, "sqlite:///"),  # default: a local file
        ({"DATABASE_URL": "postgres://u:p@ep-1.neon.tech/db?sslmode=require"}, "postgresql+psycopg2://u:p@ep-1.neon.tech/db?sslmode=require"),
        ({"DATABASE_URL": "postgresql://u:p@host/db"}, "postgresql+psycopg2://u:p@host/db"),
        ({"DATABASE_URL": "postgresql+psycopg2://u:p@host/db"}, "postgresql+psycopg2://u:p@host/db"),  # already explicit
        ({"DATABASE_URL": "postgres://a@h/db", "FINANCE_DB_URL": "sqlite:////data/finance.db"}, "sqlite:////data/finance.db"),  # FINANCE_DB_URL wins
        ({"FINANCE_DB_URL": "sqlite:////var/data/finance.db"}, "sqlite:////var/data/finance.db"),
    ],
)
def test_database_url_selection(monkeypatch, env, expected):
    monkeypatch.delenv("FINANCE_DB_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    assert database._database_url().startswith(expected)
