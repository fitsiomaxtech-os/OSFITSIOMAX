"""Why a physio's own board is empty while their patient's portal is full.

Read-only. Answers the question the two screens cannot: Physio Assign says the patient is
Sowdraya's, the client portal counts twelve sessions, and the Physiotherapist Master View
says nought of everything -- and neither screen says which of them is right.

They are reading from different ends of the same link. Physio Assign writes
`sessions.physio_id` and `leads.assigned_physio_id` as the id of a `doctors` RECORD, taken
straight from the branch's expert list; it never needs the physio's login. The board starts
from the LOGIN and has to find that record again, through _resolve_doctor:

  1. doctors.user_id == the login's id
  2. failing that, users.employee_id -> doctors.employee_id

A record written by a path that set neither -- and most were: in the snapshot in
db_backup, 26 of 29 physio records carry no user_id at all -- cannot be found from the
login at all. _resolve_doctor returns None, physio_patients returns {"patients": []}, and
every tile on the board reads 0 with nothing on screen to say why.

This walks it from both ends for one person and prints where the chain breaks: which
records exist for them, which of those the login can actually reach, and how much work is
sitting on the ones it cannot.

The real helpers are imported rather than re-stated, so this cannot drift from what the
board does.

Run on the server, where backend/.env is:

    cd backend && python tools/physio_board_check.py sowdraya
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import v3_col  # noqa: E402
from physio_scope import physio_lead_ids  # noqa: E402


def key(value) -> str:
    return str(value or "").strip().lower()


def hit(value, needle) -> bool:
    return needle in key(value)


def head(text):
    print()
    print(text)
    print("-" * len(text))


async def main(needle="sowdraya"):
    needle = key(needle)
    print('Physio board check -- "' + needle + '"')

    branches = await v3_col("branches").find(
        {}, {"_id": 0, "id": 1, "branch_name": 1}
    ).to_list(500)
    name_of = {b["id"]: b.get("branch_name") or "(unnamed)" for b in branches}

    users = await v3_col("users").find({}, {"_id": 0, "password": 0}).to_list(5000)
    mine_user = [u for u in users if hit(u.get("full_name"), needle) or hit(u.get("email"), needle)]
    head("LOGIN  (HR > Credentials)")
    if not mine_user:
        print("  no account by that name -- nothing can resolve, and nobody can sign in")
    for u in mine_user:
        print("  " + str(u.get("full_name")) + "  " + str(u.get("email")) + "  id " + str(u.get("id")))
        print("    role " + str(u.get("role"))
              + "   active " + str(u.get("is_active", True))
              + "   branch " + name_of.get(u.get("branch_id"), str(u.get("branch_id") or "(none)")))
        print("    employee_id " + str(u.get("employee_id") or "(none) -- gate 2 cannot run without this"))

    user_ids = {u["id"] for u in mine_user}
    emp_ids = {u.get("employee_id") for u in mine_user if u.get("employee_id")}

    docs = await v3_col("doctors").find({"profile_type": "physio"}, {"_id": 0}).to_list(5000)
    mine_doc = [
        d for d in docs
        if hit(d.get("full_name"), needle) or d.get("user_id") in user_ids or d.get("employee_id") in emp_ids
    ]
    head("EXPERT RECORDS  (doctors, profile_type physio)")
    if not mine_doc:
        print("  none. Nothing to assign to and nothing to resolve.")
    for d in mine_doc:
        reach = []
        if d.get("user_id") in user_ids:
            reach.append("user_id")
        if d.get("employee_id") in emp_ids:
            reach.append("employee_id")
        print("  id " + str(d.get("id"))
              + "   branch " + name_of.get(d.get("branch_id"), str(d.get("branch_id") or "(none)")))
        print("    user_id " + str(d.get("user_id") or "(none)")
              + "   employee_id " + str(d.get("employee_id") or "(none)"))
        print("    reachable from the login by: " + (", ".join(reach) or "NOTHING -- this record is orphaned"))

    head("WHAT IS SITTING ON EACH RECORD")
    total_work = {}
    for d in mine_doc:
        lead_ids = await physio_lead_ids(d["id"])
        sessions = await v3_col("sessions").count_documents({"physio_id": d["id"]})
        rehab = await v3_col("rehab_sessions").count_documents({"physio_id": d["id"]})
        total_work[d["id"]] = (len(lead_ids), sessions, rehab)
        print("  " + str(d.get("id")) + ": " + str(len(lead_ids)) + " patient(s), "
              + str(sessions) + " session(s), " + str(rehab) + " rehab day(s)")

    head("WHAT THE BOARD RESOLVES TO")
    # _resolve_doctor's own two gates, in its own order, without importing FastAPI.
    resolved = None
    for u in mine_user:
        by_user = await v3_col("doctors").find_one(
            {"user_id": u["id"], "profile_type": "physio"}, {"_id": 0, "id": 1},
        )
        if by_user:
            resolved = by_user["id"]
            print("  1. by user_id                 -> " + resolved)
            break
        print("  1. by user_id                 -> nothing")
        if u.get("employee_id"):
            by_emp = await v3_col("doctors").find_one(
                {"employee_id": u["employee_id"], "profile_type": "physio"}, {"_id": 0, "id": 1},
            )
            if by_emp:
                resolved = by_emp["id"]
                print("  2. by employee_id             -> " + resolved)
                break
            print("  2. by employee_id             -> nothing")
        else:
            print("  2. by employee_id             -> skipped, the login carries none")

    head("VERDICT")
    if not mine_user:
        print("  No login, so no board. Create the account under HR > Credentials.")
        return
    if resolved is None:
        orphaned = sum(total_work.get(d["id"], (0, 0, 0))[1] for d in mine_doc)
        print("  The login resolves to NO expert record, so the board returns an empty list")
        print("  and every tile reads 0. " + str(orphaned) + " session(s) are booked against")
        print("  record(s) it cannot reach -- which is why the patient's portal is full.")
        print()
        print("  Fix: link the record to the login. Either set doctors.user_id to the login's")
        print("  id on the record carrying the work, or give the login the employee_id that")
        print("  record already names.")
        return
    patients, sessions, rehab = total_work.get(resolved, (0, 0, 0))
    print("  The board resolves to " + resolved + ",")
    print("  which holds " + str(patients) + " patient(s), " + str(sessions) + " session(s), "
          + str(rehab) + " rehab day(s).")
    stranded = [d["id"] for d in mine_doc if d["id"] != resolved and total_work.get(d["id"], (0, 0, 0))[1]]
    if stranded:
        print()
        print("  But this person has " + str(len(stranded)) + " OTHER record(s) with sessions on them,")
        print("  and the board can only ever see the one above:")
        for rid in stranded:
            p, s, r = total_work[rid]
            print("    " + rid + "  " + str(p) + " patient(s), " + str(s) + " session(s), " + str(r) + " rehab day(s)")
        print("  Work assigned to those is invisible to this physio. They want merging onto")
        print("  the resolved record, or the assignment re-made against it.")
    elif sessions == 0:
        print()
        print("  Nothing is booked against it. If a patient was assigned, the assignment was")
        print("  written against a record this login does not reach -- re-run with the")
        print("  patient's physio_id to find which.")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "sowdraya"))
