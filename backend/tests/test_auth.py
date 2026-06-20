import hashlib
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from services.auth import (
    authenticate_user,
    establish_session,
    hash_secret,
    require_authenticated_user,
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
