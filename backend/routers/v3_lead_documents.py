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
from pydantic import BaseModel

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

# The Nutrition Coach's Diet Chart. A kind of its own because it is the one document in the
# OS whose visibility to the patient is bought rather than granted: it is shown in the
# Client Portal once the Diet Chart Fee is collected and not before, and that is a fact
# about the lead's payments, not a flag on the row. See is_shared_with_patient below and
# the /patient-portal/diet-chart route that serves it.
DIET_CHART = "diet_chart"

# The proof a course of treatment actually delivered something, gathered as it goes. These
# four are what a case sheet cannot be closed without — see progression_status below.
#
# Ordered as they are collected: the weekly clips run alongside the treatment, the before
# and after is cut at the end of it, and the testimonial and the review come from the
# patient once they are happy. A screen showing them in any other order would be asking
# for the last one first.
#
# The last one is text, not a file: a Google review is a link or the words themselves, and
# asking for a screenshot of it made the branch photograph a web page to satisfy a form.
# It is stored on the lead rather than as a document, and `input` is what lets one screen
# render both kinds off this list instead of special-casing the last row by name.
PROGRESSION_KINDS = [
    ("progress_weekly", "Weekly Progression Videos", True, "file"),
    ("progress_final", "Before & After Video", True, "file"),
    ("progress_testimonial", "Client Testimonial Video", True, "file"),
    ("progress_review", "Google Review", True, "text"),
]
PROGRESSION_KEYS = [k for k, _, _, kind_input in PROGRESSION_KINDS if kind_input == "file"]
# Where the typed one lives on the lead.
REVIEW_FIELD = "google_review"

# Three of the four are video, which the general document rules never had to allow: a scan
# or a letter is an image or a PDF. Widened only for these kinds, so a consultation form is
# still refused if someone tries to file a film as one.
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"}


def allowed_extensions_for(kind: str) -> set:
    """What may be filed under this kind. Progression takes video as well as stills —
    a Google Review arrives as a screenshot, the other three as clips."""
    return ALLOWED_EXTENSIONS | VIDEO_EXTENSIONS if kind in PROGRESSION_KEYS else ALLOWED_EXTENSIONS


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
    so an old consultation form still reaches the patient and an old report still doesn't.

    A Diet Chart is never shared through here, whatever its flag says. Its visibility is
    conditional on the Diet Chart Fee, and this function cannot see the lead's payments —
    it is handed a document row and nothing else. Answering "yes" for a chart would put it
    in /patient-portal/documents and its download route, which is a way past the fee gate
    that nobody would think to check.

    So the chart is fenced out of the generic path entirely and reaches the patient only
    through /patient-portal/diet-chart, which reads diet_chart_fee_paid off the lead at the
    moment it is asked. The gate is then a live check against what has actually been paid,
    rather than a copy of it written down when the chart was sent and never revisited.
    """
    if (doc.get("kind") or GENERAL) == DIET_CHART:
        return False
    value = doc.get("shared_with_patient")
    if value is None:
        return default_shared_with_patient(doc.get("kind") or GENERAL)
    return bool(value)

# Everyone who treats the patient can read their documents; the front desk and the
# clinicians who order them can add. A Physio can read a report without being able to
# delete one.
READ_ROLES = ("branch_admin", "super_admin", "head_physio", "physio", "nutrition_coach")
WRITE_ROLES = ("branch_admin", "super_admin", "head_physio")


async def store_upload(file: UploadFile, doc_id: str, ext: str) -> tuple:
    """Write one upload to the documents folder under a generated name. Returns
    (stored_name, size_bytes).

    The name on disk is generated, never taken from the upload. A filename is attacker
    controlled — "../../server.py" would otherwise be written wherever that resolves to.
    The original is kept as data by the caller, for display only.

    Streamed to disk a megabyte at a time rather than read whole. At a 500MB ceiling,
    reading first and checking after would hold half a gigabyte in RAM per concurrent
    upload before finding out it was too big — enough to take the box down from a request
    that was always going to be rejected.

    Shared rather than copied because the Diet Chart is uploaded from the diet router, by
    the Nutrition Coach, and a second copy of this loop is a second place for the path
    handling and the cleanup to be got wrong.
    """
    stored_name = f"{doc_id}{ext}"
    path = os.path.join(DOC_DIR, stored_name)
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
    return stored_name, size


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

    A Diet Chart is refused outright rather than accepted and ignored. Its visibility is not
    a decision anyone makes on this screen — it is bought, and is_shared_with_patient will
    keep answering no whatever this row says. Writing the flag anyway would leave a toggle
    that reads as shared beside a chart the patient cannot open, which is worse than a
    control that says plainly why it will not move.
    """
    doc = await v3_col("lead_documents").find_one({"id": doc_id, "lead_id": lead_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if (doc.get("kind") or GENERAL) == DIET_CHART:
        raise HTTPException(
            status_code=400,
            detail="A Diet Chart appears in the Client Portal once the Diet Chart Fee is collected — it is not shared by hand",
        )
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
    if ext not in allowed_extensions_for(kind or GENERAL):
        detail = (
            "Only JPG, PNG, WEBP, PDF or video files (MP4, MOV, WEBM) are allowed"
            if (kind or GENERAL) in PROGRESSION_KEYS
            else "Only JPG, PNG, WEBP or PDF files are allowed"
        )
        raise HTTPException(status_code=400, detail=detail)

    doc_id = str(uuid.uuid4())
    stored_name, size = await store_upload(file, doc_id, ext)

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


class VerifyInput(BaseModel):
    verified: bool = True


@router.patch("/leads/{lead_id}/documents/{doc_id}/verify")
async def verify_lead_document(
    lead_id: str,
    doc_id: str,
    payload: VerifyInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio")),
):
    """Confirm that an uploaded file is what it claims to be.

    Deliberately not open to the person who uploaded it. The physio delivering the course
    gathers the clips; the branch or the consultant checks them. A case sheet that could be
    closed by one person uploading four files and ticking them off themselves would prove
    nothing, which is the whole point of asking for them.
    """
    doc = await v3_col("lead_documents").find_one({"id": doc_id, "lead_id": lead_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await v3_col("lead_documents").update_one(
        {"id": doc_id},
        {"$set": {
            "verified": bool(payload.verified),
            "verified_by": user.full_name if payload.verified else None,
            "verified_at": now_iso() if payload.verified else None,
        }},
    )
    return await v3_col("lead_documents").find_one({"id": doc_id}, {"_id": 0, "stored_name": 0})


class ReviewInput(BaseModel):
    text: str = ""


@router.put("/leads/{lead_id}/google-review")
async def set_google_review(
    lead_id: str,
    payload: ReviewInput,
    user: V3UserOut = Depends(v3_require_roles(*WRITE_ROLES)),
):
    """The patient's Google review — the link, or the words themselves.

    Typed rather than filed. Asking for a screenshot made the branch photograph a web page
    to satisfy a form, and a picture of a review cannot be followed back to the review.

    Editing it clears the verification with it. Whoever checked it checked what was there
    at the time, and carrying that tick over to text nobody has read is how a case sheet
    closes on something that was never seen.
    """
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0, "id": 1})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    text = (payload.text or "").strip()
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        REVIEW_FIELD: text,
        f"{REVIEW_FIELD}_verified": False,
        f"{REVIEW_FIELD}_verified_by": None,
        f"{REVIEW_FIELD}_verified_at": None,
        "updated_at": now_iso(),
    }})
    return {"text": text, "verified": False}


@router.patch("/leads/{lead_id}/google-review/verify")
async def verify_google_review(
    lead_id: str,
    payload: VerifyInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio")),
):
    """Confirm the review is real — the same second pair of eyes the uploads get."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if payload.verified and not (lead.get(REVIEW_FIELD) or "").strip():
        raise HTTPException(status_code=400, detail="There is no review to verify yet")
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        f"{REVIEW_FIELD}_verified": bool(payload.verified),
        f"{REVIEW_FIELD}_verified_by": user.full_name if payload.verified else None,
        f"{REVIEW_FIELD}_verified_at": now_iso() if payload.verified else None,
        "updated_at": now_iso(),
    }})
    return {"verified": bool(payload.verified)}


@router.get("/leads/{lead_id}/progression")
async def progression_status(
    lead_id: str,
    _: V3UserOut = Depends(v3_require_roles(*READ_ROLES)),
):
    """Where this patient's case sheet stands against the four things it needs.

    One requirement is Pending until at least one file is filed under it, Uploaded once one
    is, and Completed only once one of them has been verified by someone other than whoever
    filed it. Reported per requirement rather than as a single figure so the screen can say
    which one is missing — "3 of 4" tells a physio to go hunting.
    """
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    docs = await v3_col("lead_documents").find(
        {"lead_id": lead_id, "kind": {"$in": PROGRESSION_KEYS}}, {"_id": 0, "stored_name": 0}
    ).sort("created_at", 1).to_list(500)

    by_kind: dict = {}
    for d in docs:
        by_kind.setdefault(d.get("kind"), []).append(d)

    requirements = []
    for key, label, required, kind_input in PROGRESSION_KINDS:
        if kind_input == "text":
            # Typed straight onto the lead. Same three states as a filed one, read off the
            # text being there and the check having been made.
            text = (lead.get(REVIEW_FIELD) or "").strip()
            done = bool(lead.get(f"{REVIEW_FIELD}_verified"))
            requirements.append({
                "kind": key,
                "label": label,
                "required": required,
                "input": "text",
                "text": text,
                "verified_by": lead.get(f"{REVIEW_FIELD}_verified_by"),
                "uploaded": 1 if text else 0,
                "verified": 1 if done else 0,
                "status": "completed" if (text and done) else ("uploaded" if text else "pending"),
                "documents": [],
            })
            continue
        filed = by_kind.get(key, [])
        verified = [d for d in filed if d.get("verified")]
        requirements.append({
            "kind": key,
            "label": label,
            "required": required,
            "input": "file",
            "uploaded": len(filed),
            "verified": len(verified),
            # Three states, not two: "uploaded but not checked" is the one a branch has to
            # act on, and folding it into Pending would hide the work that is waiting.
            "status": "completed" if verified else ("uploaded" if filed else "pending"),
            "documents": filed,
        })

    outstanding = [r["label"] for r in requirements if r["required"] and r["status"] != "completed"]
    return {
        "lead_id": lead_id,
        "lead_name": lead.get("name", ""),
        "requirements": requirements,
        "completed": sum(1 for r in requirements if r["status"] == "completed"),
        "total": sum(1 for r in requirements if r["required"]),
        "outstanding": outstanding,
        "can_close": not outstanding,
        "case_sheet_closed": bool(lead.get("case_sheet_closed")),
        "case_sheet_closed_at": lead.get("case_sheet_closed_at"),
        "case_sheet_closed_by": lead.get("case_sheet_closed_by"),
    }


@router.post("/leads/{lead_id}/close-case-sheet")
async def close_case_sheet(
    lead_id: str,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio")),
):
    """Close the case sheet, once every mandatory upload is in and verified.

    The check is here rather than only on the button, because a rule enforced only by a
    disabled button is not a rule — it is a suggestion that anyone with the endpoint can
    decline. The refusal names what is missing: "not allowed" sends a physio back to a
    screen of four rows to work out which one it meant.
    """
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("case_sheet_closed"):
        raise HTTPException(status_code=400, detail="This case sheet is already closed")

    docs = await v3_col("lead_documents").find(
        {"lead_id": lead_id, "kind": {"$in": PROGRESSION_KEYS}, "verified": True},
        {"_id": 0, "kind": 1},
    ).to_list(500)
    have = {d.get("kind") for d in docs}
    review_done = bool((lead.get(REVIEW_FIELD) or "").strip()) and bool(lead.get(f"{REVIEW_FIELD}_verified"))
    missing = [
        label for key, label, required, kind_input in PROGRESSION_KINDS
        if required and not (review_done if kind_input == "text" else key in have)
    ]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Still waiting on: {', '.join(missing)}. Each has to be uploaded and verified before the case sheet can close.",
        )

    now = now_iso()
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "case_sheet_closed": True,
        "case_sheet_closed_at": now,
        "case_sheet_closed_by": user.full_name,
        "updated_at": now,
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "case_sheet_closed",
        "details": "Case sheet closed — all four progression uploads verified",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now,
    })
    return {"closed": True, "closed_at": now, "closed_by": user.full_name}


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
