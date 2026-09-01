"""Move a lead's name out of extra_fields and onto its Name field.

Dry-run by default. Prints what it would change and changes nothing:

    cd backend && python tools/lead_name_backfill.py
    cd backend && python tools/lead_name_backfill.py --apply

Why there is anything to move.

auto_map_columns used to compare a sheet's headers to the alias table on the lowercased
header, string against string (FIELD_ALIASES in routers/v3_marketing.py). A Meta lead-ads
export heads its columns "full_name"; the alias reads "full name". One underscore apart,
so the column never matched, the name never reached the mapping, and the importer wrote
what it writes when it has no name -- "Unknown" (see v3_google_sheets.py). The answer was
not lost: every unmapped column is kept as extra detail under its own header, so those
leads are carrying their patient's name under "full_name" while every board that lists
them shows "Unknown".

auto_map_columns now matches on letters and digits alone, so "full_name" and "Full Name"
are one column asked twice. But that only helps rows imported from here on: both importers
skip a phone number they already hold, so a re-pull will not revisit a lead to correct it.
This walks the ones already stored.

What it will and will not move.

Only where the lead has no name of its own -- blank, or the "Unknown" placeholder -- and
only where the extra field holds something that reads like a name. A phone number, an
email address or a bare number under a name-ish header is left alone rather than written
onto the patient: a lead showing "Unknown" is visibly missing, where one showing
"9982878233" as its name looks answered and is not.

The value is copied to name and the extra_fields key dropped, so the answer reads once
rather than twice under two names -- the same reason the board holds the extra_fields copy
out of Enquiry Form, and the same thing lead_city_backfill.py does.
"""
import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import v3_col  # noqa: E402
from utils import now_iso  # noqa: E402
from routers.v3_marketing import FIELD_ALIASES, squash_header  # noqa: E402

# The spellings that mean the patient's name, squashed the way auto_map_columns compares
# them. Read off the alias table rather than restated here, so a spelling added there for
# the importer is one this tool recovers too.
NAME_HEADERS = {squash_header(a) for a in FIELD_ALIASES["name"]}

# What the importer writes when the name column never reached it.
PLACEHOLDER_NAMES = {"", "unknown", "n/a", "na", "-", "—"}


def looks_like_a_name(value: str) -> bool:
    """Whether this is a person, rather than the contents of a column filed beside them."""
    text = str(value or "").strip()
    if not text or len(text) > 80:
        return False
    if "@" in text:
        return False
    # At least one run of letters. Rules out "9982878233", "l:1773668330612345" and the
    # dates and ids that share a sheet with the name column.
    return bool(re.search(r"[^\W\d_]{2,}", text, re.UNICODE))


def recovered_name(lead: dict) -> tuple:
    """(key, value) of the extra field holding this lead's name, or (None, None)."""
    for key, value in (lead.get("extra_fields") or {}).items():
        if squash_header(key) in NAME_HEADERS and looks_like_a_name(value):
            return key, str(value).strip()
    return None, None


async def main(apply: bool = False):
    leads = await v3_col("leads").find(
        {"extra_fields": {"$exists": True, "$ne": {}}},
        {"_id": 0, "id": 1, "name": 1, "phone": 1, "patient_number": 1, "extra_fields": 1},
    ).to_list(100000)

    print(("APPLY" if apply else "DRY RUN") + " -- leads carrying extra detail: " + str(len(leads)))

    moving, kept_has_name, no_answer = [], [], []
    for lead in leads:
        key, value = recovered_name(lead)
        if not key:
            if str(lead.get("name") or "").strip().lower() in PLACEHOLDER_NAMES:
                no_answer.append(lead)
            continue
        if str(lead.get("name") or "").strip().lower() not in PLACEHOLDER_NAMES:
            kept_has_name.append((lead, key, value))
            continue
        moving.append((lead, key, value))

    def show(title, rows, limit=15):
        print()
        print(title + ": " + str(len(rows)))
        for lead, key, value in rows[:limit]:
            label = (lead.get("patient_number") or lead.get("phone") or lead.get("id", ""))[:22]
            print("    " + label.ljust(24) + value[:32].ljust(34) + "(from " + key + ")")
        if len(rows) > limit:
            print("    ... and " + str(len(rows) - limit) + " more")

    show("TO MOVE  (-> lead.name, key dropped)", moving)
    show("LEFT     (lead already has a name)", kept_has_name)
    if no_answer:
        print()
        print("SKIPPED  (named 'Unknown', no name-ish column to recover): " + str(len(no_answer)))
        for lead in no_answer[:10]:
            print("    " + str(lead.get("patient_number") or lead.get("id"))[:22].ljust(24)
                  + ", ".join(sorted((lead.get("extra_fields") or {}).keys()))[:70])
        if len(no_answer) > 10:
            print("    ... and " + str(len(no_answer) - 10) + " more")
        print("    (if a name is plainly in there under a header not listed in")
        print("     FIELD_ALIASES['name'], add the spelling there and re-run)")

    if not apply:
        print()
        print("Nothing written. Re-run with --apply to move the " + str(len(moving)) + " above.")
        return

    for lead, key, value in moving:
        update = {"$set": {"name": value, "updated_at": now_iso()}}
        # A header carrying a dot or a leading $ cannot be addressed as an update path --
        # "extra_fields.a.b" means a nested b, not a key called "a.b". Rare, and the name
        # is what this tool is for: the lead gets named either way, and the duplicate
        # under Enquiry Form is left rather than risking an unset that lands elsewhere.
        if "." not in key and not key.startswith("$"):
            update["$unset"] = {f"extra_fields.{key}": ""}
        await v3_col("leads").update_one({"id": lead["id"]}, update)
    print()
    print("Named " + str(len(moving)) + " lead(s) from their own sheet column.")


if __name__ == "__main__":
    asyncio.run(main(apply="--apply" in sys.argv[1:]))
