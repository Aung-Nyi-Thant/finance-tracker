import re
from datetime import datetime, timezone
from typing import Annotated, List

from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Literal

from sqlalchemy import Column, DateTime, Float, Integer, String, Text, UniqueConstraint

from database import Base

CATEGORIES: List[str] = [
    "Food",
    "Groceries",
    "Transport",
    "Shopping",
    "Entertainment",
    "Bills",
    "Health",
    "Income",
    "Other",
]

# Friendly spellings people (and the AI) use for the canonical categories.
CATEGORY_ALIASES: dict[str, str] = {
    "dining": "Food", "restaurant": "Food", "restaurants": "Food", "eating out": "Food", "coffee": "Food",
    "grocery": "Groceries", "supermarket": "Groceries",
    "transportation": "Transport", "taxi": "Transport", "travel": "Transport", "fuel": "Transport",
    "shop": "Shopping", "clothes": "Shopping", "retail": "Shopping",
    "games": "Entertainment", "game": "Entertainment", "gaming": "Entertainment", "movies": "Entertainment",
    "utilities": "Bills", "utility": "Bills", "bill": "Bills",
    "medical": "Health", "pharmacy": "Health",
    "salary": "Income", "others": "Other",
    # Burmese names (matches the glossary given to the assistant), in case a tool call uses them.
    "အစားအသောက်": "Food",
    "ကုန်စုံ": "Groceries",
    "ခရီးသွားလာစရိတ်": "Transport", "သွားလာစရိတ်": "Transport",
    "ဈေးဝယ်စရိတ်": "Shopping", "ဈေးဝယ်": "Shopping",
    "ဂိမ်း": "Entertainment", "ဖျော်ဖြေရေး": "Entertainment", "ဂိမ်းနှင့် ဖျော်ဖြေရေး": "Entertainment",
    "ဝန်ဆောင်ခ": "Bills", "ဝန်ဆောင်ခများ": "Bills", "ဘီလ်": "Bills",
    "ကျန်းမာရေး": "Health",
    "ဝင်ငွေ": "Income",
    "အခြား": "Other",
}


def resolve_category(raw: str | None) -> str | None:
    """Map a free-text category to a canonical one, or None if it isn't recognised."""
    key = (raw or "").strip().lower()
    for cat in CATEGORIES:
        if cat.lower() == key:
            return cat
    return CATEGORY_ALIASES.get(key)


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    amount = Column(Float, nullable=False)
    merchant_name = Column(String, nullable=False)
    category = Column(String, nullable=False, default="Other")
    transaction_date = Column(String, nullable=False, index=True)  # YYYY-MM-DD
    # "pending" = auto-imported, waiting for the user's 1-tap confirmation
    status = Column(String, nullable=False, default="confirmed", server_default="confirmed", index=True)
    # sha256 of the source image: lets us ignore a re-sent image without storing the image itself
    image_hash = Column(String, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)


class Budget(Base):
    """Monthly spending limit for one category, or for everything when category == "Total"."""

    __tablename__ = "budgets"

    id = Column(Integer, primary_key=True)
    category = Column(String, nullable=False, unique=True)
    monthly_limit = Column(Float, nullable=False)


class Setting(Base):
    """Tiny key/value store for app-wide preferences (currently just the display currency)."""

    __tablename__ = "settings"

    key = Column(String, primary_key=True)
    value = Column(String, nullable=False)


class AdviceCache(Base):
    """Generated advice, keyed by the exact stats it was generated from (avoids repeat Gemini calls)."""

    __tablename__ = "advice_cache"
    __table_args__ = (UniqueConstraint("month", "stats_hash"),)

    id = Column(Integer, primary_key=True)
    month = Column(String, nullable=False, index=True)
    stats_hash = Column(String, nullable=False)
    payload = Column(Text, nullable=False)  # JSON
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)


# ---------- Pydantic schemas ----------

# code -> (symbol, decimal places). Display only: amounts are never converted between currencies.
CURRENCIES: dict[str, tuple[str, int]] = {
    "USD": ("$", 2),
    "EUR": ("€", 2),
    "GBP": ("£", 2),
    "JPY": ("¥", 0),
    "CNY": ("CN¥", 2),
    "KRW": ("₩", 0),
    "INR": ("₹", 2),
    "THB": ("฿", 2),
    "SGD": ("S$", 2),
    "AUD": ("A$", 2),
    "CAD": ("C$", 2),
    "CHF": ("CHF ", 2),
    "MMK": ("K", 0),
}
DEFAULT_CURRENCY = "THB"  # Thai Baht; change in the app (Dashboard > currency pill)

BudgetStatus = Literal["ok", "warning", "over"]
TOTAL_BUDGET = "Total"


class ParsedReceipt(BaseModel):
    """Strict shape returned by the AI service."""

    amount: float
    merchant_name: str
    category: str
    transaction_date: str


class SlipText(BaseModel):
    """Text recognised on-device from a payment slip photo (the image itself never leaves the phone)."""

    lines: list[Annotated[str, Field(max_length=300)]] = Field(max_length=200)


class TransactionCreate(BaseModel):
    amount: float = Field(gt=0)
    merchant_name: str = Field(min_length=1, max_length=200)
    category: str
    transaction_date: str

    @field_validator("merchant_name")
    @classmethod
    def _strip_merchant(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("merchant_name must not be empty")
        return v

    @field_validator("category")
    @classmethod
    def _valid_category(cls, v: str) -> str:
        if v not in CATEGORIES:
            raise ValueError(f"category must be one of {CATEGORIES}")
        return v

    @field_validator("transaction_date")
    @classmethod
    def _valid_date(cls, v: str) -> str:
        if not DATE_RE.match(v):
            raise ValueError("transaction_date must be YYYY-MM-DD")
        datetime.strptime(v, "%Y-%m-%d")
        return v


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    amount: float
    merchant_name: str
    category: str
    transaction_date: str
    status: str
    created_at: datetime


class TransactionConfirm(BaseModel):
    """Optional edits applied when confirming a pending transaction."""

    amount: float | None = Field(default=None, gt=0)
    merchant_name: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = None
    transaction_date: str | None = None

    @field_validator("merchant_name")
    @classmethod
    def _strip_merchant(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("merchant_name must not be empty")
        return v

    @field_validator("category")
    @classmethod
    def _valid_category(cls, v: str | None) -> str | None:
        if v is not None and v not in CATEGORIES:
            raise ValueError(f"category must be one of {CATEGORIES}")
        return v

    @field_validator("transaction_date")
    @classmethod
    def _valid_date(cls, v: str | None) -> str | None:
        if v is not None:
            if not DATE_RE.match(v):
                raise ValueError("transaction_date must be YYYY-MM-DD")
            datetime.strptime(v, "%Y-%m-%d")
        return v


class SearchOut(BaseModel):
    results: List[TransactionOut]
    interpretation: List[str]  # how the query was understood, e.g. ["Food", "over 200", "last month"]


class Impact(BaseModel):
    """How a freshly saved transaction moved this month's budget picture (shown right after saving)."""

    message: str
    category: str
    category_spent: float
    category_budget: float | None = None
    category_percent: float | None = None
    total_spent: float
    total_budget: float | None = None
    total_percent: float | None = None
    status: BudgetStatus = "ok"


class TransactionSaved(TransactionOut):
    impact: Impact | None = None


class CategoryTotal(BaseModel):
    category: str
    total: float
    count: int
    percent: float
    budget: float | None = None
    budget_percent: float | None = None
    status: BudgetStatus | None = None


class Alert(BaseModel):
    level: Literal["warning", "over"]
    category: str | None  # None = overall monthly budget
    message: str


class SummaryOut(BaseModel):
    month: str
    total_spent: float
    total_income: float
    transaction_count: int
    categories: List[CategoryTotal]
    total_budget: float | None = None
    total_budget_percent: float | None = None
    total_status: BudgetStatus | None = None
    alerts: List[Alert] = []


class BudgetIn(BaseModel):
    monthly_limit: float = Field(gt=0, le=10_000_000)


class BudgetOut(BaseModel):
    category: str
    monthly_limit: float
    spent: float
    percent: float
    status: BudgetStatus


class Tip(BaseModel):
    title: str
    body: str
    severity: Literal["info", "warning", "positive"]
    category: str | None = None


class AdviceOut(BaseModel):
    month: str
    headline: str
    tips: List[Tip]
    source: Literal["ai", "rules"]
    generated_at: datetime
    ai_error: str | None = None


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=2000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    history: List[ChatMessage] = Field(default_factory=list, max_length=20)


class ChatReply(BaseModel):
    reply: str


class SettingsOut(BaseModel):
    currency: str


class SettingsIn(BaseModel):
    currency: str

    @field_validator("currency")
    @classmethod
    def _known_currency(cls, v: str) -> str:
        v = v.strip().upper()
        if v not in CURRENCIES:
            raise ValueError(f"currency must be one of {sorted(CURRENCIES)}")
        return v
