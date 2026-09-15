"""Payment reminders, emailed to the patient around the day an installment falls due.

Every fee that can leave a balance keeps it the same way — unpaid rows on its own
payment_details.installments, each with a due_date (see FEE_SCHEDULES in v3_finance) — so
one sweep over those rows covers all five fees.

A reminder goes out at each of these points, counted in days from the due date:

    +3          three days before       "due on 18 Sep 2026 (in 3 days)"
     0          on the day              "due today"
    -3, -6, -9  while it stays overdue  "overdue — it was due on 18 Sep 2026"

and then stops: past that, chasing a balance is a call from the branch, not a fourth email.
Each point owns the days up to the next one, so a server that was down on the exact day
still sends it the day after instead of skipping it — and one that was down for a week
sends only the latest point, never a backlog.

Every attempt is written to `payment_reminders`, and a point already sent for an
installment is never sent again. Keyed on the due date as well, so an installment that is
rescheduled starts its reminders over. A failed send stays unsent and is retried on the
next hourly pass.

Sent only between 09:00 and 21:00 IST. Switched off with PAYMENT_REMINDERS_ENABLED=false
in backend/.env; without SMTP credentials (see email_utils) nothing is attempted at all.
"""
import asyncio
import logging
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from database import v3_col
from email_utils import SmtpNotConfigured, send_email, smtp_configured
from routers.v3_finance import FEE_SCHEDULES, _lead_outstanding_balance

logger = logging.getLogger(__name__)

# Fixed offset rather than zoneinfo: India has no daylight saving, and zoneinfo needs the
# tzdata package on a Windows dev machine.
IST = timezone(timedelta(hours=5, minutes=30))

# Days before (+) or after (-) the due date at which a reminder goes out, latest last.
MILESTONES = (3, 0, -3, -6, -9)
SEND_FROM_HOUR = 9
SEND_UNTIL_HOUR = 21
SWEEP_INTERVAL_SECONDS = 3600

ENABLED = os.environ.get("PAYMENT_REMINDERS_ENABLED", "true").strip().lower() not in ("0", "false", "no", "off")

_TASK: Optional[asyncio.Task] = None


def reminder_milestone(due_date: str, today: date) -> Optional[int]:
    """Which reminder point an installment due on `due_date` is at today, or None.

    A point covers the days from itself up to (not including) the next one: +3 covers 3..1
    days before, 0 covers the due date and the two days after, -3 covers 3..5 days late,
    and the last point covers three days like the others before reminders stop.
    """
    try:
        due = date.fromisoformat(str(due_date)[:10])
    except ValueError:
        return None
    days = (due - today).days
    for i, point in enumerate(MILESTONES):
        next_point = MILESTONES[i + 1] if i + 1 < len(MILESTONES) else point - 3
        if next_point < days <= point:
            return point
    return None


def _rs(amount) -> str:
    amount = round(float(amount or 0), 2)
    return f"Rs.{amount:,.0f}" if amount == int(amount) else f"Rs.{amount:,.2f}"


def _when(due_date: str, today: date) -> str:
    due = date.fromisoformat(str(due_date)[:10])
    on = due.strftime("%d %b %Y")
    days = (due - today).days
    if days > 0:
        return f"due on {on} (in {days} day{'' if days == 1 else 's'})"
    if days == 0:
        return f"due today ({on})"
    return f"overdue — it was due on {on}"


def build_reminder_email(lead: dict, rows: list, balance: float, today: date, branch: Optional[dict] = None) -> tuple:
    """(subject, body) for one patient. `rows` is [(fee, number, count, installment)],
    earliest due first, so the subject describes the most pressing one."""
    branch = branch or {}
    first_due = date.fromisoformat(str(rows[0][3]["due_date"])[:10])
    if first_due < today:
        subject = "Payment overdue — FITSIOMAX"
    elif first_due == today:
        subject = "Payment due today — FITSIOMAX"
    else:
        subject = f"Payment reminder — due {first_due.strftime('%d %b %Y')} — FITSIOMAX"

    items = []
    for fee, number, count, inst in rows:
        label = FEE_SCHEDULES[fee]["label"]
        part = f" — installment {number} of {count}" if count > 1 else ""
        items.append(f"  • {label}{part}: {_rs(inst.get('amount'))}, {_when(inst['due_date'], today)}")

    branch_name = branch.get("branch_name") or ""
    lines = [
        f"Hi {lead.get('name') or 'there'},",
        "",
        f"This is a reminder from FITSIOMAX{f' {branch_name}' if branch_name else ''} about the following payment{'' if len(rows) == 1 else 's'}:",
        "",
        *items,
        "",
        f"Total balance outstanding: {_rs(balance)}",
        "",
        "If you have already paid, please ignore this email.",
    ]
    if branch.get("phone"):
        lines.append(f"For any questions, call {branch_name or 'your branch'} on {branch['phone']}.")
    lines += ["", "Thank you,", "FITSIOMAX"]
    return subject, "\n".join(lines)


async def send_due_reminders(now: Optional[datetime] = None) -> dict:
    """One pass: email every patient with an installment at an unsent reminder point.

    One email per patient however many installments are due, so a patient owing on two
    fees gets one message listing both rather than two in the same minute. Raises
    SmtpNotConfigured when there are no credentials, since nothing after that can succeed.
    """
    today = (now or datetime.now(timezone.utc)).astimezone(IST).date()
    counts = {"sent": 0, "failed": 0, "no_email": 0}
    reminders = v3_col("payment_reminders")

    query = {"$or": [
        {f"{cfg['details']}.installments": {"$elemMatch": {"paid": {"$ne": True}}}}
        for cfg in FEE_SCHEDULES.values()
    ]}
    leads = await v3_col("leads").find(query, {"_id": 0}).to_list(20000)
    branches = {}

    for lead in leads:
        due_rows = []
        for fee, cfg in FEE_SCHEDULES.items():
            installments = (lead.get(cfg["details"]) or {}).get("installments") or []
            for number, inst in enumerate(installments, start=1):
                if inst.get("paid") or not inst.get("due_date"):
                    continue
                point = reminder_milestone(inst["due_date"], today)
                if point is None:
                    continue
                key = {
                    "lead_id": lead["id"], "fee": fee, "installment_number": number,
                    "due_date": str(inst["due_date"])[:10], "milestone": point, "channel": "email",
                }
                if await reminders.find_one({**key, "status": "sent"}, {"_id": 1}):
                    continue
                due_rows.append((key, (fee, number, len(installments), inst)))
        if not due_rows:
            continue

        email = (lead.get("email") or "").strip()
        if not email:
            counts["no_email"] += 1
            continue

        branch_id = lead.get("branch_id")
        if branch_id and branch_id not in branches:
            branches[branch_id] = await v3_col("branches").find_one(
                {"id": branch_id}, {"_id": 0, "branch_name": 1, "phone": 1},
            ) or {}
        due_rows.sort(key=lambda r: r[0]["due_date"])
        subject, body = build_reminder_email(
            lead, [row for _, row in due_rows], _lead_outstanding_balance(lead), today, branches.get(branch_id),
        )

        error = ""
        try:
            await asyncio.to_thread(send_email, email, subject, body)
            status = "sent"
        except SmtpNotConfigured:
            raise
        except Exception as exc:  # the SMTP error itself is logged by email_utils
            status, error = "failed", str(exc)

        stamp = datetime.now(timezone.utc).isoformat()
        for key, _ in due_rows:
            await reminders.update_one(
                key,
                {
                    "$set": {"status": status, "email": email, "error": error, "last_attempt_at": stamp,
                             **({"sent_at": stamp} if status == "sent" else {})},
                    "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": stamp},
                    "$inc": {"attempts": 1},
                },
                upsert=True,
            )
        counts[status] += 1

    return counts


async def _reminder_loop() -> None:
    while True:
        try:
            hour = datetime.now(IST).hour
            if SEND_FROM_HOUR <= hour < SEND_UNTIL_HOUR and smtp_configured():
                counts = await send_due_reminders()
                if any(counts.values()):
                    logger.info("Payment reminders: %s", counts)
        except SmtpNotConfigured:
            pass
        except Exception:
            logger.exception("Payment reminder pass failed")
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)


def start_payment_reminder_scheduler() -> None:
    """Spawn the singleton reminder task. Safe to call multiple times."""
    global _TASK
    if not ENABLED:
        logger.info("Payment reminders are switched off (PAYMENT_REMINDERS_ENABLED)")
        return
    if not smtp_configured():
        logger.warning("Payment reminders will not be emailed: SMTP_USER/SMTP_PASSWORD are not set in backend/.env")
    if _TASK is None or _TASK.done():
        _TASK = asyncio.get_event_loop().create_task(_reminder_loop())
