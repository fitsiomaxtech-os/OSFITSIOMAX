"""Client documents — scans, reports, prescriptions and scheme letters held against a lead.

DELIBERATELY NOT under `uploads/`.

`server.py` mounts `backend/uploads` at /api/v3/uploads with StaticFiles, which serves
anything inside it to anyone who knows the URL — no token, no role check. That is right for
the store's product photos and wrong for a patient's MRI report: a UUID in a filename is
obscurity, not access control, and these URLs end up in browser history, chat messages and
screenshots.

So the bytes live in `backend/client_documents/`, outside every static mount, and the only
way out is the download endpoint below, which authenticates like any other route.
"""

import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from database import v3_col
from utils import now_iso
from deps import v3_require_roles
from schemas.v3 import V3UserOut

router = APIRouter(prefix="/api/v3")

DOC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "client_documents")
os.makedirs(DOC_DIR, exist_ok=True)

# Scans and reports arrive as images or PDFs. Nothing executable, and nothing that a
# browser will run if it is ever opened directly.
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
MAX_UPLOAD_BYTES = 500 * 1024 * 1024
CHUNK = 1024 * 1024

# What the document is. "consultation_form" is the photographed paper form filled during
# the consultation; everything else is a report, scan or letter filed against the patient.
# Kept as a field rather than a separate collection — same bytes, same permissions, same
# lifecycle, and only the screen that lists them cares about the difference.
CONSULTATION_FORM = "consultation_form"
GENERAL = "general"


def default_shared_with_patient(kind: str) -> bool:
    """Whether a newly uploaded document is visible in the patient's own Client Portal.

    A consultation form is the patient's own intake form, filled by and about them — that
    is the whole reason the kind exists — so it is shared on upload.

    Everything else is not. A report, scan or letter can be filed for the clinic's use, and
    a patient reading a finding before a clinician has explained it is a decision for the
    branch to make deliberately, one document at a time, through the share control. Silent
    exposure by default is the one outcome that cannot be undone.
    """
    return kind == CONSULTATION_FORM


def is_shared_with_patient(doc: dict) -> bool:
    """Reads the flag, falling back to the same rule for rows saved before it existed —
    so an old consultation form still reaches the patient and an old report still doesn't."""
    value = doc.get("shared_with_patient")
    if value is None:
        return default_shared_with_patient(doc.get("kind") or GENERAL)
    return bool(value)

# Everyone who treats the patient can read their documents; the front desk and the
# clinicians who order them can add. A Physio can read a report without being able to
# delete one.
READ_ROLES = ("branch_admin", "super_admin", "head_physio", "physio", "nutrition_coach")
WRITE_ROLES = ("branch_admin", "super_admin", "head_physio")


@router.get("/leads/{lead_id}/documents")
async def list_lead_documents(
    lead_id: str,
    kind: Optional[str] = None,
    _: V3UserOut = Depends(v3_require_roles(*READ_ROLES)),
):
    query = {"lead_id": lead_id}
    if kind:
        # Documents saved before `kind` existed have no field at all. Asking for the
        # general list has to include them, or every existing document would vanish from
        # the screen that used to show it.
        query["kind"] = {"$in": [kind, None]} if kind == GENERAL else kind
    docs = await v3_col("lead_documents").find(
        query, {"_id": 0, "stored_name": 0}
    ).sort("created_at", 1 if kind == CONSULTATION_FORM else -1).to_list(500)
    # Resolved rather than returned raw, so the staff screen's toggle shows the same state
    # the patient's portal is actually applying, including for rows saved before the flag.
    for d in docs:
        d["shared_with_patient"] = is_shared_with_patient(d)
    return {"documents": docs}


@router.patch("/leads/{lead_id}/documents/{doc_id}/share")
async def set_document_shared(
    lead_id: str,
    doc_id: str,
    shared: bool,
    user: V3UserOut = Depends(v3_require_roles(*WRITE_ROLES)),
):
    """Show this document in the patient's own Client Portal, or stop showing it.

    Restricted to WRITE_ROLES rather than everyone who can read: deciding what a patient
    sees is the branch's call, not something a treating clinician does in passing.
    """
    doc = await v3_col("lead_documents").find_one({"id": doc_id, "lead_id": lead_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await v3_col("lead_documents").update_one(
        {"id": doc_id}, {"$set": {"shared_with_patient": bool(shared)}}
    )
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "document_share_changed",
        "details": f"{doc.get('label') or doc.get('original_name')} "
                   f"{'shared with' if shared else 'hidden from'} the patient's portal",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    return {"id": doc_id, "shared_with_patient": bool(shared)}


@router.post("/leads/{lead_id}/documents")
async def upload_lead_document(
    lead_id: str,
    file: UploadFile = File(...),
    label: Optional[str] = Form(""),
    kind: Optional[str] = Form(GENERAL),
    user: V3UserOut = Depends(v3_require_roles(*WRITE_ROLES)),
):
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0, "id": 1, "name": 1})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only JPG, PNG, WEBP or PDF files are allowed")

    # The name on disk is generated, never taken from the upload. A filename is attacker
    # controlled — "../../server.py" would otherwise be written wherever that resolves to.
    # The original is kept as data, for display only.
    doc_id = str(uuid.uuid4())
    stored_name = f"{doc_id}{ext}"
    path = os.path.join(DOC_DIR, stored_name)

    # Streamed to disk a megabyte at a time rather than read whole. At a 500MB ceiling,
    # reading first and checking after would hold half a gigabyte in RAM per concurrent
    # upload before finding out it was too big — enough to take the box down from a
    # request that was always going to be rejected.
    size = 0
    try:
        with open(path, "wb") as f:
            while True:
                chunk = await file.read(CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=400, detail="File must be under 500MB")
                f.write(chunk)
        if not size:
            raise HTTPException(status_code=400, detail="That file is empty")
    except Exception:
        # A rejected or failed upload leaves nothing behind. Without this the partial file
        # stays on disk forever, unreferenced by any row and invisible to every screen.
        if os.path.exists(path):
            os.remove(path)
        raise

    doc = {
        "id": doc_id,
        "lead_id": lead_id,
        "stored_name": stored_name,
        "original_name": os.path.basename(file.filename or "document")[:200],
        "label": (label or "").strip()[:120],
        "kind": CONSULTATION_FORM if kind == CONSULTATION_FORM else GENERAL,
        "shared_with_patient": default_shared_with_patient(CONSULTATION_FORM if kind == CONSULTATION_FORM else GENERAL),
        "content_type": file.content_type or "application/octet-stream",
        "size_bytes": size,
        "uploaded_by": user.full_name,
        "uploaded_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("lead_documents").insert_one(doc.copy())
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "document_uploaded",
        "details": f"{doc['label'] or doc['original_name']} uploaded",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    doc.pop("stored_name", None)
    return doc


@router.get("/leads/{lead_id}/documents/{doc_id}/download")
async def download_lead_document(
    lead_id: str, doc_id: str, _: V3UserOut = Depends(v3_require_roles(*READ_ROLES))
):
    """The only route to the bytes. Matched on lead_id AND doc_id so a document id alone
    can't be used to read a file against a lead the caller wasn't looking at."""
    doc = await v3_col("lead_documents").find_one({"id": doc_id, "lead_id": lead_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    path = os.path.join(DOC_DIR, doc["stored_name"])
    # Re-joined from the stored name and re-checked: a row edited by hand shouldn't be able
    # to point this at something outside the folder.
    if os.path.dirname(os.path.abspath(path)) != os.path.abspath(DOC_DIR) or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File is missing from storage")
    return FileResponse(path, media_type=doc.get("content_type"), filename=doc.get("original_name"))


@router.delete("/leads/{lead_id}/documents/{doc_id}")
async def delete_lead_document(
    lead_id: str, doc_id: str, user: V3UserOut = Depends(v3_require_roles(*WRITE_ROLES))
):
    doc = await v3_col("lead_documents").find_one({"id": doc_id, "lead_id": lead_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await v3_col("lead_documents").delete_one({"id": doc_id})
    # The row goes first. If the unlink fails the record is already gone, which leaves an
    # orphan file rather than a listed document that 404s when opened.
    try:
        os.remove(os.path.join(DOC_DIR, doc["stored_name"]))
    except OSError:
        pass
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "document_deleted",
        "details": f"{doc.get('label') or doc.get('original_name')} deleted",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    return {"deleted": doc_id}
