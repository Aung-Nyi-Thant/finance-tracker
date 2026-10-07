import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")  # so DATABASE_URL in backend/.env works when running locally


def _database_url() -> str:
    """SQLite file by default; Postgres when DATABASE_URL (Render/Neon/Heroku style) is set.

    FINANCE_DB_URL takes precedence and is what the test suite uses for its throwaway database.
    """
    url = os.getenv("FINANCE_DB_URL") or os.getenv("DATABASE_URL") or f"sqlite:///{BASE_DIR / 'finance.db'}"
    # Hosts hand out postgres:// or postgresql:// URLs; SQLAlchemy needs the driver named explicitly.
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg2://" + url[len(prefix):]
    return url


DATABASE_URL = _database_url()
IS_SQLITE = DATABASE_URL.startswith("sqlite")

if IS_SQLITE:
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    # Serverless Postgres (Neon) closes idle connections: test each one before use and recycle often.
    # pool_timeout is short so a pile-up fails fast instead of holding threads for 30s.
    engine = create_engine(
        DATABASE_URL, pool_pre_ping=True, pool_recycle=240, pool_size=5, max_overflow=5, pool_timeout=10
    )
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def run_migrations() -> None:
    """Tiny additive migration: add columns introduced after the first release."""
    inspector = inspect(engine)
    if "transactions" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("transactions")}
    with engine.begin() as conn:
        if "status" not in existing:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN status VARCHAR NOT NULL DEFAULT 'confirmed'"))
        if "image_hash" not in existing:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN image_hash VARCHAR"))
