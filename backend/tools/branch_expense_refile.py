"""Re-file branch-drawer expenses that were written against no branch and self-approved.

Dry-run by default. Prints exactly what it would change and changes nothing:

    cd backend && python tools/branch_expense_refile.py "Anna Nagar"
    cd backend && python tools/branch_expense_refile.py "Anna Nagar" --apply
    cd backend && python tools/branch_expense_refile.py "Anna Nagar" --ids 1a2b,3c4d --apply

Why there is anything to re-file.

create_expense used to decide approval from the role alone -- `approved = not
is_branch_admin_role(user.role)`. A Super Admin or Business Dev standing in Branch >
Accountant Manage > Expenses is spending one branch's cash and can no more approve their
own spending than the Branch Admin can, but the role said otherwise, so their expense was
written approved, signed by themselves, in the same instant they typed it. It never
reached the accountant's queue and appeared straight under Expenses Approved.

The branch screen also sent no branch_id, and for a non-branch role the endpoint read that
as head office's own expense. So each row landed against no branch at all: the branch's
Cash in hand never fell for it, and Spent in cash read Rs.0 beside a list of spending.

Both were fixed in create_expense (`from_branch_drawer`). This walks the rows written
before that and puts them where they would have been written today: on the branch, pending,
waiting on the accountant -- and, where the amount is one the tin covers, with the tin
movement the expense should have written.

What it will and will not touch.

Only rows that carry the fingerprint of that bug: no branch, paid in cash, not rejected,
raised by a role that has no branch of its own, and approved by the same person who
raised it in the same breath. An accountant's own entry is left alone -- theirs being
approved as written is the rule, not the bug.

That fingerprint cannot tell one of these apart from a genuine org-wide cash expense a
Super Admin logged on the Finance board, because the two are the same row. So this asks
which branch rather than guessing, prints every candidate in full, and writes nothing
until it is run again with --apply. Read the list first; --ids narrows it to the ones you
name if it has caught something that really was head office's.
"""
import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import v3_col  # noqa: E402
from deps import is_branch_admin_role  # noqa: E402
from routers.v3_finance import (  # noqa: E402
    PETTY_CASH_LIMIT, _record_petty_cash_movement,
)


def rs(n):
    return "Rs." + format(float(n or 0), ",.0f")


def self_approved(row: dict) -> bool:
    """Approved by whoever raised it -- which is what the old code did on write.

    Compared on the name because that is all the row carries of either hand. A real
    sign-off by somebody else names somebody else.
    """
    by = str(row.get("approved_by") or "").strip().lower()
    return bool(by) and by == str(row.get("created_by") or "").strip().lower()


async def main(needle: str = "", apply: bool = False, only_ids=None):
    branches = await v3_col("branches").find({}, {"_id": 0, "id": 1, "branch_name": 1}).to_list(500)
    if not needle:
        print("Name the branch whose drawer this cash came out of. Branches on record:")
        for b in branches:
            print("    " + (b.get("branch_name") or "").ljust(30) + b["id"])
        return

    matches = [b for b in branches if needle.strip().lower() in (b.get("branch_name") or "").lower()]
    if len(matches) != 1:
        print(
            ("No branch matches " if not matches else "More than one branch matches ")
            + repr(needle) + ":"
        )
        for b in (matches or branches):
            print("    " + (b.get("branch_name") or "").ljust(30) + b["id"])
        return
    branch = matches[0]

    # An org-wide row is one with no branch on it, however that was stored -- the field
    # missing entirely, null, or an empty string all mean the same thing here.
    rows = await v3_col("expenses").find(
        {"branch_id": {"$in": [None, ""]}, "rejected": {"$ne": True}},
        {"_id": 0},
    ).sort("expense_date", -1).to_list(20000)

    candidates = [
        r for r in rows
        if (r.get("payment_mode") or "").strip().lower() == "cash"
        and not is_branch_admin_role(r.get("created_by_role") or "")
        and (r.get("created_by_role") or "").strip().lower() != "accountant"
        and r.get("approved")
        and self_approved(r)
    ]
    if only_ids:
        wanted = {i.strip() for i in only_ids if i.strip()}
        missing = wanted - {r.get("id") for r in candidates}
        candidates = [r for r in candidates if r.get("id") in wanted]
        for m in sorted(missing):
            print("NOT A CANDIDATE (left alone): " + m)

    print(
        ("APPLY" if apply else "DRY RUN") + " -- " + str(len(candidates))
        + " expense(s) to re-file onto " + (branch.get("branch_name") or branch["id"])
    )
    if not candidates:
        print("Nothing matches the fingerprint. Nothing to do.")
        return

    total = 0.0
    tin = []
    for r in candidates:
        amount = float(r.get("amount") or 0)
        total += amount
        petty = 0 < amount <= PETTY_CASH_LIMIT
        if petty:
            tin.append(r)
        print(
            "    " + str(r.get("expense_date") or "")[:10].ljust(12)
            + str(r.get("category") or "")[:16].ljust(18)
            + str(r.get("paid_to") or "")[:14].ljust(16)
            + rs(amount).rjust(12)
            + "   by " + str(r.get("created_by") or "?")
            + ("   [tin]" if petty else "")
        )
    print()
    print("    Total " + rs(total) + " -- back to pending, and off the Approved card.")
    if tin:
        print("    " + str(len(tin)) + " of them are at or under the tin's " + rs(PETTY_CASH_LIMIT)
              + " limit and get the petty cash movement they never wrote.")
    print("    The branch's Cash in hand falls by the full " + rs(total)
          + ": the notes left the drawer whatever the row said.")

    if not apply:
        print()
        print("Nothing written. Re-run with --apply once the list above is right.")
        return

    # Which of these already has a tin movement, so a second run cannot draw the tin down
    # twice for one expense. Keyed on the expense id for the same reason create_expense
    # writes it that way: one movement belongs to one expense and can be found by it.
    existing = await v3_col("petty_cash_movements").find(
        {"expense_id": {"$in": [r["id"] for r in tin]}}, {"_id": 0, "expense_id": 1},
    ).to_list(20000) if tin else []
    already = {m.get("expense_id") for m in existing}

    refiled = movements = 0
    for r in candidates:
        await v3_col("expenses").update_one(
            {"id": r["id"]},
            {"$set": {
                "branch_id": branch["id"],
                "approved": False,
                "approved_by": None,
                "approved_at": None,
                "rejected": False,
                "rejection_reason": "",
            }},
        )
        refiled += 1
        amount = float(r.get("amount") or 0)
        if not (0 < amount <= PETTY_CASH_LIMIT) or r["id"] in already:
            continue
        # Written under the name that raised the expense, not this script's: the tin's
        # book says who spent the money, and that has not changed.
        await _record_petty_cash_movement(
            branch_id=branch["id"], delta=-amount, kind="expense",
            on=r.get("expense_date") or "", note=(r.get("note") or r.get("category") or ""),
            user=SimpleNamespace(
                full_name=r.get("created_by") or "", role=r.get("created_by_role") or "",
            ),
            expense_id=r["id"],
        )
        movements += 1

    print()
    print("Re-filed " + str(refiled) + " expense(s) onto " + (branch.get("branch_name") or branch["id"])
          + " and sent them back to the accountant.")
    if movements:
        print("Wrote " + str(movements) + " petty cash movement(s).")


if __name__ == "__main__":
    argv = sys.argv[1:]
    ids = ""
    positional = []
    skip = False
    for i, a in enumerate(argv):
        if skip:
            skip = False
            continue
        if a == "--ids":
            ids = argv[i + 1] if i + 1 < len(argv) else ""
            skip = True
        elif a.startswith("--ids="):
            ids = a.split("=", 1)[1]
        elif not a.startswith("--"):
            positional.append(a)
    asyncio.run(main(
        needle=(positional[0] if positional else ""),
        apply="--apply" in argv,
        only_ids=ids.split(",") if ids else None,
    ))
