"""Where a branch's revenue went, and why the branches do not add up to the total.

Read-only. Answers two questions the cards cannot:

  1. A branch reads Rs.0 -- does it have no money, or money not reachable
     under its branch id?
  2. All Branches reads more than the branches add up to -- what is the
     difference made of?

Both have the same answer. Revenue-overview scopes a branch by finding that
branch's leads and filtering the payment trail to them; store sales and Zumba
fees it reads off their own branch_id. Pick All Branches and there is no scope,
so every payment counts -- including ones whose lead was deleted, whose lead
never got a branch, or whose branch id belongs to a branch that no longer
exists. None of those can appear under any branch you can select, so they show
up in the company total and nowhere else.

This walks the same three sources the endpoint does and sorts every rupee into
either a real branch or one of those three strandings.

Run on the server, where backend/.env is:

    cd backend && python tools/branch_revenue_check.py
    cd backend && python tools/branch_revenue_check.py "ECR"
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import v3_col  # noqa: E402
from routers.v3_finance import REVENUE_ACTIONS, _parse_rs_amount  # noqa: E402

# The three ways money ends up in the company total and in no branch's own.
NO_LEAD = "lead was deleted"
NO_BRANCH = "lead has no branch"
DEAD_BRANCH = "branch no longer exists"


def rs(n):
    return "Rs." + format(n, ",.0f")


async def main(needle=""):
    branches = await v3_col("branches").find({}, {"_id": 0, "id": 1, "branch_name": 1}).to_list(500)
    names = {b["id"]: b.get("branch_name") or "(unnamed)" for b in branches}

    leads = await v3_col("leads").find({}, {"_id": 0, "id": 1, "branch_id": 1}).to_list(50000)
    lead_branch = {l["id"]: l.get("branch_id") for l in leads}

    acts = await v3_col("lead_activity").find(
        {"action": {"$in": REVENUE_ACTIONS}},
        {"_id": 0, "lead_id": 1, "details": 1, "action": 1, "created_at": 1},
    ).to_list(50000)
    store = await v3_col("inventory_movements").find(
        {"kind": "sale"}, {"_id": 0, "branch_id": 1, "amount": 1},
    ).to_list(50000)
    zumba = await v3_col("zumba_registrations").find(
        {}, {"_id": 0, "branch_id": 1, "fee_paid": 1},
    ).to_list(50000)

    tally = {}
    dangling = set()

    def bucket(key):
        return tally.setdefault(key, {"leads": 0, "n": 0, "trail": 0.0, "store": 0.0, "zumba": 0.0})

    def classify_branch(bid):
        """A branch id straight off a store sale or a registration."""
        if bid in names:
            return bid
        if bid in (None, ""):
            return NO_BRANCH
        dangling.add(bid)
        return DEAD_BRANCH

    def classify_lead(lead_id):
        """A payment in the lead trail, one step further removed: the lead itself
        may be gone, which is not the same problem as a lead with no branch."""
        if lead_id not in lead_branch:
            return NO_LEAD
        return classify_branch(lead_branch[lead_id])

    for l in leads:
        bucket(classify_branch(l.get("branch_id")))["leads"] += 1
    for a in acts:
        b = bucket(classify_lead(a.get("lead_id")))
        b["trail"] += _parse_rs_amount(a.get("details", ""))
        b["n"] += 1
    for s in store:
        b = bucket(classify_branch(s.get("branch_id")))
        b["store"] += float(s.get("amount") or 0)
        b["n"] += 1
    for z in zumba:
        amount = float(z.get("fee_paid") or 0)
        if amount <= 0:
            continue
        b = bucket(classify_branch(z.get("branch_id")))
        b["zumba"] += amount
        b["n"] += 1

    def total(r):
        return r["trail"] + r["store"] + r["zumba"]

    print(str(len(branches)) + " branches, " + str(len(leads)) + " leads, "
          + str(len(acts)) + " revenue activities")
    print()
    head = "branch".ljust(30) + "leads".rjust(7) + "rows".rjust(6) + "trail".rjust(14) \
        + "store".rjust(11) + "zumba".rjust(11) + "total".rjust(14)
    print(head)
    print("-" * len(head))

    real = [(k, v) for k, v in tally.items() if k in names]
    for bid, r in sorted(real, key=lambda kv: -total(kv[1])):
        if needle and needle.lower() not in names[bid].lower():
            continue
        print(names[bid][:29].ljust(30) + str(r["leads"]).rjust(7) + str(r["n"]).rjust(6)
              + rs(r["trail"]).rjust(14) + rs(r["store"]).rjust(11)
              + rs(r["zumba"]).rjust(11) + rs(total(r)).rjust(14))

    # Named even when a branch was asked for by name: a branch with nothing in it
    # matches no row above, so the one question the run was for -- "what about
    # ECR?" -- would otherwise be answered by an empty table and no sentence.
    empty = [n for b, n in names.items()
             if b not in tally and (not needle or needle.lower() in n.lower())]
    if empty:
        print()
        print("Nothing at all -- no leads, no store sales, no Zumba registrations:")
        for n in sorted(empty):
            print("  - " + n)

    stranded = [(k, v) for k, v in tally.items() if k not in names]
    branch_sum = sum(total(v) for _, v in real)
    stranded_sum = sum(total(v) for _, v in stranded)

    print()
    print("The branches add up to    " + rs(branch_sum))
    print("Unreachable under any     " + rs(stranded_sum))
    print("All Branches shows        " + rs(branch_sum + stranded_sum))

    if stranded:
        print()
        print("What the unreachable money is:")
        for key, r in sorted(stranded, key=lambda kv: -total(kv[1])):
            print("  " + key.ljust(26) + str(r["n"]).rjust(5)
                  + (" row " if r["n"] == 1 else " rows")
                  + rs(total(r)).rjust(14) + "   ("
                  + str(r["leads"]) + (" lead)" if r["leads"] == 1 else " leads)"))
        if dangling:
            print()
            print("Branch ids on records that match no branch -- a branch deleted and")
            print("recreated leaves its clients pointing at the old id:")
            for d in sorted(dangling)[:10]:
                print("  - " + str(d))

    # Two ways one sum can be counted twice in the payment trail. Both are counted as
    # revenue right now. Printed rather than corrected, because correcting them takes
    # money off a total somebody has been reading as the truth, and the size of that
    # deduction should be known before it happens rather than discovered after.
    sold, collected = {}, {}
    for a in acts:
        if a.get("action") == "package_sold":
            sold.setdefault(a.get("lead_id"), []).append(a)
        elif a.get("action") == "package_payment_collected":
            collected.setdefault(a.get("lead_id"), []).append(a)

    # sell-package assigns a package at a negotiated price and writes package_paid;
    # collecting the fee overwrites that same field. One sum, two records, both summed.
    dup_leads = [lid for lid in sold if lid in collected]
    dup_total = sum(_parse_rs_amount(a.get("details", ""))
                    for lid in dup_leads for a in sold[lid])

    # A second collection on one lead is a correction, not a second payment -- the
    # endpoint writes "Updated" and overwrites package_paid rather than adding to it --
    # so every one but the latest is a figure that was replaced.
    stale_total, stale_rows = 0.0, 0
    for rows_ in collected.values():
        if len(rows_) < 2:
            continue
        for a in sorted(rows_, key=lambda r: r.get("created_at") or "")[:-1]:
            stale_total += _parse_rs_amount(a.get("details", ""))
            stale_rows += 1

    if dup_total or stale_total:
        print()
        print("Counted twice in the payment trail:")
        if dup_total:
            print("  sold, then collected".ljust(30) + rs(dup_total).rjust(14)
                  + "   (" + str(len(dup_leads))
                  + (" lead)" if len(dup_leads) == 1 else " leads)"))
        if stale_total:
            print("  collections later corrected".ljust(30) + rs(stale_total).rjust(14)
                  + "   (" + str(stale_rows)
                  + (" row)" if stale_rows == 1 else " rows)"))

    # Zumba fees are collected onto the registration and never enter lead_activity,
    # which was the only thing the Approvals tab read.
    zumba_sum = sum(v["zumba"] for v in tally.values())
    if zumba_sum:
        print()
        print(rs(zumba_sum) + " of the company total is Zumba, collected onto the")
        print("registration rather than the lead trail. The Approvals tab reads those")
        print("now; anything collected before it did was never signed off by anyone.")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else ""))
