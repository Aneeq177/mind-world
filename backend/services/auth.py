"""Session tokens, password login, Google sign-in, and optional API-key verification."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

import bcrypt
from fastapi import HTTPException

MIN_PASSWORD_LENGTH = 8


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, stored_hash: Optional[str]) -> bool:
    if not stored_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("utf-8"))
    except ValueError:
        return False


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
        .select("id, email, session_token_hash, api_key_hash, password_hash, google_id")
        .eq("email", email.lower().strip())
        .execute()
    )
    return result.data[0] if result.data else None


def _get_user_by_google_id(google_id: str) -> Optional[dict]:
    from services.database import get_supabase

    supabase = get_supabase()
    result = (
        supabase.table("users")
        .select("id, email, session_token_hash, api_key_hash, password_hash, google_id")
        .eq("google_id", google_id)
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


def _session_response(user_id: str, email: str, refreshed: bool = False) -> dict:
    return {
        "access_token": issue_session_token(user_id),
        "email": email.lower().strip(),
        "refreshed": refreshed,
    }


def register_with_password(email: str, password: str) -> dict:
    email = email.lower().strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email required.")
    if len(password or "") < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.",
        )

    existing = _get_user_auth_row(email)
    if existing and existing.get("password_hash"):
        raise HTTPException(status_code=409, detail="Account already exists. Sign in instead.")

    from services.database import get_or_create_user, get_supabase

    user_id = existing["id"] if existing else get_or_create_user(email)
    supabase = get_supabase()
    supabase.table("users").update({"password_hash": hash_password(password)}).eq("id", user_id).execute()
    return _session_response(user_id, email)


def login_with_password(email: str, password: str) -> dict:
    email = email.lower().strip()
    user = _get_user_auth_row(email)
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    if not verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    return _session_response(user["id"], email)


def link_or_create_google_user(google_id: str, email: str) -> str:
    from services.database import get_or_create_user, get_supabase

    email = email.lower().strip()
    by_google = _get_user_by_google_id(google_id)
    if by_google:
        return by_google["id"]

    existing = _get_user_auth_row(email)
    supabase = get_supabase()
    if existing:
        supabase.table("users").update({"google_id": google_id}).eq("id", existing["id"]).execute()
        return existing["id"]

    user_id = get_or_create_user(email)
    supabase.table("users").update({"google_id": google_id}).eq("id", user_id).execute()
    return user_id


def verify_google_id_token(id_token: str) -> dict:
    client_id = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
    if not client_id:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured on the server.")

    token = (id_token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Google ID token required.")

    req = urllib.request.Request(
        f"https://oauth2.googleapis.com/tokeninfo?id_token={urllib.parse.quote(token)}",
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError:
        raise HTTPException(status_code=401, detail="Invalid Google sign-in token.")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google verification failed: {exc}")

    if data.get("aud") != client_id:
        raise HTTPException(status_code=401, detail="Invalid Google sign-in token.")
    if str(data.get("email_verified", "")).lower() not in ("true", "1"):
        raise HTTPException(status_code=401, detail="Google email is not verified.")

    email = (data.get("email") or "").lower().strip()
    google_id = data.get("sub") or ""
    if not email or not google_id:
        raise HTTPException(status_code=401, detail="Google profile missing email.")

    return {"google_id": google_id, "email": email}


def login_with_google_id_token(id_token: str) -> dict:
    profile = verify_google_id_token(id_token)
    user_id = link_or_create_google_user(profile["google_id"], profile["email"])
    return _session_response(user_id, profile["email"])


def exchange_google_auth_code(code: str, redirect_uri: str) -> dict:
    client_id = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("GOOGLE_CLIENT_SECRET") or "").strip()
    if not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured on the server.")

    body = urllib.parse.urlencode(
        {
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            token_data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=401, detail=f"Google sign-in failed: {detail}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google sign-in failed: {exc}")

    id_token = token_data.get("id_token")
    if not id_token:
        raise HTTPException(status_code=401, detail="Google did not return an ID token.")
    return verify_google_id_token(id_token)


def google_signin_redirect_url(source: str = "web") -> str:
    client_id = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
    if not client_id:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured on the server.")

    api_base = (os.getenv("API_PUBLIC_URL") or "https://mind-world-app-mv4yv.ondigitalocean.app").rstrip("/")
    redirect_uri = f"{api_base}/auth/google/signin/callback"
    state = secrets.token_urlsafe(16)
    safe_source = "extension" if source == "extension" else "web"
    state_payload = f"{state}:{safe_source}"

    params = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state_payload,
            "access_type": "online",
            "prompt": "select_account",
        }
    )
    return f"https://accounts.google.com/o/oauth2/v2/auth?{params}"


def verify_session_token(email: str, access_token: str) -> str:
    """Return user_id if token is valid for email, else raise HTTPException."""
    email = email.lower().strip()
    token = (access_token or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Access token required.")

    user = _get_user_auth_row(email)
    if not user or not user.get("session_token_hash"):
        raise HTTPException(status_code=401, detail="Invalid or expired session. Please sign in again.")

    if not hmac.compare_digest(user["session_token_hash"], hash_secret(token)):
        raise HTTPException(status_code=401, detail="Invalid or expired session. Please sign in again.")

    return user["id"]


def establish_session(email: str, access_token: Optional[str] = None, api_key: Optional[str] = None) -> dict:
    """
    Refresh a session token.

    - Valid existing token → rotate and return new token
    - Valid API key (legacy / Advanced Settings) → issue token
    - Otherwise → 401
    """
    from services.database import get_or_create_user

    email = email.lower().strip()
    user_id = get_or_create_user(email)
    user = _get_user_auth_row(email) or {"id": user_id, "session_token_hash": None, "api_key_hash": None}

    if access_token and user.get("session_token_hash"):
        if hmac.compare_digest(user["session_token_hash"], hash_secret(access_token)):
            return _session_response(user_id, email, refreshed=True)

    if api_key:
        if verify_api_key_for_user(user_id, api_key, user.get("api_key_hash")):
            return _session_response(user_id, email, refreshed=False)
        raise HTTPException(status_code=401, detail="Invalid Anthropic API key.")

    raise HTTPException(
        status_code=401,
        detail="Session expired. Sign in with your password or Google account.",
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

    raise HTTPException(status_code=401, detail="Sign in required.")


def require_authenticated_user(email: str, access_token: Optional[str]) -> str:
    """Gate sensitive account operations — must present a valid session token."""
    return verify_session_token(email, access_token or "")
