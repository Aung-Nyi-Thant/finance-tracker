import hashlib
from datetime import date

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

import ai_service
import insights
import memory
import search as smart_search
from assistant import router as assistant_router
from database import Base, engine, get_db, run_migrations
from security import require_token
from models import (
    TOTAL_BUDGET,
    CategoryTotal,
    ParsedReceipt,
    SearchOut,
    SummaryOut,
    Transaction,
    TransactionConfirm,
    TransactionCreate,
    TransactionOut,
    TransactionSaved,
)

load_dotenv()

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
Base.metadata.create_all(bind=engine)
run_migrations()


app = FastAPI(title="Finance Tracker API", version="3.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

api = APIRouter(prefix="/api", dependencies=[Depends(require_token)])


# ---------- helpers ----------


def _sniff_mime(data: bytes) -> str | None:
    """Detect the image type from magic bytes (clients like iOS Shortcuts often send wrong content-types)."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[4:8] == b"ftyp" and data[8:12] in (b"heic", b"heix", b"hevc", b"mif1", b"msf1", b"heim", b"heis"):
        return "image/heic"
    return None


async def _read_image(file: UploadFile) -> tuple[bytes, str]:
    """Read the upload into memory and release the framework's temp spool file immediately."""
    try:
        data = await file.read()
    finally:
        await file.close()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image is larger than 10 MB")
    mime = _sniff_mime(data)
    if mime is None:
        raise HTTPException(415, "Unsupported image type (use JPEG, PNG, HEIC or WebP)")
    return data, mime


def _parse(data: bytes, mime: str) -> ParsedReceipt:
    try:
        return ai_service.extract_receipt(data, mime)
    except ai_service.NotAReceiptError as exc:
        raise HTTPException(422, "not_a_receipt") from exc
    except ai_service.AIServiceError as exc:
        raise HTTPException(502, str(exc)) from exc


def _get_tx(db: Session, tx_id: int) -> Transaction:
    tx = db.get(Transaction, tx_id)
    if tx is None:
        raise HTTPException(404, "Transaction not found")
    return tx


# ---------- endpoints ----------


@app.get("/api/health")
def health():
    return {"status": "ok"}


@api.post("/transactions/upload", response_model=ParsedReceipt)
async def upload_receipt(file: UploadFile = File(...)):
    """Run OCR and return the extracted fields. The image is processed in memory and never stored."""
    data, mime = await _read_image(file)
    return _parse(data, mime)


@api.post("/transactions/import", response_model=TransactionOut)
async def import_receipt(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Zero-touch import (screenshot watcher, clipboard, iOS Shortcut share sheet).

    OCRs the image in memory and stores only the extracted fields as a *pending* transaction awaiting
    1-tap confirmation. The image itself is never written to disk or the database. The same image sent
    twice (matched by a one-way hash) returns the existing transaction instead of creating a duplicate.
    """
    data, mime = await _read_image(file)
    digest = hashlib.sha256(data).hexdigest()

    existing = db.query(Transaction).filter(Transaction.image_hash == digest).first()
    if existing:
        return existing

    parsed = _parse(data, mime)
    tx = Transaction(
        **parsed.model_dump(),
        image_hash=digest,
        status="pending",
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)
    return tx


@api.get("/transactions/pending", response_model=list[TransactionOut])
def list_pending(db: Session = Depends(get_db)):
    return db.query(Transaction).filter(Transaction.status == "pending").order_by(Transaction.id.desc()).all()


def _saved(db: Session, tx: Transaction) -> TransactionSaved:
    """The saved transaction plus how it moved this month's budget picture."""
    out = TransactionSaved.model_validate(tx)
    out.impact = memory.impact_for(db, tx)
    return out


@api.post("/transactions/{tx_id}/confirm", response_model=TransactionSaved)
def confirm_transaction(tx_id: int, edits: TransactionConfirm | None = None, db: Session = Depends(get_db)):
    tx = _get_tx(db, tx_id)
    for field, value in (edits.model_dump(exclude_none=True) if edits else {}).items():
        setattr(tx, field, value)
    tx.status = "confirmed"
    db.commit()
    db.refresh(tx)
    return _saved(db, tx)


@api.delete("/transactions/{tx_id}", status_code=204)
def delete_transaction(tx_id: int, db: Session = Depends(get_db)):
    db.delete(_get_tx(db, tx_id))
    db.commit()


@api.post("/transactions", response_model=TransactionSaved, status_code=201)
def create_transaction(payload: TransactionCreate, db: Session = Depends(get_db)):
    tx = Transaction(**payload.model_dump(), status="confirmed")
    db.add(tx)
    db.commit()
    db.refresh(tx)
    return _saved(db, tx)


@api.get("/transactions/search", response_model=SearchOut)
def search_transactions(
    q: str = Query("", max_length=200),
    category: str | None = Query(None, max_length=40),
    limit: int = Query(50, ge=1, le=200),
    month: str | None = Query(None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="default period when the query names none"),
    db: Session = Depends(get_db),
):
    """Smart search over confirmed transactions, e.g. `food over 200 last month`, `uber`, `>500 august`."""
    rows, parsed = smart_search.search(db, q, category, limit, month=month)
    return SearchOut(results=rows, interpretation=parsed.notes)


@api.get("/transactions", response_model=list[TransactionOut])
def list_transactions(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    month: str | None = Query(None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="only this month, YYYY-MM"),
    db: Session = Depends(get_db),
):
    query = db.query(Transaction).filter(Transaction.status == "confirmed")
    if month:
        query = query.filter(Transaction.transaction_date.like(f"{month}-%"))
    return query.order_by(Transaction.transaction_date.desc(), Transaction.id.desc()).limit(limit).offset(offset).all()


@api.patch("/transactions/{tx_id}", response_model=TransactionSaved)
def update_transaction(tx_id: int, edits: TransactionConfirm, db: Session = Depends(get_db)):
    """Correct a saved transaction (any of amount, merchant, category, date). Only the fields sent are changed."""
    tx = _get_tx(db, tx_id)
    changes = edits.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(422, "Nothing to update")
    for field, value in changes.items():
        setattr(tx, field, value)
    db.commit()
    db.refresh(tx)
    return _saved(db, tx)


@api.get("/summary", response_model=SummaryOut)
def summary(
    month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
):
    month = month or date.today().strftime("%Y-%m")
    stats = insights.compute_stats(db, month)
    by_budget = {b["category"]: b for b in stats["budgets"]}

    categories = []
    for c in stats["categories"]:
        budget = by_budget.get(c["category"])
        categories.append(
            CategoryTotal(
                **c,
                budget=budget["limit"] if budget else None,
                budget_percent=budget["percent"] if budget else None,
                status=budget["status"] if budget else None,
            )
        )
    total_budget = by_budget.get(TOTAL_BUDGET)
    return SummaryOut(
        month=month,
        total_spent=stats["total_spent"],
        total_income=stats["income"],
        transaction_count=stats["transaction_count"],
        categories=categories,
        total_budget=total_budget["limit"] if total_budget else None,
        total_budget_percent=total_budget["percent"] if total_budget else None,
        total_status=total_budget["status"] if total_budget else None,
        alerts=insights.alerts_from(stats),
    )


app.include_router(api)
app.include_router(assistant_router)
