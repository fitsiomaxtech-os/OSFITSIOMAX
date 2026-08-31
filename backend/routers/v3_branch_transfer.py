"""Super Admin > Operations > Branch > Branch Transfer.

Two endpoints, and the second is the first one's answer acted on: GET says whether this
patient can move and what moving them costs, POST moves them. The rules themselves are in
branch_transfer.py — see that module's docstring for why the two windows are what they are
and why the money does not follow the patient.

Super Admin only. Branch Admin is deliberately not on this: a transfer takes a patient
(and, at the treatment window, a paid course) off one branch's book and puts them on
another's, which is not a decision either of the two branches involved should be able to
make about the other.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import branch_transfer
from database import v3_col
from deps import v3_require_roles
from schemas.v3 import V3LeadOut, V3UserOut

router = APIRouter(prefix="/api/v3")


class BranchTransferInput(BaseModel):
    to_branch_id: str
    # Free text, kept on the lead and written into the activity row. Not required — the
    # move is often self-explanatory ("patient moved house") and demanding a sentence for
    # every one of them only trains people to type a full stop.
    reason: Optional[str] = ""


async def _lead_or_404(lead_id: str) -> dict:
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@router.get("/leads/{lead_id}/branch-transfer")
async def get_branch_transfer_preview(
    lead_id: str,
    _: V3UserOut = Depends(v3_require_roles("super_admin")),
):
    """Can this patient be transferred, and what happens if they are.

    The branch list comes back with it rather than being fetched separately, because the
    two have to agree: the branch the patient is at now must not be offered as somewhere
    to send them, and that is known here and nowhere else on the client.
    """
    lead = await _lead_or_404(lead_id)
    preview = await branch_transfer.preview(lead)
    branches = await v3_col("branches").find(
        {}, {"_id": 0, "id": 1, "branch_name": 1, "vertical": 1, "city": 1},
    ).to_list(500)
    by_id = {b["id"]: b for b in branches}
    return {
        **preview,
        "lead_id": lead_id,
        "lead_name": lead.get("name", ""),
        "patient_number": lead.get("patient_number") or "",
        "from_branch_id": lead.get("branch_id"),
        # Named, not just identified: the dialog says which branch keeps the money already
        # collected, and "stays on Anna Nagar's books" is the sentence that stops somebody
        # asking finance about it a month later.
        "from_branch_name": by_id.get(lead.get("branch_id"), {}).get("branch_name", ""),
        "destinations": sorted(
            (b for b in branches if b.get("id") != lead.get("branch_id")),
            key=lambda b: (str(b.get("vertical") or "").startswith("online_"), b.get("branch_name") or ""),
        ),
    }


@router.post("/leads/{lead_id}/branch-transfer")
async def post_branch_transfer(
    lead_id: str,
    payload: BranchTransferInput,
    user: V3UserOut = Depends(v3_require_roles("super_admin")),
):
    """Move the patient. Re-checks the window server-side rather than trusting the GET:
    a dialog can sit open for a long time, and the consultation it was opened on can be
    booked, paid for or cancelled while it does."""
    lead = await _lead_or_404(lead_id)

    destination = await v3_col("branches").find_one(
        {"id": payload.to_branch_id}, {"_id": 0, "id": 1, "branch_name": 1},
    )
    if not destination:
        raise HTTPException(status_code=404, detail="Destination branch not found")
    if destination["id"] == lead.get("branch_id"):
        raise HTTPException(status_code=400, detail="This patient is already at that branch")

    window, explanation = await branch_transfer.transfer_window(lead)
    if not window:
        raise HTTPException(status_code=400, detail=explanation)

    result = await branch_transfer.transfer(lead, destination, user, payload.reason or "")
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {
        "message": f"{lead.get('name', 'Patient')} transferred to {destination.get('branch_name', '')}",
        **result,
        "lead": V3LeadOut(**updated).model_dump(),
    }
