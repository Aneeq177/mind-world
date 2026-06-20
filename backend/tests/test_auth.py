import hashlib
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from services.auth import (
    authenticate_user,
    establish_session,
    hash_password,
    hash_secret,
    login_with_password,
    register_with_password,
    require_authenticated_user,
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
        mock_db = MagicMock()
        mock_db.get_or_create_user.return_value = "user-1"
        with patch.dict("sys.modules", {"services.database": mock_db}):
            with pytest.raises(HTTPException) as exc:
                establish_session("user@example.com")
    assert exc.value.status_code == 401


@patch("services.auth.verify_session_token", return_value="user-1")
def test_authenticate_user_accepts_valid_token(mock_verify):
    user_id = authenticate_user("a@b.com", access_token="tok")
    assert user_id == "user-1"


def test_authenticate_user_rejects_missing_credentials():
    with pytest.raises(HTTPException) as exc:
        authenticate_user("a@b.com")
    assert exc.value.status_code == 401


def test_hash_password_and_verify():
    hashed = hash_password("secure-password-1")
    assert verify_password("secure-password-1", hashed)
    assert not verify_password("wrong-password", hashed)


@patch("services.auth.issue_session_token", return_value="session-token")
@patch("services.auth._get_user_auth_row")
def test_register_with_password_sets_hash(mock_auth_row, mock_issue):
    mock_auth_row.return_value = None
    mock_db = MagicMock()
    mock_db.get_or_create_user.return_value = "user-1"
    with patch.dict("sys.modules", {"services.database": mock_db}):
        result = register_with_password("new@example.com", "password123")
    assert result["access_token"] == "session-token"
    assert result["email"] == "new@example.com"


@patch("services.auth._get_user_auth_row")
def test_login_with_password_rejects_bad_password(mock_auth_row):
    mock_auth_row.return_value = {
        "id": "user-1",
        "password_hash": hash_password("correct-password"),
    }
    with pytest.raises(HTTPException) as exc:
        login_with_password("user@example.com", "wrong-password")
    assert exc.value.status_code == 401
