import os

from fastapi import Header, HTTPException


def require_token(x_api_token: str | None = Header(default=None)) -> None:
    """Optional shared secret. Set API_TOKEN in .env to require `X-API-Token` on every /api call."""
    expected = os.getenv("API_TOKEN", "").strip()
    if expected and x_api_token != expected:
        raise HTTPException(401, "Missing or invalid X-API-Token")
