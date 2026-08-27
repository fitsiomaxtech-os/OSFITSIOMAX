"""Why a patient booked with a Consultant is missing from that Consultant's own board.

Read-only. Answers the question the two screens cannot: Branch Leads prints the appointment
with "Riswana" against it, My Consultation opens on an empty book, and neither says which
of them is wrong.

They agree about the person and disagree about the RECORD. An appointment stores
`doctor_id` -- one `doctors` record -- and the consultant's own board resolves its record
from their login through _resolve_hp_doctor. Everything they see hangs off that one id:
their patients are the appointments carrying it, their calendar is its slots. So one person
holding two `doctors` records is enough to empty the board while the booking sits safely on
the other one.

More than one is not exotic. Several paths mint these records --  hiring, a Team posting,
Fitsiomax Experts, the calendar roster -- and consolidate_head_physio_doctors in seed.py
exists because they have collided before. A record written without a `user_id` is the usual
seed of it: nothing links it to the login, so the next path that looks for one by login
finds nothing and writes a second.

This prints every record the named person holds, how many appointments and slots sit on
each, which one their board resolves to, and therefore which bookings they can and cannot
see. _resolve_hp_doctor is imported rather than re-stated, so this cannot drift from what
the board does.

Run on the server, where backend/.env is:

    cd backend && python tools/consultant_patients_check.py riswana
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import v3_col  # noqa: E402
from deps import HEAD_PHYSIO_ROLES  # noqa: E402
from routers.v3_head_physio_board import _resolve_hp_doctor  # noqa: E402


def key(value) -> str:
    return str(value or "").strip().lower()


def hit(value, needle) -> bool:
    return needle in key(value)


def head(text):
    print()
    print(text)
    print("-" * len(text))


class Caller:
    """The two fields _resolve_hp_doctor reads off a logged-in user, and nothing else."""

    def __init__(self, user):
        self.id = user["id"]
        self.role = user.get("role") or ""


async def main(needle="riswana"):
    needle = key(needle)

    users = await v3_col("users").find({}, {"_id": 0, "password": 0}).to_list(2000)
    mine = [u for u in users if hit(u.get("full_name"), needle) or hit(u.get("email"), needle)]
    head('LOGIN  (Roles & Credentials)')
    if not mine:
        print("  nobody by that name -- a consultant with no login has no board to open")
        return
    for u in mine:
        desk = "consultation desk" if key(u.get("role")) in HEAD_PHYSIO_ROLES else "NOT a consultant role"
        print("  " + str(u.get("full_name")) + "  <" + str(u.get("email")) + ">")
        print("      id " + str(u.get("id")) + "   role " + str(u.get("role")) + "  -- " + desk)
        print("      active " + str(u.get("is_active")) + "   employee_id " + str(u.get("employee_id") or "(none)"))

    user = mine[0]
    if len(mine) > 1:
        print()
        print("  " + str(len(mine)) + " logins match. Reading the first.")

    # Every consultant record that could be this person: linked by login, by employee, or
    # sitting unlinked under the same name. The third is the one that goes missing.
    docs = await v3_col("doctors").find({"profile_type": "head_physio"}, {"_id": 0}).to_list(2000)
    theirs = [
        d for d in docs
        if d.get("user_id") == user["id"]
        or (user.get("employee_id") and d.get("employee_id") == user["employee_id"])
        or (not d.get("user_id") and key(d.get("full_name")) == key(user.get("full_name")))
    ]

    head("CONSULTANT RECORDS  (`doctors`, profile_type head_physio)")
    if not theirs:
        print("  none -- nothing can be booked against them and their board has nothing to open")
        return

    counts = {}
    for d in theirs:
        counts[d["id"]] = await v3_col("appointments").count_documents({"doctor_id": d["id"]})

    for d in theirs:
        link = "linked to this login" if d.get("user_id") == user["id"] else (
            "linked to ANOTHER login " + str(d.get("user_id")) if d.get("user_id")
            else "NO user_id -- unlinked"
        )
        print("  record " + str(d.get("id")))
        print("      " + link)
        print("      appointments " + str(counts[d["id"]])
              + "   slots " + str(len(d.get("slots") or []))
              + "   branch_id " + str(d.get("branch_id") or "(none -- correct for a consultant)"))
        print("      active " + str(d.get("is_active", True)) + "   created " + str(d.get("created_at")))

    resolved = await _resolve_hp_doctor(Caller(user))
    head("WHAT THEIR BOARD OPENS")
    if not resolved:
        print("  nothing resolves -- My Consultation shows an empty book")
    else:
        print("  record " + str(resolved["id"]) + "   appointments " + str(counts.get(resolved["id"], 0)))

    stranded = sum(c for rid, c in counts.items() if not resolved or rid != resolved["id"])
    head("VERDICT")
    if len(theirs) == 1 and resolved:
        if counts.get(resolved["id"], 0) == 0:
            print("  One record, and nothing is booked against it. The bookings are")
            print("  somewhere else entirely -- check the appointment's own doctor_id, or")
            print("  whether the booking was made at all.")
        else:
            print("  One record, resolved, holding its bookings. This is not the fault.")
    elif stranded:
        print("  " + str(stranded) + " appointment(s) sit on a record their board does not open.")
        print("  That is the whole of it: the booking is real and the board is looking")
        print("  at the other record. The records want merging onto the one holding the")
        print("  bookings, and the spare one's user_id clearing.")
    else:
        print("  " + str(len(theirs)) + " records, and every booking is on the one their board opens.")
        print("  Nothing is stranded. If the board still looks empty the fault is later")
        print("  than this -- the stage the lead sits at, or the branch the board scopes to.")


if __name__ == "__main__":
    asyncio.run(main(*sys.argv[1:]))
