"""One-time cleanup for installs from before receipt images stopped being stored.

Older versions kept every receipt in backend/uploads/ and recorded its path in
transactions.image_path. Nothing reads those any more. This removes the files and the column.

    python purge_legacy_images.py          # dry run: shows what would be removed
    python purge_legacy_images.py --yes    # actually delete
"""
import sqlite3
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
DB_PATH = BASE_DIR / "finance.db"


def main(apply: bool) -> None:
    files = [p for p in UPLOAD_DIR.iterdir() if p.is_file() and p.name != ".gitkeep"] if UPLOAD_DIR.is_dir() else []
    size_mb = sum(p.stat().st_size for p in files) / 1_048_576
    print(f"uploads/: {len(files)} file(s), {size_mb:.1f} MB")

    has_column, rows = False, 0
    if DB_PATH.exists():
        db = sqlite3.connect(DB_PATH)
        has_column = any(r[1] == "image_path" for r in db.execute("PRAGMA table_info(transactions)"))
        if has_column:
            rows = db.execute("SELECT COUNT(*) FROM transactions WHERE image_path IS NOT NULL").fetchone()[0]
        db.close()
    print(f"transactions.image_path: {'present' if has_column else 'already gone'}, {rows} row(s) with a value")

    if not apply:
        print("\nDry run. Re-run with --yes to delete.")
        return

    for path in files:
        path.unlink()
    if UPLOAD_DIR.is_dir() and not any(UPLOAD_DIR.iterdir()):
        UPLOAD_DIR.rmdir()
    if has_column:
        db = sqlite3.connect(DB_PATH)
        db.execute("UPDATE transactions SET image_path = NULL")
        try:
            db.execute("ALTER TABLE transactions DROP COLUMN image_path")  # SQLite >= 3.35
        except sqlite3.OperationalError as exc:
            print(f"Could not drop the column ({exc}); values were cleared instead.")
        db.commit()
        db.execute("VACUUM")
        db.close()
    print("Done.")


if __name__ == "__main__":
    main("--yes" in sys.argv[1:])
