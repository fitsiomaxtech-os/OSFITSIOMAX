from fastapi import APIRouter, HTTPException, Depends
import uuid

from database import v3_col
from utils import now_iso, normalize_slot_time
from deps import v3_require_roles
from schemas.v3 import V3UserOut, V3AssignSessionsInput

router = APIRouter(prefix="/api/v3")


@router.get("/branch/package-recommendations")
async def get_recommendations(user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    query = {}
    if user.branch_id:
        query["branch_id"] = user.branch_id

    recs = await v3_col("package_recommendations").find(query, {"_id": 0}).sort("created_at", -1).to_list(500)

    lead_ids = [r["lead_id"] for r in recs]
    leads = await v3_col("leads").find({"id": {"$in": lead_ids}}, {"_id": 0}).to_list(500)
    lead_map = {l["id"]: l for l in leads}

    for rec in recs:
        lead = lead_map.get(rec["lead_id"], {})
        rec["lead_phone"] = lead.get("phone", "")
        rec["lead_email"] = lead.get("email", "")
        rec["branch_stage"] = lead.get("branch_stage", "")
        rec["package_amount"] = lead.get("package_amount")

    return {"recommendations": recs}


@router.post("/branch/assign-sessions")
async def assign_sessions(
    payload: V3AssignSessionsInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    lead = await v3_col("leads").find_one({"id": payload.lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    physio = await v3_col("doctors").find_one({"id": payload.physio_id}, {"_id": 0})
    if not physio:
        raise HTTPException(status_code=404, detail="Jr. Physio not found")

    rec = await v3_col("package_recommendations").find_one({"lead_id": payload.lead_id}, {"_id": 0})

    total = len(payload.slot_times)
    sessions_to_create = []

    for i, slot_time in enumerate(payload.slot_times):
        normalized = normalize_slot_time(slot_time)
        week_num = (i // (rec["sessions_per_week"] if rec else 3)) + 1

        session = {
            "id": str(uuid.uuid4()),
            "lead_id": payload.lead_id,
            "lead_name": lead.get("name", "Unknown"),
            "branch_id": lead.get("branch_id") or user.branch_id,
            "physio_id": payload.physio_id,
            "physio_name": physio["full_name"],
            "head_physio_id": rec.get("head_physio_id", "") if rec else "",
            "head_physio_name": rec.get("head_physio_name", "") if rec else "",
            "session_number": i + 1,
            "total_sessions": total,
            "week_number": week_num,
            "slot_time": normalized,
            "status": "upcoming",
            "jr_physio_remarks": "",
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        sessions_to_create.append(session)

    if sessions_to_create:
        await v3_col("sessions").insert_many([s.copy() for s in sessions_to_create])

    await v3_col("leads").update_one(
        {"id": payload.lead_id},
        {"$set": {
            "assigned_physio_id": payload.physio_id,
            "assigned_physio_name": physio["full_name"],
            "physio_assigned_at": now_iso(),
            "branch_stage": "Assigned Physio",
            "updated_at": now_iso(),
        }},
    )

    if rec:
        await v3_col("package_recommendations").update_one(
            {"id": rec["id"]},
            {"$set": {"status": "assigned"}},
        )

    patient_token = str(uuid.uuid4())
    await v3_col("patient_tokens").update_one(
        {"lead_id": payload.lead_id},
        {"$set": {"lead_id": payload.lead_id, "token": patient_token, "created_at": now_iso()}},
        upsert=True,
    )

    activity = {
        "id": str(uuid.uuid4()),
        "lead_id": payload.lead_id,
        "action": "sessions_assigned",
        "details": f"{total} sessions assigned to {physio['full_name']}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("lead_activity").insert_one(activity.copy())

    return {
        "sessions_created": total,
        "physio_name": physio["full_name"],
        "patient_token": patient_token,
        "lead_id": payload.lead_id,
    }
