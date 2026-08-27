"""Why a Consultant HR shows at a branch is missing from that branch's Consultant Calendar.

Read-only. Answers the question the two screens cannot: HR prints "Parrys Branch" on the
employee row, the Consultant Calendar at Parrys says nobody works this branch's side, and
neither says which of them is right.

They are reading different records. The row is the `employees` document. The calendar asks
GET /doctors?branch_id=<branch>, which lists `doctors` records -- and one of those exists
only for a LOGIN. Between the query and the screen the list passes four gates, any one of
which can empty it while the HR row goes on saying Parrys:

  1. active_doctor_query        -- the login is deactivated, or the branch was unticked
  2. the branch query           -- profile_type, which for every consultant role is head_physio
  3. consultants_serving_branch -- the branches on the LOGIN, not on the employee record
  4. _consultants_for_vertical  -- an online consultant is not offered by an offline branch

This walks those four in order against one person and prints which one drops them, and what
the record on each side actually says. The real helpers are imported rather than re-stated,
so this cannot drift from what the endpoint does.

Run on the server, where backend/.env is:

    cd backend && python tools/consultant_calendar_check.py monisha Parrys
    cd backend && python tools/consultant_calendar_check.py monisha
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import v3_col  # noqa: E402
from deps import HEAD_PHYSIO_ROLES, consultants_serving_branch  # noqa: E402
from routers.v3_config import (  # noqa: E402
    ORG_WIDE_PROFILES,
    _consultants_for_vertical,
    _names_the_online_arm,
)
from routers.v3_hr import _slugify_role  # noqa: E402
from utils import active_doctor_query  # noqa: E402


def key(value) -> str:
    return str(value or "").strip().lower()


def hit(value, needle) -> bool:
    return needle in key(value)


def head(text):
    print()
    print(text)
    print("-" * len(text))


async def main(needle="monisha", branch_needle="parrys"):
    needle, branch_needle = key(needle), key(branch_needle)

    branches = await v3_col("branches").find(
        {}, {"_id": 0, "id": 1, "branch_name": 1, "vertical": 1}
    ).to_list(500)
    name_of = {b["id"]: b.get("branch_name") or "(unnamed)" for b in branches}
    matched = [b for b in branches if hit(b.get("branch_name"), branch_needle)]
    if not matched:
        print('No branch matching "' + branch_needle + '". Branches: '
              + ", ".join(sorted(name_of.values())))
        return
    branch = matched[0]
    # The same derivation v3_get_doctors does: the branch's own vertical answers, and a
    # branch recorded without one reads as the room.
    want = "online" if _names_the_online_arm(branch.get("vertical")) else "offline"
    print('Consultant Calendar check -- "' + needle + '" at ' + name_of[branch["id"]])
    print("  branch id " + branch["id"] + "   vertical "
          + (branch.get("vertical") or "(none)") + " -> " + want + " arm")

    emps = await v3_col("employees").find({}, {"_id": 0}).to_list(5000)
    mine_emp = [e for e in emps if hit(e.get("full_name"), needle) or hit(e.get("employee_code"), needle)]
    head("EMPLOYEE  (HR > Department & Designation)")
    if not mine_emp:
        print("  nobody by that name")
    for e in mine_emp:
        slug = _slugify_role(str(e.get("designation") or ""))
        desk = "consultation desk" if slug in HEAD_PHYSIO_ROLES else "NOT a consultant desk"
        at = [name_of.get(b, b) for b in (e.get("branch_ids") or []) if b] or (
            [name_of.get(e.get("branch_id"), e.get("branch_id"))] if e.get("branch_id") else []
        )
        print("  " + str(e.get("full_name")) + "  " + str(e.get("employee_code") or "-")
              + "  id " + str(e.get("id")))
        print('    designation "' + str(e.get("designation")) + '" -> role ' + slug + "  (" + desk + ")")
        print("    branch: " + (", ".join(at) or "(none)")
              + "   status " + str(e.get("status") or "-")
              + "   work_type " + str(e.get("work_type") or "(unset)"))
    # work_type is the Online/Offline chip on the HR row. Printed so it can be seen not to
    # matter: no consultant query reads it, and a row reading Offline over a login whose
    # role is online_consultant is exactly the disagreement this tool is here to surface.
    if any(e.get("work_type") for e in mine_emp):
        print("    (work_type is HR's own chip -- no backend consultant query reads it)")

    emp_ids = {e["id"] for e in mine_emp}
    users = await v3_col("users").find({}, {"_id": 0, "password": 0}).to_list(5000)
    mine_user = [u for u in users if hit(u.get("full_name"), needle) or u.get("employee_id") in emp_ids]
    head("LOGIN  (HR > Credentials)")
    if not mine_user:
        print("  no account at all")
    for u in mine_user:
        at = [name_of.get(b, b) for b in (u.get("branch_ids") or []) if b] or (
            [name_of.get(u.get("branch_id"), u.get("branch_id"))] if u.get("branch_id") else []
        )
        linked = ("linked to employee " + str(u.get("employee_id"))) if u.get("employee_id") \
            else "NOT linked to any employee"
        desk = "consultation desk" if key(u.get("role")) in HEAD_PHYSIO_ROLES else "NOT a consultant role"
        print("  " + str(u.get("full_name")) + "  " + str(u.get("email")) + "  id " + str(u.get("id")))
        print("    role " + str(u.get("role")) + "  (" + desk + ")"
              + "   active " + str(u.get("is_active", True)))
        print("    branches: " + (", ".join(at) or "(none) -- for a Consultant that means NOWHERE")
              + "   " + linked)

    user_ids = {u["id"] for u in mine_user}
    docs = await v3_col("doctors").find({}, {"_id": 0}).to_list(5000)
    mine_doc = [
        d for d in docs
        if hit(d.get("full_name"), needle) or d.get("user_id") in user_ids or d.get("employee_id") in emp_ids
    ]
    head("EXPERT RECORD  (doctors -- what the calendar actually lists)")
    if not mine_doc:
        print("  none. Nothing to show at any branch.")
    for d in mine_doc:
        where = name_of.get(d.get("branch_id"), d.get("branch_id")) \
            or "(branchless -- correct for a Consultant)"
        print("  id " + str(d.get("id")) + "  profile_type " + str(d.get("profile_type"))
              + "  branch " + str(where))
        print("    user_id " + str(d.get("user_id") or "(none -- profile-only, from Fitsiomax Experts)")
              + "   is_active " + str(d.get("is_active", True))
              + "   branch_active " + str(d.get("branch_active", True)))
        print("    published slots: " + str(len(d.get("slots") or [])))

    head("THE FOUR GATES")
    shown = []
    if not mine_doc:
        print("  no expert record, so the list is empty before the first gate.")
    else:
        ids = {d["id"] for d in mine_doc}

        alive = await v3_col("doctors").find(
            active_doctor_query({"id": {"$in": list(ids)}}), {"_id": 0, "id": 1},
        ).to_list(100)
        alive_ids = {d["id"] for d in alive}
        print("  1. active_doctor_query         " + str(len(alive_ids)) + "/" + str(len(ids)) + " survive"
              + ("" if alive_ids else "   <- DROPPED: login deactivated, or branch unticked"))

        # The endpoint's own $or, rebuilt against this branch.
        step2 = [
            d for d in mine_doc
            if d["id"] in alive_ids and (
                d.get("branch_id") == branch["id"]
                or (d.get("profile_type") in ORG_WIDE_PROFILES and not d.get("branch_id"))
                or d.get("profile_type") == "head_physio"
            )
        ]
        print("  2. branch query                " + str(len(step2)) + "/" + str(len(alive_ids)) + " survive"
              + ("" if step2 or not alive_ids else "   <- DROPPED: profile_type is not the consultation desk"))

        step3 = await consultants_serving_branch(step2, branch["id"])
        print("  3. consultants_serving_branch  " + str(len(step3)) + "/" + str(len(step2)) + " survive"
              + ("" if step3 or not step2 else "   <- DROPPED: the LOGIN does not name this branch"))

        step4 = await _consultants_for_vertical(step3, want == "online")
        print("  4. vertical (" + want + ")" + " " * (10 - len(want)) + str(len(step4)) + "/" + str(len(step3)) + " survive"
              + ("" if step4 or not step3 else "   <- DROPPED: reads as the other arm, not " + want))

        shown = [d for d in step4 if d.get("profile_type") == "head_physio"]

    head("VERDICT")
    if shown:
        print("  " + str(len(shown)) + " record(s) reach the Consultant Calendar at "
              + name_of[branch["id"]] + ".")
        print("  If the screen is still empty, the browser is holding an old list -- reload it.")
        return
    print("  Nothing reaches the Consultant Calendar at " + name_of[branch["id"]] + ".")

    head("WHAT TO DO")
    consultant_logins = [u for u in mine_user if key(u.get("role")) in HEAD_PHYSIO_ROLES]
    if not consultant_logins:
        print("  There is no login on the consultation desk for this person. The employee row")
        print("  alone mints no expert record and no calendar. Create the account under")
        print("  HR > Credentials with role CONSULTANT, ticking this employee in the link field,")
        print("  and pick the branch there.")
    elif all(_names_the_online_arm(u.get("role")) for u in consultant_logins):
        print("  The login is on the ONLINE arm, so an offline branch will never offer it,")
        print("  whatever the Online/Offline chip on the HR row says. Change the account's role")
        print("  to CONSULTANT under HR > Credentials, or post them to an online branch.")
    else:
        print("  HR > Department & Designation > their row > Change > re-pick the branch > Save.")
        print("  That re-save is the repair: it finds the login by name, writes the link, and")
        print("  posts the branches to the account the calendar reads. Needs the backend running")
        print("  commit be328e4 or later.")


if __name__ == "__main__":
    asyncio.run(main(
        sys.argv[1] if len(sys.argv) > 1 else "monisha",
        sys.argv[2] if len(sys.argv) > 2 else "parrys",
    ))
