"""Why does a branch's Revenue read zero?

Read-only. Answers the one question the cards cannot: whether a branch showing
Rs.0 has no money in it, or has money that is not reachable under its branch id.

Run on the server, where backend/.env is:

    cd backend && python tools/branch_revenue_check.py
    cd backend && python tools/branch_revenue_check.py "ECR"

The revenue-overview endpoint scopes a branch by finding that branch's leads and
filtering the payment trail to them, and reads store sales and Zumba fees off
their own branch_id directly. This walks the same three sources the same way, and
then does the part the endpoint has no reason to do: counts the money whose lead
carries a branch id belonging to no branch, or none at all. That money is in the
org-wide total and in no branch's, which is what a branch reading zero next to a
company that clearly took something looks like from the other side.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import v3_col  # noqa: E402
from routers.v3_finance import REVENUE_ACTIONS, _parse_rs_amount  # noqa: E402


def rs(n: float) -> str:
    return f"Rs.{n:,.0f}"


async def main(needle: str = "") -> None:
    branches = await v3_col("branches").find({}, {"_id": 0, "id": 1, "branch_name": 1}).to_list(500)
    names = {b["id"]: b.get("branch_name") or "(unnamed)" for b in branches}

    leads = await v3_col("leads").find({}, {"_id": 0, "id": 1, "branch_id": 1}).to_list(50000)
    branch_of_lead = {l["id"]: l.get("branch_id") for l in leads}

    acts = await v3_col("lead_activity").find(
        {"action": {"$in": REVENUE_ACTIONS}}, {"_id": 0, "lead_id": 1, "details": 1},
    ).to_list(50000)
    store = await v3_col("inventory_movements").find(
        {"kind": "sale"}, {"_id": 0, "branch_id": 1, "amount": 1},
    ).to_list(50000)
    zumba = await v3_col("zumba_registrations").find(
        {}, {"_id": 0, "branch_id": 1, "fee_paid": 1},
    ).to_list(50000)

    # Keyed the way the endpoint keys them: whatever is on the lead, matched or not.
    tally = {}

    def row(bid):
        return tally.setdefault(bid, {"leads": 0, "payments": 0, "trail": 0.0, "store": 0.0, "zumba": 0.0})

    for l in leads:
        row(l.get("branch_id"))["leads"] += 1
    for a in acts:
        r = row(branch_of_lead.get(a.get("lead_id")))
        r["trail"] += _parse_rs_amount(a.get("details", ""))
        r["payments"] += 1
    for s in store:
        row(s.get("branch_id"))["store"] += float(s.get("amount") or 0)
    for z in zumba:
        row(z.get("branch_id"))["zumba"] += float(z.get("fee_paid") or 0)

    print(f"{len(branches)} branches, {len(leads)} leads, {len(acts)} revenue activities\n")
    print(f"{'branch':<28}{'leads':>7}{'pays':>7}{'trail':>14}{'store':>12}{'zumba':>12}")
    print("-" * 80)

    orphan_ids = []
    for bid, r in sorted(tally.items(), key=lambda kv: -(kv[1]["trail"] + kv[1]["store"] + kv[1]["zumba"])):
        if bid in names:
            label = names[bid]
        elif bid in (None, ""):
            label = "** no branch on lead **"
        else:
            label = f"** unknown id {str(bid)[:8]} **"
            orphan_ids.append(bid)
        if needle and needle.lower() not in label.lower():
            continue
        print(f"{label:<28}{r['leads']:>7}{r['payments']:>7}{rs(r['trail']):>14}{rs(r['store']):>12}{rs(r['zumba']):>12}")

    # Named even when a branch was asked for by name: a branch with nothing in it
    # matches no row above, so without this the one question the run was for -- "what
    # about ECR?" -- gets answered with an empty table and no sentence at all.
    empty = [
        n for b, n in names.items()
        if b not in tally and (not needle or needle.lower() in n.lower())
    ]
    if empty:
        print("\nNothing at all -- no leads, no store sales, no Zumba registrations:")
        for n in empty:
            print(f"  - {n}")

    stranded = sum(
        r["trail"] + r["store"] + r["zumba"]
        for b, r in tally.items()
        if b not in names
    )
    if stranded:
        print(f"\n{rs(stranded)} sits under no branch: it counts in the company total and in")
        print("no branch's own. Leads with a null branch_id, or pointing at a branch id that")
        print("no longer exists: a branch deleted and recreated leaves its clients behind.")
        if orphan_ids:
            print(f"Dangling branch ids: {', '.join(str(o) for o in orphan_ids[:10])}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else ""))
