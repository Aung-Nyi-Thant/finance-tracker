"""Run the whole backend test suite against a real, throwaway PostgreSQL.

    pip install pgserver          # a pip-installable PostgreSQL, used only for this
    python tests/run_on_postgres.py [pytest args]

It starts Postgres in a temporary folder, points TEST_DB_URL at it, runs pytest, and shuts everything down.
This is how Postgres support (used with Neon in production) is verified without needing an account.
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pgserver

BACKEND = Path(__file__).resolve().parent.parent

with tempfile.TemporaryDirectory(prefix="finance-pg-") as data_dir:
    server = pgserver.get_server(data_dir, cleanup_mode="stop")
    try:
        uri = server.get_uri()  # postgresql://postgres:@/postgres?host=/tmp/...
        print(f"Postgres: {server.psql('select version();').strip().splitlines()[2].strip()[:60]}")
        env = {**os.environ, "TEST_DB_URL": uri}
        code = subprocess.call([sys.executable, "-m", "pytest", *sys.argv[1:]], cwd=BACKEND, env=env)
    finally:
        server.cleanup()
sys.exit(code)
