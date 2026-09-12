"""Two-factor codes — the one place a 2FA challenge is made, checked and re-sent.

There is one delivery method: a six-digit code to the address the account signs in with.
No SMS gateway is configured on this install (see v3_password_reset.py, which emails its
"mobile" OTP for the same reason), and an authenticator app would put a QR and a recovery
path in front of forty-eight people who mostly sign in from one machine.

The same challenge shape serves three moments, told apart by `purpose`:

    enable   turning 2FA on from the Security tab — proves the address can be read
             before the account starts depending on it
    disable  turning it off again — the same proof, so a borrowed desk cannot
             quietly remove the second factor
    login    the gate itself, after the password has already checked out

Codes are stored as a SHA-256 digest rather than in the clear, the same way the reset
tokens next door are. A challenge is single-use, expires in five minutes, survives five
wrong guesses and no more, and cannot be re-sent more often than once a minute.

Kept out of both routers because both need it: v3_auth.py raises a login challenge, and
v3_security.py raises the enable/disable ones.
"""
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from fastapi import HTTPException

from database import v3_col
from email_utils import SmtpNotConfigured, send_email, smtp_configured
from utils import now_iso, now_utc

OTP_TTL_MINUTES = 5
MAX_ATTEMPTS = 5
RESEND_COOLDOWN_SECONDS = 60

PURPOSES = ("login", "enable", "disable")

_SUBJECTS = {
    "login": "FitsiomaxOS — your sign-in code",
    "enable": "FitsiomaxOS — confirm two-factor authentication",
    "disable": "FitsiomaxOS — confirm turning off two-factor authentication",
}

_LINES = {
    "login": "Someone signed in to your FitsiomaxOS account with your password. Enter this code to finish signing in.",
    "enable": "You asked to turn on two-factor authentication for your FitsiomaxOS account. Enter this code to confirm.",
    "disable": "You asked to turn OFF two-factor authentication for your FitsiomaxOS account. Enter this code to confirm.",
}

_WARNINGS = {
    "login": "If this wasn't you, someone knows your password — change it as soon as you can.",
    "enable": "If this wasn't you, ignore this email. Nothing has changed.",
    "disable": "If this wasn't you, ignore this email — two-factor authentication stays ON. Then change your password.",
}


def hash_code(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def mask_email(email: str) -> str:
    """s****a@fitsiomax.clinic — enough to recognise the inbox, not enough to learn it.

    Shown on the code screen so somebody who has forgotten which address the account
    carries can tell whether to go looking for the mail, without the screen printing a
    full address to whoever is standing at the keyboard.
    """
    text = str(email or "")
    if "@" not in text:
        return text
    name, domain = text.split("@", 1)
    if len(name) <= 2:
        masked = (name[:1] or "*") + "*"
    else:
        masked = name[0] + "*" * (len(name) - 2) + name[-1]
    return f"{masked}@{domain}"


def _expired(row: Dict[str, Any]) -> bool:
    return datetime.fromisoformat(row["expires_at"]) < now_utc()


def _deliver(user: Dict[str, Any], purpose: str, code: str) -> None:
    """Mail the code, and turn a failure into an answer the screen can act on.

    The two failures are told apart because the reader can do something different about
    each. A server with no SMTP credentials will never send this code, however many times
    the button is pressed, and saying so is the difference between an administrator fixing
    a .env and a user retrying all afternoon. A configured server that failed once is worth
    trying again.

    Either way the real SMTP error is in the log by the time this runs — email_utils puts
    it there — because the sentence a user gets can never carry "535 Username and Password
    not accepted", and that is the sentence that fixes the problem.
    """
    try:
        send_email(
            user.get("email", ""),
            _SUBJECTS[purpose],
            (
                f"Hi {user.get('full_name', '')},\n\n"
                f"{_LINES[purpose]}\n\n"
                f"Code: {code}\n"
                f"It expires in {OTP_TTL_MINUTES} minutes.\n\n"
                f"{_WARNINGS[purpose]}"
            ),
        )
    except SmtpNotConfigured as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "This server cannot send email yet, so the code could not go out. An "
                "administrator needs to set SMTP_USER and SMTP_PASSWORD in backend/.env, "
                "then restart the backend."
            ),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="The verification code could not be emailed just now. Please try again in a moment.",
        ) from exc


async def issue_challenge(user: Dict[str, Any], purpose: str) -> Dict[str, Any]:
    """Raise a fresh challenge for this account and mail the code.

    Any challenge still open for the same account and purpose is dropped first. Two live
    codes for one sign-in means the older mail still works, which is a longer window than
    the five minutes this is supposed to be.
    """
    if purpose not in PURPOSES:
        raise HTTPException(status_code=400, detail="Unknown verification purpose")
    if not user.get("email"):
        raise HTTPException(status_code=400, detail="This account has no email address to send a code to")
    # Asked before the row is written, not after. _deliver would refuse this anyway, but by
    # then a challenge nobody can ever answer is already in the collection — and on the
    # login path that is a challenge id handed to a browser for a code that was never sent.
    if not smtp_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "This server cannot send email yet, so no code can be sent. An administrator "
                "needs to set SMTP_USER and SMTP_PASSWORD in backend/.env, then restart the backend."
            ),
        )

    await v3_col("two_factor_challenges").delete_many(
        {"user_id": user["id"], "purpose": purpose, "consumed": False}
    )

    code = f"{secrets.randbelow(1000000):06d}"
    challenge_id = str(uuid.uuid4())
    await v3_col("two_factor_challenges").insert_one({
        "id": challenge_id,
        "user_id": user["id"],
        "purpose": purpose,
        "code_hash": hash_code(code),
        "attempts": 0,
        "consumed": False,
        "created_at": now_iso(),
        "last_sent_at": now_iso(),
        "expires_at": (now_utc() + timedelta(minutes=OTP_TTL_MINUTES)).isoformat(),
    })
    _deliver(user, purpose, code)
    return {
        "challenge_id": challenge_id,
        "email_masked": mask_email(user["email"]),
        "expires_in": OTP_TTL_MINUTES * 60,
    }


async def resend_challenge(challenge_id: str, purpose: str) -> Dict[str, Any]:
    """A new code on the same challenge id, so the screen the user is on stays put.

    The old code stops working — a resend that left the previous one live would widen the
    window every time somebody pressed it.
    """
    row = await v3_col("two_factor_challenges").find_one(
        {"id": challenge_id, "purpose": purpose, "consumed": False}, {"_id": 0}
    )
    if not row:
        raise HTTPException(status_code=404, detail="This verification has expired — start again")

    elapsed = (now_utc() - datetime.fromisoformat(row["last_sent_at"])).total_seconds()
    if elapsed < RESEND_COOLDOWN_SECONDS:
        raise HTTPException(
            status_code=429,
            detail=f"Please wait {int(RESEND_COOLDOWN_SECONDS - elapsed)}s before asking for another code",
        )

    user = await v3_col("users").find_one({"id": row["user_id"], "is_active": True}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Account not found or inactive")

    code = f"{secrets.randbelow(1000000):06d}"
    await v3_col("two_factor_challenges").update_one(
        {"id": challenge_id},
        {"$set": {
            "code_hash": hash_code(code),
            # Attempts reset with the code. Five guesses were spent on a number that is no
            # longer the answer, and holding them against the new one locks out the person
            # who pressed Resend precisely because they never received the first.
            "attempts": 0,
            "last_sent_at": now_iso(),
            "expires_at": (now_utc() + timedelta(minutes=OTP_TTL_MINUTES)).isoformat(),
        }},
    )
    _deliver(user, purpose, code)
    return {
        "challenge_id": challenge_id,
        "email_masked": mask_email(user["email"]),
        "expires_in": OTP_TTL_MINUTES * 60,
    }


async def consume_challenge(challenge_id: str, code: str, purpose: str) -> Dict[str, Any]:
    """Check a code and, if it is right, spend the challenge. Returns the user document.

    Every failure path raises rather than returning a flag, so a caller cannot forget to
    look at one. The challenge is marked consumed before the caller acts on it, which is
    what makes a verified code single-use even if two requests arrive together.
    """
    row = await v3_col("two_factor_challenges").find_one(
        {"id": challenge_id, "purpose": purpose}, {"_id": 0}
    )
    if not row:
        raise HTTPException(status_code=404, detail="This verification has expired — start again")
    if row["consumed"]:
        raise HTTPException(status_code=400, detail="This code has already been used")
    if _expired(row):
        raise HTTPException(status_code=400, detail="That code has expired — ask for a new one")
    if row["attempts"] >= MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Too many incorrect codes — ask for a new one")

    if hash_code(str(code or "").strip()) != row["code_hash"]:
        await v3_col("two_factor_challenges").update_one({"id": challenge_id}, {"$inc": {"attempts": 1}})
        left = MAX_ATTEMPTS - row["attempts"] - 1
        raise HTTPException(
            status_code=401,
            detail=(
                f"That code is not right — {left} {'try' if left == 1 else 'tries'} left"
                if left > 0
                else "That code is not right — ask for a new one"
            ),
        )

    user = await v3_col("users").find_one({"id": row["user_id"], "is_active": True}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Account not found or inactive")

    await v3_col("two_factor_challenges").update_one(
        {"id": challenge_id}, {"$set": {"consumed": True, "verified_at": now_iso()}}
    )
    return user


def is_enabled(user: Optional[Dict[str, Any]]) -> bool:
    """Whether this account is gated. Absent on every account created before 2FA existed,
    which is every account today — so the default has to be off, not missing."""
    return bool((user or {}).get("two_factor_enabled"))
