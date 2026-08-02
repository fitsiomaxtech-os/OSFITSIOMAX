"""Patient testimonial videos — YouTube links a Pre-Sales rep (or admin) adds from the
CRM, shown on the public /testimonials page that gets shared with leads over WhatsApp
so they can see real patient results before their first call. The management endpoints
are staff-auth; GET /testimonials itself is deliberately public (no auth) since leads
open that link straight from WhatsApp with no account of their own.
"""
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException

from database import v3_col
from utils import now_iso
from deps import v3_require_roles
from schemas.v3 import V3UserOut, V3TestimonialInput

router = APIRouter(prefix="/api/v3")

_YOUTUBE_ID_RE = re.compile(
    r"(?:youtu\.be/|youtube\.com/(?:watch\?v=|shorts/|embed/|live/))([A-Za-z0-9_-]{6,})"
)


def _extract_youtube_id(url: str) -> str:
    match = _YOUTUBE_ID_RE.search((url or "").strip())
    if not match:
        raise HTTPException(status_code=400, detail="That doesn't look like a valid YouTube link")
    return match.group(1)


@router.get("/testimonials")
async def public_testimonials():
    rows = await v3_col("testimonial_videos").find(
        {"active": True}, {"_id": 0, "id": 1, "video_id": 1, "title": 1, "created_at": 1}
    ).sort("created_at", -1).to_list(200)
    return rows


@router.get("/testimonials/manage")
async def manage_testimonials(user: V3UserOut = Depends(v3_require_roles("pre_sales", "branch_admin", "super_admin"))):
    rows = await v3_col("testimonial_videos").find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return rows


@router.post("/testimonials")
async def create_testimonial(
    payload: V3TestimonialInput,
    user: V3UserOut = Depends(v3_require_roles("pre_sales", "branch_admin", "super_admin")),
):
    video_id = _extract_youtube_id(payload.youtube_url)
    doc = {
        "id": str(uuid.uuid4()),
        "video_id": video_id,
        "title": (payload.title or "").strip() or None,
        "active": True,
        "added_by": user.full_name,
        "added_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("testimonial_videos").insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.delete("/testimonials/{testimonial_id}")
async def delete_testimonial(
    testimonial_id: str,
    user: V3UserOut = Depends(v3_require_roles("pre_sales", "branch_admin", "super_admin")),
):
    result = await v3_col("testimonial_videos").delete_one({"id": testimonial_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Testimonial not found")
    return {"message": "Deleted"}
