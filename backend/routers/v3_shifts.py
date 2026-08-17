"""TIME MANAGEMENT — the shifts a branch runs, and who works which one.

Four windows come seeded (Morning, Evening, Online, Full Time) and every one of them is
editable, because clinic hours are a branch's own business. Assigning one to an expert is
what makes it real: from then on their CONSULTANT / PHYSIO / DIET calendar is only opened
across those hours.

See shift_utils for why assignment lives on the `doctors` row and why shifts are looked up
by id rather than by branch.
"""

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from database import v3_col
from deps import is_branch_admin_role, v3_require_roles
from schemas.v3 import V3UserOut
from shift_utils import (
    DATE_RE,
    attach_shifts,
    day_windows_of,
    ensure_branch_shifts,
    overrides_of,
    parse_hhmm,
    public_shift,
    shift_map,
    window_of,
)
from utils import active_doctor_query, now_iso

router = APIRouter(prefix="/api/v3")

# Branch Admin runs their own branch's hours; Super Admin can reach any branch's. HR Admin
# creates the experts but does not roster them — the calendars they are published onto
# belong to the branch.
MANAGE_ROLES = ("branch_admin", "super_admin")

MAX_NAME_LEN = 40

# The three calendars a shift can be rostered against — CONSULTANT, PHYSIO and DIET, by
# their `doctors.profile_type`. Anything else is a typo in a caller rather than an empty
# branch, so it is refused instead of answered with an empty list.
ROSTER_TYPES = ("head_physio", "physio", "nutrition_coach")


def _scoped_branch(user: V3UserOut, branch_id: str) -> str:
    """A Branch Admin only ever manages their own branch, whatever id is in the URL."""
    if is_branch_admin_role(user.role):
        if not user.branch_id:
            raise HTTPException(status_code=400, detail="Your login is not attached to a branch")
        return user.branch_id
    if not branch_id:
        raise HTTPException(status_code=400, detail="Branch is required")
    return branch_id


def _clean_window(start: str, end: str) -> tuple:
    start_min, end_min = parse_hhmm(start), parse_hhmm(end)
    if start_min is None or end_min is None:
        raise HTTPException(status_code=400, detail="Times must be in 24-hour HH:MM form")
    if end_min <= start_min:
        # A window that ends before it starts would produce no slots at all, and a calendar
        # that silently opens nothing is read as broken rather than as misconfigured.
        raise HTTPException(status_code=400, detail="The shift must end after it starts")
    return start, end


def _clean_name(name: str) -> str:
    body = (name or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Give the shift a name")
    if len(body) > MAX_NAME_LEN:
        raise HTTPException(status_code=400, detail=f"Shift name must be under {MAX_NAME_LEN} characters")
    return body


async def _shift_for(user: V3UserOut, shift_id: str) -> dict:
    row = await v3_col("shifts").find_one({"id": shift_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Shift not found")
    if is_branch_admin_role(user.role) and row.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=403, detail="That shift belongs to another branch")
    return row


@router.get("/branches/{branch_id}/shifts")
async def list_shifts(branch_id: str, user: V3UserOut = Depends(v3_require_roles(*MANAGE_ROLES))):
    rows = await ensure_branch_shifts(_scoped_branch(user, branch_id))
    return {"shifts": [public_shift(r) for r in rows]}


class ShiftInput(BaseModel):
    name: str
    start_time: str
    end_time: str


@router.post("/branches/{branch_id}/shifts")
async def create_shift(branch_id: str, payload: ShiftInput, user: V3UserOut = Depends(v3_require_roles(*MANAGE_ROLES))):
    bid = _scoped_branch(user, branch_id)
    name = _clean_name(payload.name)
    start, end = _clean_window(payload.start_time, payload.end_time)
    existing = await ensure_branch_shifts(bid)
    row = {
        "id": str(uuid.uuid4()),
        "branch_id": bid,
        # No `key`: only the four seeded windows carry one, and it is what stops them being
        # re-seeded after a rename. A branch's own shift has nothing to be re-seeded from.
        "key": None,
        "name": name,
        "start_time": start,
        "end_time": end,
        "order": max([r.get("order", 0) for r in existing], default=-1) + 1,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await v3_col("shifts").insert_one(row.copy())
    return public_shift(row)


class ShiftUpdate(BaseModel):
    name: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None


@router.patch("/shifts/{shift_id}")
async def update_shift(shift_id: str, payload: ShiftUpdate, user: V3UserOut = Depends(v3_require_roles(*MANAGE_ROLES))):
    row = await _shift_for(user, shift_id)
    changes = {"updated_at": now_iso()}
    if payload.name is not None:
        changes["name"] = _clean_name(payload.name)
    # Both ends are validated against each other even when only one was sent, so a new
    # start cannot be pushed past the end that is already stored.
    start = payload.start_time if payload.start_time is not None else row.get("start_time")
    end = payload.end_time if payload.end_time is not None else row.get("end_time")
    if payload.start_time is not None or payload.end_time is not None:
        changes["start_time"], changes["end_time"] = _clean_window(start, end)
    await v3_col("shifts").update_one({"id": shift_id}, {"$set": changes})
    return public_shift({**row, **changes})


@router.delete("/shifts/{shift_id}")
async def delete_shift(shift_id: str, user: V3UserOut = Depends(v3_require_roles(*MANAGE_ROLES))):
    await _shift_for(user, shift_id)
    await v3_col("shifts").delete_one({"id": shift_id})
    # Everyone on it goes back to no shift rather than keeping a dangling id: their
    # calendar re-opens across the default day, which is the honest reading of "this
    # expert has no roster" and is recoverable by assigning another shift.
    released = await v3_col("doctors").update_many(
        {"shift_id": shift_id},
        {"$set": {"shift_id": None, "updated_at": now_iso()}},
    )
    return {"deleted": True, "unassigned": released.modified_count}


class DoctorShiftInput(BaseModel):
    # None clears the assignment — the expert goes back to the default working day.
    shift_id: Optional[str] = None


@router.patch("/doctors/{doctor_id}/shift")
async def set_doctor_shift(
    doctor_id: str,
    payload: DoctorShiftInput,
    user: V3UserOut = Depends(v3_require_roles(*MANAGE_ROLES)),
):
    doctor = await v3_col("doctors").find_one({"id": doctor_id}, {"_id": 0})
    if not doctor:
        raise HTTPException(status_code=404, detail="Expert not found")
    if payload.shift_id:
        await _shift_for(user, payload.shift_id)
    await v3_col("doctors").update_one(
        {"id": doctor_id},
        {"$set": {"shift_id": payload.shift_id or None, "updated_at": now_iso()}},
    )
    updated = await v3_col("doctors").find_one({"id": doctor_id}, {"_id": 0})
    return (await attach_shifts([updated]))[0]


class DayShiftInput(BaseModel):
    # The days being changed, "YYYY-MM-DD". A list because the calendar lets several days be
    # selected at once, and "these three Saturdays are evenings" is one decision, not three.
    dates: List[str]
    # None puts the days back on the expert's usual shift.
    shift_id: Optional[str] = None


@router.patch("/doctors/{doctor_id}/day-shift")
async def set_doctor_day_shift(
    doctor_id: str,
    payload: DayShiftInput,
    user: V3UserOut = Depends(v3_require_roles(*MANAGE_ROLES)),
):
    """Work a different shift on particular days, without changing the usual one.

    A roster that can only state the usual pattern makes every exception a permanent edit
    that has to be remembered and undone — so the Morning physio who comes in full-time on
    Tuesday ends up either published wrong or left off the calendar. The exception is
    recorded against the date instead, and the expert stays on Morning.

    Only what the day is *opened* across changes. Slots already published on these days are
    left exactly as they are, booked or not: this decides what the next day opened contains,
    and nothing else in the OS is allowed to drop a patient's slot as a side effect.
    """
    doctor = await v3_col("doctors").find_one({"id": doctor_id}, {"_id": 0})
    if not doctor:
        raise HTTPException(status_code=404, detail="Expert not found")
    dates = [d.strip() for d in (payload.dates or []) if isinstance(d, str) and DATE_RE.match(d.strip())]
    if not dates:
        raise HTTPException(status_code=400, detail="Pick at least one date")
    if payload.shift_id:
        await _shift_for(user, payload.shift_id)

    # Read-modify-write the whole map rather than $set-ing one dotted key at a time: the
    # dates come in as a batch and this keeps clearing (removing keys) and setting on the
    # one code path.
    overrides = dict(overrides_of(doctor))
    for date in dates:
        if payload.shift_id:
            overrides[date] = payload.shift_id
        else:
            overrides.pop(date, None)
    await v3_col("doctors").update_one(
        {"id": doctor_id},
        {"$set": {"shift_overrides": overrides, "updated_at": now_iso()}},
    )

    shifts = await shift_map([doctor.get("shift_id"), *overrides.values()])
    return {
        "doctor_id": doctor_id,
        "dates": dates,
        "shift": window_of(shifts.get(payload.shift_id)) if payload.shift_id else None,
        "day_shifts": day_windows_of({"shift_overrides": overrides}, shifts),
    }


@router.get("/branches/{branch_id}/shift-roster")
async def shift_roster(
    branch_id: str,
    profile_type: str = "head_physio",
    user: V3UserOut = Depends(v3_require_roles(*MANAGE_ROLES)),
):
    """The experts of one calendar kind, each with the shift they are on.

    Lists the same people the matching calendar tab lists, and for the same reason:
    CONSULTANTs are org-wide (they take consultations at any branch off one record) while
    Physios and Nutrition Coaches belong to the branch they treat at. Rostering someone the
    calendar does not show — or missing someone it does — is the one way this tab can lie.
    """
    if profile_type not in ROSTER_TYPES:
        raise HTTPException(status_code=400, detail="Unknown calendar")
    bid = _scoped_branch(user, branch_id)
    if profile_type == "head_physio":
        query = {"profile_type": "head_physio"}
    else:
        query = {"profile_type": profile_type, "branch_id": bid}
    rows = await v3_col("doctors").find(active_doctor_query(query), {"_id": 0}).to_list(500)
    if profile_type == "head_physio":
        # The multi-branch model leaves one CONSULTANT with several `doctors` rows. The
        # calendar collapses them by login and keeps the row carrying the slots; this has
        # to collapse them the same way, or the shift gets written onto the row nobody's
        # calendar is published on and the rostered hours never take effect.
        best: dict = {}
        for row in rows:
            key = row.get("user_id") or row.get("full_name") or row["id"]
            seen = best.get(key)
            if not seen or len(row.get("slots") or []) > len(seen.get("slots") or []):
                best[key] = row
        rows = list(best.values())
    rows.sort(key=lambda r: (r.get("full_name") or "").lower())
    experts = await attach_shifts(rows)
    return {
        "profile_type": profile_type,
        "experts": [
            {
                "id": e["id"],
                "full_name": e.get("full_name", ""),
                "specialization": e.get("specialization", ""),
                "profile_type": e.get("profile_type"),
                "shift_id": e.get("shift_id"),
                "shift_name": e.get("shift_name", ""),
                "shift_start": e.get("shift_start"),
                "shift_end": e.get("shift_end"),
                "slots_open": len(e.get("slots") or []),
            }
            for e in experts
        ],
    }
