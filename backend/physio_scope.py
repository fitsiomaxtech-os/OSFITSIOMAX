"""Which leads a physio is responsible for."""
from database import v3_col


async def physio_lead_ids(physio_id: str) -> list:
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
    """
    assigned = await v3_col("leads").distinct("id", {"assigned_physio_id": physio_id})
    rehab = await v3_col("rehab_sessions").distinct("lead_id", {"physio_id": physio_id})
    return list(dict.fromkeys([*assigned, *rehab]))

async def physio_owns_lead(physio_id: str, lead_id: str) -> bool:
    """Whether one lead is this physio's patient — the single-lead form of the above.

    The list helper was written for "which patients are mine" and the endpoints that ask
    "is this one mine" were left comparing assigned_physio_id themselves, which is the
    half of the answer that is blank for a rehab patient. So a physio could see Rakshana
    on their own Patients list and be told the record was not theirs on opening it: the
    detail call 403'd, and because the page fetched it alongside the sessions in one
    Promise.all, the whole page came back empty rather than the one tab that failed.

    Kept beside physio_lead_ids so the two answers cannot drift apart.
    """
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0, "assigned_physio_id": 1})
    if lead and lead.get("assigned_physio_id") == physio_id:
        return True
    return bool(await v3_col("rehab_sessions").find_one(
        {"lead_id": lead_id, "physio_id": physio_id}, {"_id": 0, "id": 1}
    ))
