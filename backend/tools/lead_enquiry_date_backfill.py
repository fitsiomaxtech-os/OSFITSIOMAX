"""Date a lead by when the patient enquired, not by when the sync reached them.

Dry-run by default. Prints what it would change and changes nothing:

    cd backend && python tools/lead_enquiry_date_backfill.py
    cd backend && python tools/lead_enquiry_date_backfill.py --apply
    cd backend && python tools/lead_enquiry_date_backfill.py --branch ANN

Why there is anything to move.

Both importers stamped created_at with now_iso() -- the moment the pull ran. That is not
when anybody enquired: a row the sheet picks up late is dated late, and every board that
narrows by date is built on that field, so a branch filtering to today was shown patients
who came in days earlier. The enquiry time was in the ad record the whole time, under
created_time.

The importers read it now (see enquiry_created_at in utils.py). That only helps rows
imported from here on -- both importers skip a phone number they already hold, so a
re-pull will not revisit a lead to correct it. This walks the ones already stored.

What it changes and what it leaves.

created_at only, and only where the lead carries an ad record with a readable
created_time. A lead typed in by hand, or off a sheet with no such column, has no better
answer than the one it already has and is left exactly as it is.

updated_at is set, as every write here does. patient_number is NOT touched: it is an
identifier, printed on things and quoted back by patients, and its date is a fact about
when the record was made rather than a claim about the enquiry. Expect it to disagree with
the new date on exactly the leads this moves -- that disagreement is what it looked like
before, read the other way round.

On the timezone, which is the whole reason a lead moves a day.

Meta stamps created_time in the AD ACCOUNT's zone -- this install's read -05:00 -- and the
day the clinic counts a lead on is the day Meta's own report puts it on. So the wall clock
is kept as written and re-anchored to the clinic's day rather than converted: an enquiry
at 14:42 on the 1st stays 14:42 on the 1st. Converted as an instant it would be 01:12 on
the 2nd in Chennai, which is the wrong side of a date somebody is counting against. All of
that lives in enquiry_created_at; this tool only calls it.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import v3_col  # noqa: E402
from utils import now_iso, enquiry_created_at  # noqa: E402


def day_of(iso_text) -> str:
    return str(iso_text or "")[:10] or "—"


async def main(apply: bool = False, branch_code: str = ""):
    branch_ids = None
    if branch_code:
        rows = await v3_col("branches").find(
            {"code": {"$regex": f"^{branch_code}$", "$options": "i"}}, {"_id": 0, "id": 1, "branch_name": 1},
        ).to_list(10)
        if not rows:
            print(f"No branch with code {branch_code!r}.")
            return
        branch_ids = [r["id"] for r in rows]
        print("Branch: " + ", ".join(r.get("branch_name") or r["id"] for r in rows))

    # $nin rather than two $ne keys: a dict literal keeps only the last of a repeated key,
    # so the null check would have been dropped on the way in and never run.
    query = {"lead_data.created_time": {"$exists": True, "$nin": [None, ""]}}
    if branch_ids:
        query["branch_id"] = {"$in": branch_ids}

    leads = await v3_col("leads").find(
        query, {"_id": 0, "id": 1, "name": 1, "patient_number": 1, "created_at": 1, "lead_data": 1},
    ).to_list(20000)

    if not leads:
        print("No leads carry an ad record with a created_time. Nothing to move.")
        return

    moving = []
    unreadable = []
    for lead in leads:
        raw = (lead.get("lead_data") or {}).get("created_time")
        enquired = enquiry_created_at(raw)
        if not enquired:
            unreadable.append((lead, raw))
            continue
        if enquired != lead.get("created_at"):
            moving.append((lead, enquired))

    print()
    print(f"{len(leads)} lead(s) carry an enquiry time.")
    print(f"{len(moving)} would be re-dated, {len(leads) - len(moving) - len(unreadable)} already correct.")

    # The day changing is what a person notices: a lead moving by an hour inside the same
    # day changes no count anywhere, and one crossing midnight changes every list it is on.
    day_moves = [(l, e) for l, e in moving if day_of(l.get("created_at")) != day_of(e)]
    print(f"{len(day_moves)} of those move to a different DAY, which is what changes a list.")

    if day_moves:
        print()
        print("  PATIENT NUMBER      NAME                      WAS          BECOMES")
        for lead, enquired in day_moves[:40]:
            print("  " + str(lead.get("patient_number") or "—").ljust(19)
                  + str(lead.get("name") or "—")[:24].ljust(26)
                  + day_of(lead.get("created_at")).ljust(13)
                  + day_of(enquired))
        if len(day_moves) > 40:
            print(f"    ... and {len(day_moves) - 40} more")

    if unreadable:
        print()
        print(f"  {len(unreadable)} carry a created_time nothing could be read out of, left alone:")
        for lead, raw in unreadable[:5]:
            print(f"    {lead.get('patient_number') or lead['id']}  {raw!r}")

    if not apply:
        print()
        print(f"Nothing written. Re-run with --apply to re-date the {len(moving)} above.")
        return

    for lead, enquired in moving:
        await v3_col("leads").update_one(
            {"id": lead["id"]},
            {"$set": {"created_at": enquired, "updated_at": now_iso()}},
        )
    print()
    print(f"Re-dated {len(moving)} lead(s) to when the patient enquired.")


if __name__ == "__main__":
    args = sys.argv[1:]
    branch = ""
    if "--branch" in args:
        i = args.index("--branch")
        branch = args[i + 1] if len(args) > i + 1 else ""
    asyncio.run(main(apply="--apply" in args, branch_code=branch))
