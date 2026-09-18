"""The readable copy of a Client Portal password, kept encrypted at rest.

The clinic hands portal passwords out themselves — over the phone, on WhatsApp — so the
Patients popup has to be able to show the desk the password that is actually in force.
A bcrypt hash cannot be read back, so a second copy of the password is stored beside it.

That second copy is encrypted rather than written as it is, because this database is
dumped into db_backup/ and those dumps travel: a backup file should not be a list of every
patient's password in plain sight. The hash in `password_hash` stays what a sign-in is
checked against — this is only ever for showing staff, and only the three roles that may
already reset a password can ask for it.

The key comes from PORTAL_PASSWORD_KEY when it is set, which is where it belongs: outside
the database, so a stolen dump is not also the key to itself. When it is not set — no new
environment variable is needed to deploy this — one is generated on first use and kept in
the app_secrets collection, which still keeps passwords out of a casually-read backup.
"""
import base64
import hashlib
import logging
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from database import v3_col

_KEY_ID = "portal_password_key"
_fernet: Optional[Fernet] = None

log = logging.getLogger(__name__)


def _fernet_key(raw: str) -> bytes:
    """A Fernet key from whatever the environment supplies — a Fernet key as-is, or any
    other passphrase hashed into one, so setting the variable never fails on its format."""
    candidate = raw.strip()
    try:
        Fernet(candidate.encode())
        return candidate.encode()
    except Exception:
        return base64.urlsafe_b64encode(hashlib.sha256(candidate.encode()).digest())


async def _cipher() -> Fernet:
    global _fernet
    if _fernet is not None:
        return _fernet
    env = os.environ.get("PORTAL_PASSWORD_KEY") or ""
    if env:
        _fernet = Fernet(_fernet_key(env))
        return _fernet
    row = await v3_col("app_secrets").find_one({"id": _KEY_ID}, {"_id": 0, "key": 1})
    if not row:
        key = Fernet.generate_key().decode()
        # upsert, not insert: two workers booting together must end on one key, and the
        # one that loses the race reads the winner's rather than overwriting it.
        await v3_col("app_secrets").update_one(
            {"id": _KEY_ID}, {"$setOnInsert": {"id": _KEY_ID, "key": key}}, upsert=True,
        )
        row = await v3_col("app_secrets").find_one({"id": _KEY_ID}, {"_id": 0, "key": 1})
    _fernet = Fernet(_fernet_key(row["key"]))
    return _fernet


async def seal_password(password: str) -> str:
    """The stored form of a readable password. "" when there is nothing to store."""
    if not password:
        return ""
    return (await _cipher()).encrypt(password.encode()).decode()


async def open_password(sealed: str) -> str:
    """The password back, or "" when there is none stored or the key no longer opens it —
    an account made before this existed, or one sealed under a key since replaced. The
    popup then says the password cannot be shown and offers a reset, which is the honest
    answer either way.
    """
    if not sealed:
        return ""
    try:
        return (await _cipher()).decrypt(sealed.encode()).decode()
    except (InvalidToken, Exception):  # noqa: B014 - any failure means "cannot show it"
        log.warning("portal password could not be read back — key changed or value corrupt")
        return ""
