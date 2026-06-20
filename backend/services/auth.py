"""Session tokens and API-key verification for sensitive account operations."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import urllib.error
import urllib.request
from typing import Optional

from fastapi import HTTPException


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def verify_anthropic_api_key(api_key: str) -> bool:
    """Return True if Anthropic accepts this API key (no charge — models list only)."""
    key = (api_key or "").strip()
    if not key.startswith("sk-ant-"):
        return False

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/models",
        headers={
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            return resp.status == 200
    except urllib.error.HTTPError as exc:
        return exc.code == 200
    except Exception:
        return False


def _get_user_auth_row(email: str) -> Optional[dict]:
    from services.database import get_supabase

    supabase = get_supabase()
    result = (
        supabase.table("users")
        .select("id, email, session_token_hash, api_key_hash")
        .eq("email", email.lower().strip())
        .execute()
    )
    return result.data[0] if result.data else None


def user_has_stored_data(user_id: str) -> bool:
    from services.database import get_supabase

    supabase = get_supabase()
    conv = (
        supabase.table("knowledge_nodes")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if conv.count and conv.count > 0:
        return True

    profile = (
        supabase.table("personal_profiles")
        .select("user_id")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return bool(profile.data)


def verify_api_key_for_user(user_id: str, api_key: str, stored_api_key_hash: Optional[str]) -> bool:
    if not verify_anthropic_api_key(api_key):
        return False

    key_hash = hash_secret(api_key)
    if not stored_api_key_hash:
        from services.database import get_supabase

        supabase = get_supabase()
        supabase.table("users").update({"api_key_hash": key_hash}).eq("id", user_id).execute()
        return True

    return hmac.compare_digest(stored_api_key_hash, key_hash)


def issue_session_token(user_id: str) -> str:
    from services.database import get_supabase

    token = secrets.token_urlsafe(32)
    token_hash = hash_secret(token)
    supabase = get_supabase()
    supabase.table("users").update({"session_token_hash": token_hash}).eq("id", user_id).execute()
    return token


def verify_session_token(email: str, access_token: str) -> str:
    """Return user_id if token is valid for email, else raise HTTPException."""
    email = email.lower().strip()
    token = (access_token or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Access token required.")

    user = _get_user_auth_row(email)
    if not user or not user.get("session_token_hash"):
        raise HTTPException(status_code=401, detail="Invalid or expired session. Reconnect in the extension.")

    if not hmac.compare_digest(user["session_token_hash"], hash_secret(token)):
        raise HTTPException(status_code=401, detail="Invalid or expired session. Reconnect in the extension.")

    return user["id"]


def establish_session(email: str, access_token: Optional[str] = None, api_key: Optional[str] = None) -> dict:
    """
    Issue or refresh a session token.

    - Valid existing token → rotate and return new token
    - Valid API key matching stored hash (or first enrollment) → issue token
    - Otherwise → 401 (email alone is never sufficient)
    """
    from services.database import get_or_create_user

    email = email.lower().strip()
    user_id = get_or_create_user(email)
    user = _get_user_auth_row(email) or {"id": user_id, "session_token_hash": None, "api_key_hash": None}

    if access_token and user.get("session_token_hash"):
        if hmac.compare_digest(user["session_token_hash"], hash_secret(access_token)):
            new_token = issue_session_token(user_id)
            return {"access_token": new_token, "refreshed": True}

    if api_key:
        if verify_api_key_for_user(user_id, api_key, user.get("api_key_hash")):
            new_token = issue_session_token(user_id)
            return {"access_token": new_token, "refreshed": False}
        raise HTTPException(
            status_code=401,
            detail="Invalid Anthropic API key. Use the key saved in extension Advanced Settings.",
        )

    raise HTTPException(
        status_code=401,
        detail=(
            "Verification required. Add your Anthropic API key in the extension "
            "and reconnect, or sign in on a device where you are already connected."
        ),
    )


def authenticate_user(
    email: str,
    access_token: Optional[str] = None,
    api_key: Optional[str] = None,
) -> str:
    """Return user_id after verifying session token or API key."""
    email = email.lower().strip()
    token = (access_token or "").strip()
    key = (api_key or "").strip()

    if token:
        return verify_session_token(email, token)

    if key:
        from services.database import get_or_create_user

        user_id = get_or_create_user(email)
        user = _get_user_auth_row(email) or {}
        if verify_api_key_for_user(user_id, key, user.get("api_key_hash")):
            return user_id
        raise HTTPException(status_code=401, detail="Invalid Anthropic API key.")

    raise HTTPException(
        status_code=401,
        detail="Sign in required. Connect in the Mind World extension with your API key.",
    )


def require_authenticated_user(email: str, access_token: Optional[str]) -> str:
    """Gate sensitive account operations — must present a valid session token."""
    return verify_session_token(email, access_token or "")
