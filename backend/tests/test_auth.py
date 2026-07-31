import hashlib
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from services.auth import (
    authenticate_user,
    create_oauth_state,
    establish_session,
    get_account_auth_info,
    hash_password,
    hash_secret,
    link_or_create_google_user,
    login_with_password,
    register_with_password,
    require_authenticated_user,
    set_account_password,
    verify_api_key_for_user,
    verify_oauth_state,
    verify_password,
    verify_session_token,
)


def test_hash_secret_is_deterministic():
    assert hash_secret("abc") == hashlib.sha256(b"abc").hexdigest()


def test_verify_session_token_rejects_missing_token():
    with pytest.raises(HTTPException) as exc:
        verify_session_token("user@example.com", "")
    assert exc.value.status_code == 401


@patch("services.auth.verify_session_token", return_value="user-1")
def test_require_authenticated_user_delegates(mock_verify):
    user_id = require_authenticated_user("a@b.com", "tok")
    assert user_id == "user-1"
    mock_verify.assert_called_once_with("a@b.com", "tok")


def test_establish_session_rejects_email_only():
    with patch("services.auth._get_user_auth_row") as mock_auth_row:
        mock_auth_row.return_value = {"id": "user-1", "session_token_hash": None, "api_key_hash": None}
        with pytest.raises(HTTPException) as exc:
            establish_session("user@example.com")
    assert exc.value.status_code == 401


def test_establish_session_rejects_unbound_api_key():
    """A valid Anthropic key must not authenticate an account that never bound one."""
    with patch("services.auth._get_user_auth_row") as mock_auth_row:
        mock_auth_row.return_value = {
            "id": "user-1",
            "session_token_hash": None,
            "api_key_hash": None,
        }
        with patch("services.auth.verify_anthropic_api_key", return_value=True):
            with pytest.raises(HTTPException) as exc:
                establish_session("user@example.com", api_key="sk-ant-attacker-key")
    assert exc.value.status_code == 401


def test_verify_api_key_for_user_does_not_bind_new_keys():
    assert verify_api_key_for_user("user-1", "sk-ant-new", None) is False


def test_authenticate_user_accepts_valid_token():
    with patch("services.auth.verify_session_token", return_value="user-1") as mock_verify:
        user_id = authenticate_user("a@b.com", access_token="tok")
    assert user_id == "user-1"
    mock_verify.assert_called_once_with("a@b.com", "tok")


def test_authenticate_user_rejects_missing_credentials():
    with pytest.raises(HTTPException) as exc:
        authenticate_user("a@b.com")
    assert exc.value.status_code == 401


def test_authenticate_user_rejects_api_key_for_unknown_email():
    with patch("services.auth._get_user_auth_row", return_value=None):
        with pytest.raises(HTTPException) as exc:
            authenticate_user("missing@example.com", api_key="sk-ant-x")
    assert exc.value.status_code == 401


def test_hash_password_and_verify():
    hashed = hash_password("secure-password-1")
    assert verify_password("secure-password-1", hashed)
    assert not verify_password("wrong-password", hashed)


@patch("services.auth.issue_session_token", return_value="session-token")
def test_register_with_password_sets_hash(mock_issue):
    mock_supabase = MagicMock()
    mock_db = MagicMock()
    mock_db.get_or_create_user.return_value = "user-1"
    mock_db.get_supabase.return_value = mock_supabase
    with patch("services.auth._get_user_auth_row", return_value=None):
        with patch.dict("sys.modules", {"services.database": mock_db}):
            result = register_with_password("new@example.com", "password123")
    assert result["access_token"] == "session-token"
    assert result["email"] == "new@example.com"
    mock_supabase.table.return_value.update.return_value.eq.return_value.execute.assert_called_once()


def test_register_rejects_existing_google_only_account():
    with patch("services.auth._get_user_auth_row") as mock_auth_row:
        mock_auth_row.return_value = {
            "id": "user-1",
            "password_hash": None,
            "google_id": "google-123",
        }
        with pytest.raises(HTTPException) as exc:
            register_with_password("victim@example.com", "password123")
    assert exc.value.status_code == 409


@patch("services.auth._get_user_auth_row")
def test_login_with_password_rejects_bad_password(mock_auth_row):
    mock_auth_row.return_value = {
        "id": "user-1",
        "password_hash": hash_password("correct-password"),
    }
    with pytest.raises(HTTPException) as exc:
        login_with_password("user@example.com", "wrong-password")
    assert exc.value.status_code == 401


def test_link_or_create_google_user_rejects_email_collision():
    with patch("services.auth._get_user_by_google_id", return_value=None):
        with patch("services.auth._get_user_auth_row") as mock_row:
            mock_row.return_value = {"id": "user-1", "password_hash": "x", "google_id": None}
            with pytest.raises(HTTPException) as exc:
                link_or_create_google_user("google-new", "existing@example.com")
    assert exc.value.status_code == 409


def test_link_or_create_google_user_returns_existing_google_id():
    with patch("services.auth._get_user_by_google_id") as mock_by_google:
        mock_by_google.return_value = {
            "id": "user-1",
            "password_hash": "hashed",
            "google_id": "google-123",
        }
        user_id, has_password = link_or_create_google_user("google-123", "a@b.com")
    assert user_id == "user-1"
    assert has_password is True


def test_oauth_state_roundtrip():
    state = create_oauth_state("extension")
    source = verify_oauth_state(state, state)
    assert source == "extension"


def test_oauth_state_rejects_mismatch():
    state = create_oauth_state("web")
    with pytest.raises(HTTPException) as exc:
        verify_oauth_state(state, "different-cookie")
    assert exc.value.status_code == 400


@patch("services.auth.require_authenticated_user", return_value="user-1")
@patch("services.auth._get_user_auth_row")
def test_get_account_auth_info(mock_auth_row, mock_require):
    mock_auth_row.return_value = {
        "id": "user-1",
        "password_hash": None,
        "google_id": "google-123",
    }
    info = get_account_auth_info("user@example.com", "tok")
    assert info["has_password"] is False
    assert info["has_google"] is True


@patch("services.auth.require_authenticated_user", return_value="user-1")
@patch("services.auth._get_user_auth_row")
def test_set_account_password_for_google_user(mock_auth_row, mock_require):
    mock_auth_row.return_value = {
        "id": "user-1",
        "password_hash": None,
        "google_id": "google-123",
    }
    mock_supabase = MagicMock()
    mock_db = MagicMock()
    mock_db.get_supabase.return_value = mock_supabase
    with patch.dict("sys.modules", {"services.database": mock_db}):
        result = set_account_password("user@example.com", "tok", "new-password-1")
    assert result["success"] is True
    assert result["has_password"] is True
    mock_supabase.table.return_value.update.return_value.eq.return_value.execute.assert_called_once()


@patch("services.auth.require_authenticated_user", return_value="user-1")
@patch("services.auth._get_user_auth_row")
def test_set_account_password_requires_current_password_when_set(mock_auth_row, mock_require):
    mock_auth_row.return_value = {
        "id": "user-1",
        "password_hash": hash_password("existing-password"),
    }
    with pytest.raises(HTTPException) as exc:
        set_account_password("user@example.com", "tok", "new-password-1")
    assert exc.value.status_code == 400
