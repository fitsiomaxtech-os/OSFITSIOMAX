"""Reusable wording for the Head Physio's Diagnosis Report and Treatment Summary.

The same phrasings get retyped for patient after patient — a lower back strain reads much
the same the tenth time as the first. These are saved once and picked from a dropdown,
which is faster and keeps the wording consistent between Head Physios.

Org-wide on purpose: one list every Head Physio sees and adds to, so standard wording
holds across branches and a new Head Physio starts with the existing list rather than an
empty one.

A preset is a starting point, never the report. The picker fills the box and the text
stays editable, so what is saved against a patient is whatever the Head Physio actually
wrote for them. Nothing here is referenced by a lead — deleting a preset changes no report
that has already been written.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import v3_col
from utils import now_iso
from deps import v3_require_roles
from schemas.v3 import V3UserOut

router = APIRouter(prefix="/api/v3")

DIAGNOSIS = "diagnosis_report"
TREATMENT = "treatment_summary"
KINDS = (DIAGNOSIS, TREATMENT)

# Head Physio writes these; Super Admin can curate them. Branch Admin reads the reports
# but does not author them, so it has no business editing the wording either.
ROLES = ("head_physio", "super_admin")

MAX_LEN = 4000


class PresetInput(BaseModel):
    kind: str
    text: str


def _clean(kind: str, text: str) -> tuple:
    if kind not in KINDS:
        raise HTTPException(status_code=400, detail="Unknown preset kind")
    body = (text or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Write something before saving it as an option")
    if len(body) > MAX_LEN:
        raise HTTPException(status_code=400, detail=f"Option must be under {MAX_LEN} characters")
    return kind, body


@router.get("/text-presets")
async def list_text_presets(
    kind: Optional[str] = Query(None),
    _: V3UserOut = Depends(v3_require_roles(*ROLES)),
):
    query = {}
    if kind:
        if kind not in KINDS:
            raise HTTPException(status_code=400, detail="Unknown preset kind")
        query["kind"] = kind
    rows = await v3_col("text_presets").find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"presets": rows}


@router.post("/text-presets")
async def add_text_preset(
    payload: PresetInput,
    user: V3UserOut = Depends(v3_require_roles(*ROLES)),
):
    kind, body = _clean(payload.kind, payload.text)
    # Saving the same wording twice is the likely mistake, not the intent: the button sits
    # next to a box someone has just been typing in, so it gets pressed again after an
    # edit. Return the existing row rather than growing a list of near-duplicates.
    existing = await v3_col("text_presets").find_one({"kind": kind, "text": body}, {"_id": 0})
    if existing:
        return existing
    row = {
        "id": str(uuid.uuid4()),
        "kind": kind,
        "text": body,
        "created_by": user.full_name,
        "created_at": now_iso(),
    }
    await v3_col("text_presets").insert_one(row.copy())
    row.pop("_id", None)
    return row


@router.delete("/text-presets/{preset_id}")
async def delete_text_preset(
    preset_id: str,
    _: V3UserOut = Depends(v3_require_roles(*ROLES)),
):
    res = await v3_col("text_presets").delete_one({"id": preset_id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Option not found")
    return {"deleted": True}
