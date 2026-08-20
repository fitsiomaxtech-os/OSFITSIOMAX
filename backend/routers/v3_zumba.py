"""Zumba registrations for a branch.

Zumba is sold alongside the clinic's own verticals but is not a clinical journey: nobody
is consulted, treated or discharged, so it never belonged in the leads pipeline where
every row carries a branch_stage and a consultation decision. It gets its own small
collection and its own tab.

What the branch actually wants to know is where the registrations came from, so the
summary is a split by source. A referral names the master who made it, which is why the
masters are listed one by one rather than sitting behind a single "Masters" option: the
question asked of a referral is always which master, and a name typed once is offered from
then on. Fee's Collected sits among the source cards counting the registrations whose
money is actually in, which is a different question from how many registered.

Money is stored on the registration rather than in the finance ledger: a Zumba fee is a
flat class fee with no package, no installments and no consultation behind it, and putting
it through the leads' fee machinery would have meant inventing a lead to hang it on.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import v3_col
from deps import v3_current_user, is_branch_admin_role, is_zumba_role
from schemas.v3 import V3UserOut
from utils import now_iso

router = APIRouter(prefix="/api/v3")

# How a registration arrived. MASTER carries a master_name alongside it — the others are
# whole answers on their own.
MASTER = "master"
SOURCES = (MASTER, "board", "consultations", "branch", "social_media", "personal", "fitsiomax")
DEFAULT_SOURCE = "personal"

# The first cut of this tab shipped with a different, shorter vocabulary. Rows written then
# still say "direct" or "consultant", so they are read forward rather than left to fall
# through to the default and quietly change which card they count towards. "fitsiomax" is
# not listed: it is a source in its own right now and needs no translation.
LEGACY_SOURCES = {
    "direct": "personal",
    "consultant": "consultations",
    "masters": MASTER,
}

# Which summary card a source counts towards.
#
# Direct means nobody referred them: they walked in, they found the page, they read the
# board. Every other card names whoever did the referring. That is the line the cards are
# actually drawn on, and it is why three sources feed Direct while the rest feed one card
# each — a registration taken straight into this tab is Direct by default, since the
# default source is the one nobody referred.
CARD_OF_SOURCE = {
    "personal": "direct",
    "social_media": "direct",
    "board": "direct",
    "consultations": "consultant",
    "branch": "branch",
    MASTER: "masters",
    "fitsiomax": "fitsiomax",
}
CARDS = ("direct", "consultant", "branch", "masters", "fitsiomax")

# The class runs three evenings a week, the same three the membership is sold on (see
# ZUMBA_CLASS_DAYS in frontend/src/components/PackagesBoard.jsx). Monday, Wednesday and
# Friday as Python numbers them.
CLASS_WEEKDAYS = {0, 2, 4}
# Read in local time, not UTC: at 9pm on a Friday in India, UTC has not reached Friday's
# end but the class has been and gone -- and on a Monday morning UTC is still on Sunday,
# which would report no class on a day the room is full.
IST = timezone(timedelta(hours=5, minutes=30))


def _is_class_day_today() -> bool:
    return datetime.now(IST).weekday() in CLASS_WEEKDAYS


async def require_zumba_reader(user: V3UserOut = Depends(v3_current_user)) -> V3UserOut:
    """Who may read and keep the class roll: the branch that runs it, the Zumba desk that
    fills it, and Super Admin. Written as a predicate rather than a role tuple because the
    Zumba role's slug is typed by hand and varies by install."""
    if is_branch_admin_role(user.role) or is_zumba_role(user.role):
        return user
    raise HTTPException(status_code=403, detail="Not allowed")


def _source(value) -> str:
    slug = str(value or "").strip().lower()
    slug = LEGACY_SOURCES.get(slug, slug)
    return slug if slug in SOURCES else DEFAULT_SOURCE


def _amount(value) -> float:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return amount if amount > 0 else 0.0


def _age(value) -> Optional[int]:
    """Blank rather than 0 when it is not known — a Zumba class takes anyone, and a 0 in an
    age column reads as a fact about the person rather than as a gap in the record."""
    try:
        age = int(value)
    except (TypeError, ValueError):
        return None
    return age if 0 < age < 120 else None


class ZumbaInput(BaseModel):
    name: str
    phone: Optional[str] = ""
    age: Optional[int] = None
    address: Optional[str] = ""
    source: Optional[str] = DEFAULT_SOURCE
    # Only meaningful when source is "master"; dropped otherwise, so moving the source off
    # a referral cannot leave a stale master's name attached to the row.
    master_name: Optional[str] = ""
    fee_amount: Optional[float] = 0
    fee_paid: Optional[float] = 0


def _own_branch_only(user: V3UserOut) -> bool:
    """Everyone but Super Admin reads one branch: their own.

    A Zumba master runs the class at the branch they were hired into, so they are scoped
    exactly as the Branch Admin above them is. Super Admin is the only account that may
    ask for another branch, or for all of them at once.
    """
    if user.role == "super_admin":
        return False
    return is_branch_admin_role(user.role) or is_zumba_role(user.role)


def _scoped_branch(user: V3UserOut, branch_id: Optional[str]) -> Optional[str]:
    """Branch Admin and the Zumba desk are locked to their own branch; Super Admin may pass
    one or omit it to see every branch at once, the same rule the finance and board
    endpoints use."""
    if _own_branch_only(user):
        return user.branch_id
    return branch_id


def _shape(row: dict) -> dict:
    """The stored row plus the card it counts towards, worked out here so the list and the
    summary can never disagree about where a registration belongs."""
    source = _source(row.get("source"))
    return {**row, "source": source, "card": CARD_OF_SOURCE.get(source, "direct")}


def _master_of(row: dict) -> str:
    return (row.get("master_name") or "").strip()


def _own_master_name(user: V3UserOut) -> str:
    """The name a Zumba master's own referrals are filed under.

    A registration names its master as free text, typed by whoever entered it, so the link
    back to the master's account is that name matching theirs. Anyone else gets "" and is
    read by branch alone.
    """
    return (user.full_name or "").strip() if is_zumba_role(user.role) else ""


def _visible_query(user: V3UserOut, branch_id: Optional[str]) -> Optional[dict]:
    """Which registrations this account may read, or None when that is none of them.

    A Zumba master reads their branch's roll AND every registration naming them, whatever
    branch it was entered against — the second half because naming a master on a row is
    how it is meant to reach them, and it did not. It is a union, not a filter: nothing
    that used to be visible stops being, and Branch Admin and Super Admin are untouched.

    Without the name clause a master whose account carries no branch read an empty board
    however many students had been filed against their name, which is a strange way for a
    class roll to report that an account is misconfigured.
    """
    clauses = []
    if branch_id:
        clauses.append({"branch_id": branch_id})
    own_master = _own_master_name(user)
    if own_master:
        # Compared whole and case-folded: "master 1" and "Master 1" are one person, while a
        # substring match would hand "Master 1" every row belonging to "Master 12". Done as
        # $expr rather than a regex so a typed name is never parsed as a pattern.
        clauses.append({"$expr": {"$eq": [
            {"$toLower": {"$trim": {"input": {"$ifNull": ["$master_name", ""]}}}},
            own_master.lower(),
        ]}})
    if not clauses:
        # Super Admin asking for every branch at once. Anyone else with nothing to scope by
        # reads nothing, which the caller turns into an empty board.
        return None if _own_branch_only(user) else {}
    return clauses[0] if len(clauses) == 1 else {"$or": clauses}


def _extra(lead: dict, *keys):
    """Age and address are configured lead fields rather than columns, so they arrive in
    extra_fields under whatever key the branch set up. Try the likely ones and give up
    quietly — a blank age is a gap in the record, not a reason to fail the list."""
    extra = lead.get("extra_fields") or {}
    for k in keys:
        for candidate in (k, k.title(), k.upper(), k.replace("_", " ").title()):
            if extra.get(candidate) not in (None, ""):
                return extra[candidate]
    return ""


async def _referred_rows(branch_id: Optional[str]) -> list:
    """Zumba referrals made by a CONSULTANT, read off the leads rather than copied here.

    A referral is a decision recorded on the consultation, so this reads it live instead of
    writing a registration at Save & Move. Un-ticking Zumba on the decision takes the row
    back out on its own, and there is no second copy of the patient to keep in step with
    the first. The cost is that these rows cannot be edited or deleted from this tab, which
    is right: the consultation owns them.
    """
    query = {"zumba_recommended": True}
    if branch_id:
        query["branch_id"] = branch_id
    leads = await v3_col("leads").find(query, {
        "_id": 0, "id": 1, "name": 1, "phone": 1, "branch_id": 1, "extra_fields": 1,
        "zumba_package_name": 1, "zumba_package_price": 1, "zumba_package_sessions": 1,
        "updated_at": 1,
    }).to_list(2000)
    if not leads:
        return []

    # When the referral was made: the moment the decision holding it was last saved. Read
    # from the activity trail rather than from a field, so nothing has to be written into
    # the consultation's own save path to support this tab.
    activities = await v3_col("lead_activity").find(
        {"lead_id": {"$in": [l["id"] for l in leads]}, "action": "consultation_decision_saved"},
        {"_id": 0, "lead_id": 1, "created_at": 1},
    ).to_list(4000)
    saved_at = {}
    for a in activities:
        prev = saved_at.get(a["lead_id"])
        if not prev or (a.get("created_at") or "") > prev:
            saved_at[a["lead_id"]] = a.get("created_at") or ""

    rows = []
    for l in leads:
        rows.append({
            # Prefixed so it cannot collide with a registration's uuid, and so the frontend
            # can tell at a glance that this row is not one of its own.
            "id": f"lead:{l['id']}",
            "lead_id": l["id"],
            "branch_id": l.get("branch_id"),
            "name": l.get("name") or "",
            "phone": l.get("phone") or "",
            "age": _age(_extra(l, "age")),
            "address": str(_extra(l, "address", "city", "location") or ""),
            "source": "consultations",
            "card": "consultant",
            "master_name": "",
            # What the package costs. Nothing is collected here: a referred patient pays
            # through the consultation's own fee steps, and reporting money as in the
            # drawer because a package was named would be a lie the accountant inherits.
            "fee_amount": _amount(l.get("zumba_package_price")),
            "fee_paid": 0.0,
            "package_name": l.get("zumba_package_name") or "",
            "package_sessions": l.get("zumba_package_sessions"),
            "created_at": saved_at.get(l["id"]) or l.get("updated_at") or "",
            "created_by": "Consultation",
            # The tab reads this and offers no Edit or Delete: the consultation owns it.
            "origin": "consultation",
        })
    return rows


@router.get("/branch/zumba")
async def list_zumba(
    branch_id: Optional[str] = Query(None),
    user: V3UserOut = Depends(require_zumba_reader),
):
    branch_id = _scoped_branch(user, branch_id)
    query = _visible_query(user, branch_id)
    if query is None:
        return {"summary": {}, "registrations": [], "masters": []}

    raw = await v3_col("zumba_registrations").find(query, {"_id": 0}).to_list(2000)
    # A consultant's referral carries no master, so it can only be scoped by branch. An
    # account with no branch to scope by gets none of them rather than every branch's.
    referred = await _referred_rows(branch_id) if (branch_id or not _own_branch_only(user)) else []
    rows = [_shape(r) for r in raw] + referred
    # Sorted after the merge, not before: two sources of rows interleave by date the way
    # one would, rather than arriving as two blocks.
    rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)

    # today_session is who is booked into today's class, not who turned up: the class runs
    # Mon/Wed/Fri and a member is booked into every one of them, so on a class day it is the
    # whole roll and on any other day there is no class to be booked into. Nothing here
    # reads attendance, which is not recorded -- a member who skips a Friday still counts,
    # because they held the seat.
    class_day = _is_class_day_today()
    summary = {"all": len(rows), "fee_collected": 0, "fee_total": 0.0}
    summary["today_session"] = len(rows) if class_day else 0
    summary["is_class_day"] = class_day
    for card in CARDS:
        summary[card] = 0
    for r in rows:
        summary[r["card"]] += 1
        paid = _amount(r.get("fee_paid"))
        if paid > 0:
            summary["fee_collected"] += 1
            summary["fee_total"] += paid

    # The masters this branch has actually been referred by, gathered off the registrations
    # themselves. No separate roster to keep in step with reality: a name typed once is
    # offered from then on, and a master nobody has referred anybody never clutters it.
    masters = sorted(
        {_master_of(r) for r in rows if r["source"] == MASTER and _master_of(r)},
        key=str.lower,
    )

    return {"summary": summary, "registrations": rows, "masters": masters}


def _clean(payload: ZumbaInput) -> dict:
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    source = _source(payload.source)
    master_name = (payload.master_name or "").strip()
    if source == MASTER and not master_name:
        raise HTTPException(status_code=400, detail="Which master referred them?")

    return {
        "name": name,
        "phone": (payload.phone or "").strip(),
        "age": _age(payload.age),
        "address": (payload.address or "").strip(),
        "source": source,
        "master_name": master_name if source == MASTER else "",
        "fee_amount": _amount(payload.fee_amount),
        "fee_paid": _amount(payload.fee_paid),
    }


@router.post("/branch/zumba")
async def add_zumba(
    payload: ZumbaInput,
    branch_id: Optional[str] = Query(None),
    user: V3UserOut = Depends(require_zumba_reader),
):
    branch_id = _scoped_branch(user, branch_id)
    if not branch_id:
        raise HTTPException(status_code=400, detail="Pick a branch to register against")

    row = {
        "id": str(uuid.uuid4()),
        "branch_id": branch_id,
        **_clean(payload),
        "created_at": now_iso(),
        "created_by": user.full_name or user.email,
    }
    await v3_col("zumba_registrations").insert_one(dict(row))
    return _shape(row)


@router.patch("/branch/zumba/{registration_id}")
async def update_zumba(
    registration_id: str,
    payload: ZumbaInput,
    user: V3UserOut = Depends(require_zumba_reader),
):
    existing = await v3_col("zumba_registrations").find_one({"id": registration_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Registration not found")
    # A Branch Admin or a Zumba master edits their own branch's registrations, nobody else's.
    if _own_branch_only(user) and existing.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=403, detail="Not your branch")

    changes = {
        **_clean(payload),
        "updated_at": now_iso(),
        "updated_by": user.full_name or user.email,
    }
    await v3_col("zumba_registrations").update_one({"id": registration_id}, {"$set": changes})
    return _shape({**existing, **changes})


@router.delete("/branch/zumba/{registration_id}")
async def delete_zumba(
    registration_id: str,
    user: V3UserOut = Depends(require_zumba_reader),
):
    existing = await v3_col("zumba_registrations").find_one({"id": registration_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Registration not found")
    if _own_branch_only(user) and existing.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=403, detail="Not your branch")
    await v3_col("zumba_registrations").delete_one({"id": registration_id})
    return {"deleted": True}
