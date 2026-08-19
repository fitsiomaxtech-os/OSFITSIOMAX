from fastapi import APIRouter, HTTPException

from database import v3_col

router = APIRouter(prefix="/api/v3")


@router.get("/patient/view/{token}")
async def patient_view(token: str):
    token_doc = await v3_col("patient_tokens").find_one({"token": token}, {"_id": 0})
    if not token_doc:
        raise HTTPException(status_code=404, detail="Invalid patient link")

    lead_id = token_doc["lead_id"]
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Patient not found")

    sessions = await v3_col("sessions").find(
        {"lead_id": lead_id}, {"_id": 0}
    ).sort("slot_time", 1).to_list(500)

    patient_sessions = []
    for s in sessions:
        patient_sessions.append({
            "session_number": s.get("session_number"),
            "total_sessions": s.get("total_sessions"),
            "week_number": s.get("week_number"),
            "slot_time": s.get("slot_time"),
            "status": s.get("status"),
            "jr_physio_remarks": s.get("jr_physio_remarks", ""),
            "rehab_remarks": s.get("rehab_remarks", ""),
            "physio_name": s.get("physio_name", ""),
            "completed_at": s.get("completed_at"),
        })

    assessments = await v3_col("weekly_assessments").find(
        {"lead_id": lead_id}, {"_id": 0}
    ).sort("week_number", 1).to_list(100)

    patient_assessments = []
    for a in assessments:
        patient_assessments.append({
            "week_number": a.get("week_number"),
            "jr_physio_notes": a.get("jr_physio_notes", ""),
            "status": a.get("status"),
        })

    completed = sum(1 for s in sessions if s["status"] == "completed")
    total = len(sessions)
    rec = await v3_col("package_recommendations").find_one({"lead_id": lead_id}, {"_id": 0})

    return {
        "patient_name": lead.get("name", "Unknown"),
        "phone": lead.get("phone", ""),
        "physio_name": sessions[0]["physio_name"] if sessions else "",
        "total_sessions": total,
        "completed_sessions": completed,
        "remaining_sessions": total - completed,
        "recommended_weeks": rec.get("recommended_weeks") if rec else None,
        "sessions": patient_sessions,
        "weekly_assessments": patient_assessments,
    }
