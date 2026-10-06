"""Session tokens, password login, Google sign-in, and optional API-key verification."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Optional

import bcrypt
import re
from fastapi import HTTPException

MIN_PASSWORD_LENGTH = 8
OAUTH_STATE_TTL_SECS = 600
HANDOFF_CODE_TTL_SECS = 120
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


def _validate_email_format(email: str) -> str:
    email = (email or "").lower().strip()
    if not email or not _EMAIL_RE.match(email) or len(email) > 254:
        raise HTTPException(status_code=400, detail="Valid email required.")
    return email


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


def _signing_secret() -> bytes:
    raw = (
        (os.getenv("AUTH_SIGNING_SECRET") or "").strip()
        or (os.getenv("GOOGLE_CLIENT_SECRET") or "").strip()
        or (os.getenv("SUPABASE_SERVICE_KEY") or "").strip()
        or "mind-world-dev-signing-secret"
    )
    return raw.encode("utf-8")


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    pad = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + pad).encode("ascii"))


def _sign_payload(payload: dict) -> str:
    body = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    sig = _b64url_encode(hmac.new(_signing_secret(), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{sig}"


def _verify_signed_payload(token: str, max_age_secs: int) -> dict:
    try:
        body, sig = (token or "").split(".", 1)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid signed token.")

    expected = _b64url_encode(hmac.new(_signing_secret(), body.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(status_code=400, detail="Invalid signed token.")

    try:
        payload = json.loads(_b64url_decode(body).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid signed token.")

    exp = int(payload.get("exp") or 0)
    now = int(time.time())
    if exp < now or exp > now + max_age_secs + 30:
        raise HTTPException(status_code=400, detail="Signed token expired.")
    return payload


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
    """Return True only when the key matches an already-bound hash.

    Never bind a new Anthropic key during authentication — that would let anyone
    with a valid key claim an unbound account.
    """
    if not stored_api_key_hash:
        return False
    if not verify_anthropic_api_key(api_key):
        return False
    return hmac.compare_digest(stored_api_key_hash, hash_secret(api_key))


def bind_api_key_for_user(user_id: str, api_key: str, access_token: str, email: str) -> dict:
    """Bind or rotate the Anthropic API key for an already-authenticated session."""
    require_authenticated_user(email, access_token)
    if not verify_anthropic_api_key(api_key):
        raise HTTPException(status_code=401, detail="Invalid Anthropic API key.")

    from services.database import get_supabase

    supabase = get_supabase()
    supabase.table("users").update({"api_key_hash": hash_secret(api_key)}).eq("id", user_id).execute()
    return {"success": True}


# users.session_token_hash holds the hashes of the account's live sessions,
# space-separated, newest last, so the web app, the extension, and other
# browsers don't sign each other out. Signing in somewhere new drops the oldest
# once there are more than MAX_SESSIONS.
MAX_SESSIONS = 5


def _session_hashes(stored: Optional[str]) -> list[str]:
    return [h for h in (stored or "").split() if h]


def session_token_matches(stored: Optional[str], token: str) -> bool:
    candidate = hash_secret(token)
    return any(hmac.compare_digest(h, candidate) for h in _session_hashes(stored))


def issue_session_token(user_id: str) -> str:
    from services.database import get_supabase

    token = secrets.token_urlsafe(32)
    supabase = get_supabase()
    current = supabase.table("users").select("session_token_hash").eq("id", user_id).limit(1).execute()
    existing = _session_hashes(current.data[0].get("session_token_hash")) if current.data else []
    hashes = (existing + [hash_secret(token)])[-MAX_SESSIONS:]
    supabase.table("users").update({"session_token_hash": " ".join(hashes)}).eq("id", user_id).execute()
    return token


def _session_response(user_id: str, email: str, refreshed: bool = False) -> dict:
    return {
        "access_token": issue_session_token(user_id),
        "email": email.lower().strip(),
        "refreshed": refreshed,
    }


def register_with_password(email: str, password: str) -> dict:
    email = _validate_email_format(email)
    if len(password or "") < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.",
        )

    existing = _get_user_auth_row(email)
    if existing:
        raise HTTPException(status_code=409, detail="Account already exists. Sign in instead.")

    from services.database import get_or_create_user, get_supabase

    user_id = get_or_create_user(email)
    supabase = get_supabase()
    supabase.table("users").update({"password_hash": hash_password(password)}).eq("id", user_id).execute()
    return _session_response(user_id, email)


def login_with_password(email: str, password: str) -> dict:
    email = _validate_email_format(email)
    user = _get_user_auth_row(email)
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    if not verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    return _session_response(user["id"], email)


def link_or_create_google_user(google_id: str, email: str) -> tuple:
    """Return (user_id, has_password).

    Never auto-link Google to an existing email account — that enables takeover
    when registration does not verify email ownership. Matching google_id only.
    """
    email = _validate_email_format(email)
    by_google = _get_user_by_google_id(google_id)
    if by_google:
        return by_google["id"], bool(by_google.get("password_hash"))

    existing = _get_user_auth_row(email)
    if existing:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists. Sign in with your password instead.",
        )

    from services.database import get_or_create_user, get_supabase

    user_id = get_or_create_user(email)
    supabase = get_supabase()
    supabase.table("users").update({"google_id": google_id}).eq("id", user_id).execute()
    return user_id, False


def link_google_to_authenticated_user(email: str, access_token: str, id_token: str) -> dict:
    """Explicitly link Google to the currently signed-in account."""
    user_id = require_authenticated_user(email, access_token)
    profile = verify_google_id_token(id_token)
    if profile["email"] != email.lower().strip():
        raise HTTPException(
            status_code=400,
            detail="Google account email must match your Mind World email.",
        )

    by_google = _get_user_by_google_id(profile["google_id"])
    if by_google and by_google["id"] != user_id:
        raise HTTPException(status_code=409, detail="This Google account is already linked elsewhere.")

    from services.database import get_supabase

    supabase = get_supabase()
    supabase.table("users").update({"google_id": profile["google_id"]}).eq("id", user_id).execute()
    return {"success": True, "has_google": True}


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
    if data.get("iss") not in GOOGLE_ISSUERS:
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
    user_id, _has_password = link_or_create_google_user(profile["google_id"], profile["email"])
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


def create_oauth_state(source: str = "web") -> str:
    safe_source = "extension" if source == "extension" else "web"
    now = int(time.time())
    return _sign_payload(
        {
            "nonce": secrets.token_urlsafe(16),
            "source": safe_source,
            "iat": now,
            "exp": now + OAUTH_STATE_TTL_SECS,
        }
    )


def verify_oauth_state(state: str, cookie_state: Optional[str]) -> str:
    """Validate CSRF state from cookie + query param. Returns source."""
    if not state or not cookie_state:
        raise HTTPException(status_code=400, detail="Missing OAuth state.")
    if not hmac.compare_digest(state, cookie_state):
        raise HTTPException(status_code=400, detail="Invalid OAuth state.")

    payload = _verify_signed_payload(state, OAUTH_STATE_TTL_SECS)
    source = payload.get("source")
    if source not in ("web", "extension"):
        raise HTTPException(status_code=400, detail="Invalid OAuth state.")
    return source


def google_signin_redirect_url(source: str = "web", state: Optional[str] = None) -> tuple[str, str]:
    """Return (google_auth_url, state_token) for the redirect + Set-Cookie."""
    client_id = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
    if not client_id:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured on the server.")

    api_base = (os.getenv("API_PUBLIC_URL") or "https://mind-world-app-mv4yv.ondigitalocean.app").rstrip("/")
    redirect_uri = f"{api_base}/auth/google/signin/callback"
    state_token = state or create_oauth_state(source)

    params = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state_token,
            "access_type": "online",
            "prompt": "select_account",
        }
    )
    return f"https://accounts.google.com/o/oauth2/v2/auth?{params}", state_token


def create_auth_handoff_code(user_id: str, email: str, source: str, has_password: bool) -> str:
    """Store a one-time code; return the plaintext code for the redirect URL."""
    from services.database import get_supabase

    code = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc).timestamp() + HANDOFF_CODE_TTL_SECS
    expires_iso = datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat()

    supabase = get_supabase()
    # Best-effort cleanup of expired rows (ignore failures).
    try:
        supabase.table("auth_handoff_codes").delete().lt("expires_at", datetime.now(timezone.utc).isoformat()).execute()
    except Exception:
        pass

    supabase.table("auth_handoff_codes").insert(
        {
            "code_hash": hash_secret(code),
            "user_id": user_id,
            "email": email.lower().strip(),
            "source": source if source in ("web", "extension") else "web",
            "has_password": bool(has_password),
            "expires_at": expires_iso,
        }
    ).execute()
    return code


def exchange_auth_handoff_code(code: str) -> dict:
    """Consume a one-time handoff code and issue a session token."""
    from services.database import get_supabase

    raw = (code or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Handoff code required.")

    code_hash = hash_secret(raw)
    supabase = get_supabase()
    result = (
        supabase.table("auth_handoff_codes")
        .select("code_hash, user_id, email, source, has_password, expires_at")
        .eq("code_hash", code_hash)
        .limit(1)
        .execute()
    )
    row = result.data[0] if result.data else None
    if not row:
        raise HTTPException(status_code=401, detail="Invalid or expired sign-in code.")

    # Delete first so concurrent exchanges cannot both succeed.
    supabase.table("auth_handoff_codes").delete().eq("code_hash", code_hash).execute()

    expires_at = row.get("expires_at")
    try:
        if isinstance(expires_at, str):
            exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        else:
            exp_dt = expires_at
        if exp_dt.tzinfo is None:
            exp_dt = exp_dt.replace(tzinfo=timezone.utc)
        if exp_dt < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Invalid or expired sign-in code.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired sign-in code.")

    session = _session_response(row["user_id"], row["email"])
    session["source"] = row.get("source") if row.get("source") in ("web", "extension") else "web"
    session["needs_password"] = not bool(row.get("has_password"))
    return session


def verify_session_token(email: str, access_token: str) -> str:
    """Return user_id if token is valid for email, else raise HTTPException."""
    email = _validate_email_format(email)
    token = (access_token or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Access token required.")

    user = _get_user_auth_row(email)
    if not user or not user.get("session_token_hash"):
        raise HTTPException(status_code=401, detail="Invalid or expired session. Please sign in again.")

    if not session_token_matches(user["session_token_hash"], token):
        raise HTTPException(status_code=401, detail="Invalid or expired session. Please sign in again.")

    return user["id"]


def establish_session(email: str, access_token: Optional[str] = None, api_key: Optional[str] = None) -> dict:
    """
    Check or obtain a session token.

    - Valid existing token → return the same token. Not rotating means two
      callers refreshing at once, or a response lost when the popup closes,
      can't leave the client holding a token the server no longer accepts.
    - Bound API key that matches → issue token (legacy Advanced Settings only)
    - Otherwise → 401
    """
    email = _validate_email_format(email)
    user = _get_user_auth_row(email)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Session expired. Sign in with your password or Google account.",
        )

    user_id = user["id"]

    if access_token and session_token_matches(user.get("session_token_hash"), access_token):
        return {"access_token": access_token, "email": email.lower().strip(), "refreshed": True}

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
    """Return user_id after verifying session token or already-bound API key."""
    email = _validate_email_format(email)
    token = (access_token or "").strip()
    key = (api_key or "").strip()

    if token:
        return verify_session_token(email, token)

    if key:
        user = _get_user_auth_row(email)
        if not user:
            raise HTTPException(status_code=401, detail="Sign in required.")
        if verify_api_key_for_user(user["id"], key, user.get("api_key_hash")):
            return user["id"]
        raise HTTPException(status_code=401, detail="Invalid Anthropic API key.")

    raise HTTPException(status_code=401, detail="Sign in required.")


def require_authenticated_user(email: str, access_token: Optional[str]) -> str:
    """Gate sensitive account operations — must present a valid session token."""
    return verify_session_token(email, access_token or "")


def get_account_auth_info(email: str, access_token: str) -> dict:
    """Return whether the signed-in user has password and/or Google login linked."""
    require_authenticated_user(email, access_token)
    user = _get_user_auth_row(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return {
        "email": email.lower().strip(),
        "has_password": bool(user.get("password_hash")),
        "has_google": bool(user.get("google_id")),
    }


def set_account_password(
    email: str,
    access_token: str,
    password: str,
    current_password: Optional[str] = None,
) -> dict:
    """Set or change the Mind World password for a signed-in user."""
    require_authenticated_user(email, access_token)
    user = _get_user_auth_row(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    if len(password or "") < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.",
        )

    if user.get("password_hash"):
        if not current_password:
            raise HTTPException(status_code=400, detail="Current password required to change your password.")
        if not verify_password(current_password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect.")

    from services.database import get_supabase

    supabase = get_supabase()
    supabase.table("users").update({"password_hash": hash_password(password)}).eq("id", user["id"]).execute()
    return {"success": True, "has_password": True}
