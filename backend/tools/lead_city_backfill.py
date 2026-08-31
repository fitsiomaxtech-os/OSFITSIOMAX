"""Move a lead's city out of extra_fields["preferred_branch"] and onto its City field.

Dry-run by default. Prints what it would change and changes nothing:

    cd backend && python tools/lead_city_backfill.py
    cd backend && python tools/lead_city_backfill.py --apply

Why there is anything to move.

auto_map_columns used to list "city" among Preferred Branch's aliases (FIELD_ALIASES in
routers/v3_marketing.py), and Preferred Branch is not a field on a lead -- it is one of
the legacy keys that land in extra_fields. So every sheet with a City column had that
column claimed by Preferred Branch, and the answer filed under a name it was not: leads
carrying "Coimbatore" and "salem" as the branch they preferred, next to a City field that
was never written. Branch Leads' City column reads the lead's City and the usual
extra_fields spellings, so those leads show a dash while their sheet plainly has an answer.

The alias table and normalize_source now write City properly, but only for rows imported
from here on: both importers skip a phone number they already hold, so a re-pull will not
revisit a lead to correct it. This walks the ones already stored.

What it will and will not move.

Only where the value looks like a city and the lead has no City of its own. A source that
genuinely asks which branch somebody wants keeps its answer: a value matching one of the
branches on record is left where it is, under Preferred Branch, because for that lead it
is the true answer and not a misfiled city.

The value is copied to City and the extra_fields key dropped, so the answer reads once
rather than twice under two names -- the same reason the board holds the extra_fields copy
out of Enquiry Form.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import v3_col  # noqa: E402
from utils import now_iso  # noqa: E402

LEGACY_KEY = "preferred_branch"


def key(value) -> str:
    return str(value or "").strip().lower()


async def main(apply: bool = False):
    branches = await v3_col("branches").find({}, {"_id": 0, "branch_name": 1}).to_list(500)
    # A branch is written "Anna Nagar Branch" and a sheet answers "Anna Nagar", so the
    # word "branch" is dropped before comparing -- otherwise every real branch answer
    # reads as a city and gets moved.
    branch_names = {key(b.get("branch_name")).replace("branch", "").strip() for b in branches}
    branch_names.discard("")

    leads = await v3_col("leads").find(
        {f"extra_fields.{LEGACY_KEY}": {"$exists": True}},
        {"_id": 0, "id": 1, "name": 1, "city": 1, "extra_fields": 1},
    ).to_list(100000)

    print(("APPLY" if apply else "DRY RUN") + " -- leads carrying extra_fields." + LEGACY_KEY + ": " + str(len(leads)))

    moving, kept_branch, kept_has_city, empty = [], [], [], 0
    for lead in leads:
        value = str((lead.get("extra_fields") or {}).get(LEGACY_KEY) or "").strip()
        if not value:
            empty += 1
            continue
        if key(value) in branch_names:
            kept_branch.append((lead, value))
            continue
        if str(lead.get("city") or "").strip():
            kept_has_city.append((lead, value))
            continue
        moving.append((lead, value))

    def show(title, rows, limit=15):
        print()
        print(title + ": " + str(len(rows)))
        for lead, value in rows[:limit]:
            print("    " + (lead.get("name") or "Unknown")[:28].ljust(30) + value)
        if len(rows) > limit:
            print("    ... and " + str(len(rows) - limit) + " more")

    show("TO MOVE  (-> lead.city, key dropped)", moving)
    show("LEFT     (names a branch on record)", kept_branch)
    show("LEFT     (lead already has a City)", kept_has_city)
    if empty:
        print()
        print("SKIPPED  (key present but blank): " + str(empty))

    if not apply:
        print()
        print("Nothing written. Re-run with --apply to move the " + str(len(moving)) + " above.")
        return

    for lead, value in moving:
        await v3_col("leads").update_one(
            {"id": lead["id"]},
            {"$set": {"city": value, "updated_at": now_iso()}, "$unset": {f"extra_fields.{LEGACY_KEY}": ""}},
        )
    print()
    print("Moved " + str(len(moving)) + " lead(s) onto their City field.")


if __name__ == "__main__":
    asyncio.run(main(apply="--apply" in sys.argv[1:]))
