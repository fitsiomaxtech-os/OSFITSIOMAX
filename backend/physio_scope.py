"""Which expert records are a physio's, and which leads they are responsible for."""
from typing import Optional

from database import v3_col
from deps import collapse_duplicate_experts


def _ids(physio_id) -> list:
    """One record id or several, always as a list.

    Every caller here used to pass a single expert record id, because one physio was taken
    to mean one `doctors` row. They routinely hold several -- see resolve_physio_doctor --
    so these take either now, and a plain string keeps working unchanged for the callers
    that genuinely have one.
    """
    if not physio_id:
        return []
    if isinstance(physio_id, str):
        return [physio_id]
    return [p for p in physio_id if p]


async def resolve_physio_doctor(user_id: str, role: str = "", physio_id: Optional[str] = None) -> Optional[dict]:
    """The expert records belonging to the physio who is logged in, and which to open on.

    A physio's board starts from a LOGIN and has to find the `doctors` record it belongs
    to. Assign Physio never does: it writes the id of a record taken straight from the
    branch's expert list into sessions.physio_id and leads.assigned_physio_id, and never
    needs the login at all. Two ends of the same link -- and they part company the moment
    one person holds more than one record.

    They routinely do. Half a dozen paths mint these records and most carry no user_id to
    dedupe against -- 26 of the 29 physio records in the db_backup snapshot have none --
    so HR's branch sync cannot see what is already there and adds another beside it.
    collapse_duplicate_experts exists because Assign Physio was offering one physio three
    times over.

    This resolver was a find_one on user_id with an employee_id fallback, so it landed on
    at most one of those records, and on none at all where none of them carried the link.
    Every endpoint hanging off it then answered {"patients": []} and the board read 0
    across every tile with nothing on screen to say why -- which is exactly what "I
    assigned the physio and their master view is empty" looks like from the inside.

    So every record the person holds is collected, and the reads are scoped to all of them
    rather than to one. Which record the branch happened to book against stops mattering,
    and nothing is stranded on a twin: the physio sees their patients whichever of their
    own records the days were filed under.

    Three routes in, each tried only when the one before it finds nothing:

      1. doctors.user_id == the login's id -- the link, where it was ever written.
      2. users.employee_id -> doctors.employee_id -- the profile-only rows Fitsiomax
         Experts creates carry no user_id, but do carry the employee they were made for.
      3. the person's own name, among records carrying NO user_id at all.

    The third answers the common state, and it is fenced: a record already linked to
    another login is never claimed, so the wrong answer needs two physios of one name with
    an unlinked record between them. That is the trade collapse_duplicate_experts already
    makes when it merges on the name, for the reason it gives -- the pickers show a name
    and nothing else, so two of them were already indistinguishable there. Records at the
    person's own branch are preferred where any answer, so a namesake elsewhere loses to
    the physio actually standing there.

    Read-only. Nothing is merged, deleted or linked here: moving bookings between records
    is not a repair a page load should be making, and which record is the one to keep is a
    question about the data rather than about the code -- tools/physio_board_check.py
    answers it on the server.

    The record RETURNED is the survivor collapse_duplicate_experts would keep, so the board
    opens on the same row Assign Physio offers and the branch publishes hours against: its
    slots are the calendar, and its id is what a new assessment is filed under. The whole
    set rides along on `physio_ids`, which is what the reads scope by.
    """
    if physio_id and role == "super_admin":
        # Super Admin driving one physio's board names the record outright, so it is taken
        # as given rather than resolved -- a branch can have several physios and there is
        # no login here to match on.
        doctor = await v3_col("doctors").find_one(
            {"id": physio_id, "profile_type": "physio"}, {"_id": 0},
        )
        if doctor:
            return {**doctor, "physio_ids": [doctor["id"]]}

    mine = await v3_col("doctors").find(
        {"user_id": user_id, "profile_type": "physio"}, {"_id": 0},
    ).to_list(50)

    if not mine:
        raw_user = await v3_col("users").find_one(
            {"id": user_id},
            {"_id": 0, "employee_id": 1, "full_name": 1, "branch_id": 1, "branch_ids": 1},
        ) or {}
        if raw_user.get("employee_id"):
            mine = await v3_col("doctors").find(
                {"employee_id": raw_user["employee_id"], "profile_type": "physio"}, {"_id": 0},
            ).to_list(50)
        if not mine:
            mine = await _unlinked_records_named(raw_user)

    if not mine:
        return None

    primary = mine[0] if len(mine) == 1 else (await collapse_duplicate_experts(mine))[0]
    return {**primary, "physio_ids": list(dict.fromkeys([d["id"] for d in mine if d.get("id")]))}


async def _unlinked_records_named(raw_user: dict) -> list:
    """The physio records answering to this person's name that no login has claimed.

    Held to `user_id` being empty on purpose: a record already pointing at somebody else's
    login is theirs, whatever it is called, and is never taken from them here. Their own
    branch is preferred where it answers -- a namesake at another branch is a worse guess
    than the physio standing in the one whose patients these are.
    """
    name = str(raw_user.get("full_name") or "").strip().lower()
    if not name:
        return []
    rows = await v3_col("doctors").find(
        {"profile_type": "physio", "user_id": {"$in": [None, ""]}}, {"_id": 0},
    ).to_list(500)
    named = [d for d in rows if str(d.get("full_name") or "").strip().lower() == name]
    if not named:
        return []
    branches = [b for b in [raw_user.get("branch_id"), *(raw_user.get("branch_ids") or [])] if b]
    if branches:
        here = [d for d in named if d.get("branch_id") in branches]
        if here:
            return here
    return named


async def physio_lead_ids(physio_id) -> list:
    """Every lead this physio is responsible for, however they were given to them.

    Two ways in, and only one of them was ever counted. A treatment patient is handed over
    by setting assigned_physio_id on the lead; a rehab patient is handed over by booking
    rehab_sessions against the physio, and the lead itself is never stamped — the course is
    its own collection, deliberately (see v3_rehab).

    So a physio's own board could not see their rehab patients: absent from Patients,
    absent from Review, and on Treatment the day was drawn from a session row with no lead
    behind it, which is why the row showed a name and no phone and would not open.

    One helper because it was wrong in three places for one reason, and a fourth caller
    that forgets rehab would be the same bug again.

    Takes every record id the physio holds rather than one, for the same reason: a
    patient does not stop being theirs because the branch booked them against a duplicate
    row of the same person. See resolve_physio_doctor.
    """
    ids = _ids(physio_id)
    if not ids:
        return []
    assigned = await v3_col("leads").distinct("id", {"assigned_physio_id": {"$in": ids}})
    rehab = await v3_col("rehab_sessions").distinct("lead_id", {"physio_id": {"$in": ids}})
    return list(dict.fromkeys([*assigned, *rehab]))

async def physio_owns_lead(physio_id, lead_id: str) -> bool:
    """Whether one lead is this physio's patient — the single-lead form of the above.

    The list helper was written for "which patients are mine" and the endpoints that ask
    "is this one mine" were left comparing assigned_physio_id themselves, which is the
    half of the answer that is blank for a rehab patient. So a physio could see Rakshana
    on their own Patients list and be told the record was not theirs on opening it: the
    detail call 403'd, and because the page fetched it alongside the sessions in one
    Promise.all, the whole page came back empty rather than the one tab that failed.

    Kept beside physio_lead_ids so the two answers cannot drift apart — including in
    taking every record id the physio holds, or a patient their own list had just offered
    them would 403 for sitting on the other one.
    """
    ids = _ids(physio_id)
    if not ids:
        return False
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0, "assigned_physio_id": 1})
    if lead and lead.get("assigned_physio_id") in ids:
        return True
    return bool(await v3_col("rehab_sessions").find_one(
        {"lead_id": lead_id, "physio_id": {"$in": ids}}, {"_id": 0, "id": 1}
    ))
