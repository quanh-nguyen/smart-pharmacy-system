from datetime import datetime, timedelta, timezone

import jwt
from pwdlib import PasswordHash

from . import config

password_hasher = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        return password_hasher.verify(password, stored_hash)
    except Exception:
        # The SQL demo seed contains placeholder hashes, not real passwords.
        return False


def create_access_token(user_id: int) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=config.ACCESS_TOKEN_MINUTES)
    payload = {"sub": str(user_id), "exp": expires}
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


def decode_access_token(token: str) -> int | None:
    try:
        payload = jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        return None
