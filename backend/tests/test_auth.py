import hashlib
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from services.auth import (
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
