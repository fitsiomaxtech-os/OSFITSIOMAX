from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from pydantic import BaseModel
from datetime import date
import uuid

from database import v3_col
from utils import now_iso, physio_slot_load, slot_capacity_of
from deps import v3_current_user, v3_require_roles
from constants import V3_HEAD_CONSULTATION_STAGES
from stage_utils import get_closing_stage_name, get_stage_name_at
from schemas.v3 import (
    V3UserOut, V3PackageRecommendInput, V3HeadPhysioReviewInput, V3LeadOut,
    V3ConsultationDecisionInput, V3AssignPhysioSessionsInput,
)

router = APIRouter(prefix="/api/v3")


async def _head_consultation_stage_names() -> list:
    """Live Head Consultation stages as configured in Super Admin > Pipeline Stage
    Management, falling back to the built-in defaults if none have been configured yet."""
    rows = await v3_col("pipeline_stages").find(
        {"type": "head_consultation"}, {"_id": 0, "name": 1}
    ).sort("order", 1).to_list(50)
    names = [r["name"] for r in rows]
    return names or V3_HEAD_CONSULTATION_STAGES


async def _head_closing_stage() -> str:
    """Where a completed consultation lands on the Head Physio's own pipeline."""
    return await get_closing_stage_name("head_consultation", V3_HEAD_CONSULTATION_STAGES[-1])


async def _branch_consultation_visit_stage() -> str:
    """Where Branch Admin picks a finished consultation up — the named stage while it is
    still called that, otherwise the position it occupies in their pipeline."""
    rows = await v3_col("pipeline_stages").find(
        {"type": "consultation"}, {"_id": 0, "name": 1}
    ).sort("order", 1).to_list(50)
    names = [r["name"] for r in rows]
    if "Consultation Visit" in names:
        return "Consultation Visit"
    return await get_stage_name_at("consultation", 1, "Consultation Visit")


async def _resolve_hp_doctor(user: V3UserOut, branch_id: Optional[str] = None) -> Optional[dict]:
    """Find the doctors record for the logged-in head physio/consultant.

    A Head Physio has exactly one, branchless record — they cover the whole organisation —
    so their own user_id resolves it outright. `branch_id` is only used by a Super Admin
    driving a specific branch's board, where there is no head-physio login to match on."""
    doctor = await v3_col("doctors").find_one(
        {"user_id": user.id, "profile_type": "head_physio"},
        {"_id": 0},
    )
    if doctor:
        return doctor
    if user.role == "super_admin":
        doctor = await v3_col("doctors").find_one({"profile_type": "head_physio"}, {"_id": 0})
    return doctor


@router.get("/head-physio/resolved")
async def hp_resolved_consultant(user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin"))):
    """Whose consultant book the board is about to show, and whether it is the caller's own.

    _resolve_hp_doctor falls back to any consultant record for a Super Admin, which is right
    for driving somebody else's branch board and wrong for a page called My Consultation —
    a Super Admin with no consultant record of their own would be shown a stranger's
    appointments under their own name, with nothing on screen saying so.

    Read-only and additive: it changes no existing resolution, it only reports it, so the
    caller can say plainly whose book this is.
    """
    own = await v3_col("doctors").find_one(
        {"user_id": user.id, "profile_type": "head_physio"}, {"_id": 0, "id": 1, "full_name": 1},
    )
    if own:
        return {"consultant_id": own["id"], "consultant_name": own.get("full_name") or "", "is_mine": True}

    fallback = await _resolve_hp_doctor(user)
    if not fallback:
        return {"consultant_id": "", "consultant_name": "", "is_mine": False}
    return {
        "consultant_id": fallback.get("id", ""),
        "consultant_name": fallback.get("full_name") or "",
        "is_mine": False,
    }


@router.get("/head-physio/my-calendar")
async def hp_my_calendar(branch_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin"))):
    """Read-only view of the logged-in consultant's own booked slots (branch admin manages slot availability)."""
    doctor = await _resolve_hp_doctor(user, branch_id)
    if not doctor:
        return {"slots": [], "slot_details": [], "booked": {}}

    # Two different things take a Head Physio's slot, and the calendar has to say which.
    # A review is dispatched into one of these published slots exactly as a consultation is
    # booked into it — it was simply never read here, so a slot held by a review showed as
    # "Available" and could be booked over.
    review_rows = await v3_col("reviews").find(
        {"head_physio_id": doctor["id"], "review_date": {"$nin": ["", None]}},
        {"_id": 0, "id": 1, "lead_name": 1, "review_date": 1, "review_time": 1, "status": 1, "physio_name": 1},
    ).to_list(1000)

    booked_map = {}
    for r in review_rows:
        # No time means it was never placed on the grid — it is on the Review list waiting
        # for one, and inventing a slot for it here would put it in an hour nobody chose.
        if not r.get("review_time"):
            continue
        slot = f"{r['review_date']}T{r['review_time']}"
        booked_map[slot] = {
            "id": r.get("id"),
            "slot_time": slot,
            "lead_name": r.get("lead_name", "Unknown"),
            "kind": "review",
            "kind_label": "Review",
            "status": r.get("status", ""),
            "with_name": r.get("physio_name", ""),
        }

    appt_rows = await v3_col("appointments").find(
        {"doctor_id": doctor["id"], "status": "new_appointment"},
        {"_id": 0, "slot_time": 1, "lead_name": 1, "id": 1},
    ).to_list(1000)
    for row in appt_rows:
        # Written second on purpose. If a slot somehow holds both, the consultation is the
        # one shown — it is the appointment the patient was given a time for. Two things in
        # one slot is a booking fault of its own, and hiding the harder one would be worse
        # than hiding the review.
        booked_map[row["slot_time"]] = {**row, "kind": "consultation", "kind_label": "Consultation"}

    # Surface booked slots even when the branch admin never pre-created an availability slot
    # for them — union booked times into the displayed slots.
    slots = sorted(set(doctor.get("slots", [])) | set(booked_map.keys()))

    return {
        "doctor_id": doctor["id"],
        "doctor_name": doctor["full_name"],
        "specialization": doctor.get("specialization", ""),
        "slots": slots,
        "slot_details": doctor.get("slot_details", []),
        "booked": booked_map,
    }


@router.get("/head-physio/my-patients")
async def hp_my_patients(branch_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin"))):
    doctor = await _resolve_hp_doctor(user, branch_id)
    if not doctor:
        return {"patients": []}

    appointments = await v3_col("appointments").find(
        {"doctor_id": doctor["id"]},
        {"_id": 0},
    ).sort("slot_time", -1).to_list(500)

    lead_ids = list({a["lead_id"] for a in appointments})
    leads = await v3_col("leads").find({"id": {"$in": lead_ids}}, {"_id": 0}).to_list(500)
    lead_map = {l["id"]: l for l in leads}

    recommendations = await v3_col("package_recommendations").find(
        {"lead_id": {"$in": lead_ids}}, {"_id": 0}
    ).to_list(500)
    rec_map = {r["lead_id"]: r for r in recommendations}

    patients = []
    for lead_id in lead_ids:
        lead = lead_map.get(lead_id, {})
        appts = [a for a in appointments if a["lead_id"] == lead_id]
        rec = rec_map.get(lead_id)
        patients.append({
            "lead_id": lead_id,
            "lead_name": lead.get("name", "Unknown"),
            "phone": lead.get("phone", ""),
            "email": lead.get("email", ""),
            "branch_stage": lead.get("branch_stage", ""),
            "consultation_fee": lead.get("consultation_fee"),
            "package_amount": lead.get("package_amount"),
            "appointments": appts,
            "recommendation": rec,
            "has_recommendation": rec is not None,
        })

    return {"patients": patients}


@router.post("/head-physio/recommend-package")
async def hp_recommend_package(
    payload: V3PackageRecommendInput,
    user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin")),
):
    lead = await v3_col("leads").find_one({"id": payload.lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    doctor = await _resolve_hp_doctor(user, lead.get("branch_id"))

    total_sessions = payload.recommended_weeks * payload.sessions_per_week

    rec = {
        "id": str(uuid.uuid4()),
        "lead_id": payload.lead_id,
        "lead_name": lead.get("name", "Unknown"),
        "branch_id": lead.get("branch_id") or user.branch_id,
        "head_physio_id": doctor["id"] if doctor else "",
        "head_physio_name": doctor["full_name"] if doctor else user.full_name,
        "recommended_weeks": payload.recommended_weeks,
        "sessions_per_week": payload.sessions_per_week,
        "total_sessions": total_sessions,
        "notes": payload.notes or "",
        "status": "pending",
        "created_at": now_iso(),
    }
    await v3_col("package_recommendations").insert_one(rec.copy())

    await v3_col("leads").update_one(
        {"id": payload.lead_id},
        {"$set": {"branch_stage": "Follow Up", "updated_at": now_iso()}},
    )

    activity = {
        "id": str(uuid.uuid4()),
        "lead_id": payload.lead_id,
        "action": "package_recommended",
        "details": f"CONSULTANT recommended {payload.recommended_weeks} weeks, {payload.sessions_per_week} sessions/week ({total_sessions} total). Notes: {payload.notes}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("lead_activity").insert_one(activity.copy())

    return rec


@router.get("/head-physio/sessions/{lead_id}")
async def hp_view_sessions(lead_id: str, _: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin", "branch_admin"))):
    sessions = await v3_col("sessions").find(
        {"lead_id": lead_id}, {"_id": 0}
    ).sort("slot_time", 1).to_list(500)
    return {"sessions": sessions}


@router.get("/head-physio/weekly-assessments/{lead_id}")
async def hp_get_assessments(lead_id: str, _: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin"))):
    assessments = await v3_col("weekly_assessments").find(
        {"lead_id": lead_id}, {"_id": 0}
    ).sort("week_number", 1).to_list(100)
    return {"assessments": assessments}


@router.post("/head-physio/weekly-review/{lead_id}/{week_number}")
async def hp_weekly_review(
    lead_id: str,
    week_number: int,
    payload: V3HeadPhysioReviewInput,
    user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin")),
):
    existing = await v3_col("weekly_assessments").find_one(
        {"lead_id": lead_id, "week_number": week_number}, {"_id": 0}
    )

    if existing:
        await v3_col("weekly_assessments").update_one(
            {"lead_id": lead_id, "week_number": week_number},
            {"$set": {
                "head_physio_notes": payload.head_physio_notes,
                "head_physio_suggestions": payload.head_physio_suggestions,
                "status": "reviewed",
                "reviewed_by": user.full_name,
                "updated_at": now_iso(),
            }},
        )
    else:
        await v3_col("weekly_assessments").insert_one({
            "id": str(uuid.uuid4()),
            "lead_id": lead_id,
            "branch_id": user.branch_id,
            "week_number": week_number,
            "jr_physio_notes": "",
            "head_physio_notes": payload.head_physio_notes,
            "head_physio_suggestions": payload.head_physio_suggestions,
            "status": "reviewed",
            "reviewed_by": user.full_name,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        })

    updated = await v3_col("weekly_assessments").find_one(
        {"lead_id": lead_id, "week_number": week_number}, {"_id": 0}
    )
    return updated


class V3ConsultationPhysioAssignInput(BaseModel):
    physio_id: str


class V3HeadConsultationStageMoveInput(BaseModel):
    head_consultation_stage: str


@router.post("/leads/{lead_id}/move-head-consultation-stage", response_model=dict)
async def hp_move_head_consultation_stage(
    lead_id: str,
    payload: V3HeadConsultationStageMoveInput,
    user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin")),
):
    """Move a lead through the Head Physio's own consultation pipeline
    (head_consultation_stage) — fully independent from Branch's consultation_stage."""
    stage_names = await _head_consultation_stage_names()
    if payload.head_consultation_stage not in stage_names:
        raise HTTPException(status_code=400, detail=f"Invalid head_consultation_stage. Allowed: {stage_names}")
    if payload.head_consultation_stage == await _head_closing_stage():
        raise HTTPException(
            status_code=403,
            detail="Use the consultation-decision endpoint (Save & Move) — it requires Diagnosis, Treatment Summary and a decision first.",
        )
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    previous = lead.get("head_consultation_stage") or "—"
    updates = {
        "head_consultation_stage": payload.head_consultation_stage,
        "updated_at": now_iso(),
    }
    await v3_col("leads").update_one({"id": lead_id}, {"$set": updates})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "head_consultation_stage_moved",
        "details": f"Head Consultation: {previous} → {payload.head_consultation_stage}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Stage moved", "lead": V3LeadOut(**updated).model_dump()}


@router.post("/leads/{lead_id}/consultation-decision", response_model=dict)
async def hp_consultation_decision(
    lead_id: str,
    payload: V3ConsultationDecisionInput,
    user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin")),
):
    """Head Physio's 'Save & Move' — the single action that closes out the
    consultation: requires Diagnosis Report + Treatment Summary to already be
    written, records the Consultation Only / Consultation + Treatment decision
    (and, for the latter, the chosen Treatment/Session package — names only, no
    price shown here), then hands the lead to Branch Admin's 'Consultation Visit'
    column on both pipelines at once."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not (lead.get("physio_diagnosis_report") or "").strip():
        raise HTTPException(status_code=400, detail="Write the Diagnosis Report before Save & Move")
    if not (lead.get("treatment_summary") or "").strip():
        raise HTTPException(status_code=400, detail="Write the Treatment Summary before Save & Move")

    # Completing a consultation moves BOTH pipelines at once: the lead closes out on the
    # Head Physio's board and appears on Branch Admin's Consultation Visit column, which
    # is the one hand-off point between the two.
    updates = {
        "consultation_decision": payload.decision,
        "diet_recommended": bool(payload.diet_recommended),
        # Only meaningful with the referral, so they are held to it here rather than
        # trusted from the form. A Diet Chart recorded on a patient nobody referred to a
        # Nutritionist is a row no screen would ever show and no queue would ever pick up.
        "diet_consultation": bool(payload.diet_recommended and payload.diet_consultation),
        "diet_chart": bool(payload.diet_recommended and payload.diet_chart),
        # Recorded rather than inferred. The Rehab card is derived from "has an appointment
        # with me and no package recommendation yet", which is true of a Consultation Only
        # patient too — without this flag there is no way to tell a patient deliberately
        # sent to rehab from one who simply has not been given a package.
        "rehab_referred": bool(payload.rehab_referred),
        "fitness_recommended": bool(payload.fitness_recommended),
        "zumba_recommended": bool(payload.zumba_recommended),
        "head_consultation_stage": await _head_closing_stage(),
        "consultation_stage": await _branch_consultation_visit_stage(),
        "updated_at": now_iso(),
    }
    # Named the way the Head Physio picked it, so the activity log reads back as the
    # choice that was made rather than as flags to recombine.
    chosen = "Consultation" if payload.decision == "consultation_only" else "Consultation + Treatment"
    if payload.rehab_referred:
        chosen += " + Rehab"
    if payload.diet_recommended:
        # Named as what it is where the Consultant said which, and plain "Diet" where they
        # did not — the log reads back the choice that was made rather than a shape that
        # implies a question was answered when it was not.
        picked = [
            name for name, on in (
                ("Diet Consultation", payload.diet_consultation),
                ("Diet Chart", payload.diet_chart),
            ) if on
        ]
        chosen += (" + " + " + ".join(picked)) if picked else " + Diet"
    if payload.fitness_recommended:
        chosen += " + Fitness"
    if payload.zumba_recommended:
        chosen += " + Zumba"
    detail = f"Consultation decision: {chosen}"

    # Consultation Fee has a single fixed price (FITSIO STORE > Consultation) — there's
    # nothing for the Head Physio to pick, so it's auto-assigned the first time a lead
    # reaches this decision, the same way it always has been, just without a manual step.
    if not lead.get("package_id"):
        consultation_item = await v3_col("store_items").find_one({"item_type": "consultation"}, {"_id": 0})
        if consultation_item:
            mode = lead.get("appointment_mode") or "offline"
            price = consultation_item.get("price_online") if mode == "online" else consultation_item.get("price_offline")
            updates.update({
                "package_id": consultation_item["id"],
                "package_name": consultation_item["name"],
                "package_price": price,
                "package_duration_minutes": consultation_item.get("duration_minutes"),
                "package_mode": mode,
            })

    if payload.decision == "consultation_treatment":
        if not payload.item_id:
            raise HTTPException(status_code=400, detail="Select a Treatment Package")
        item = await v3_col("store_items").find_one({"id": payload.item_id}, {"_id": 0})
        if not item:
            raise HTTPException(status_code=404, detail="Treatment package not found")
        if item.get("item_type") != "session":
            raise HTTPException(status_code=400, detail="Only Session packages can be chosen as the Treatment Package")
        # price_online/price_offline is a flat per-session rate (same across every
        # package size) — the total is just that rate × however many sessions this
        # patient is actually being charged for, never prorated against the package's
        # own default session count.
        base_price = item.get("price_online") if payload.mode == "online" else item.get("price_offline")
        base_sessions = item.get("sessions_online") if payload.mode == "online" else item.get("sessions_offline")
        sessions = payload.sessions_override if payload.sessions_override and payload.sessions_override > 0 else base_sessions
        price = round(base_price * sessions, 2) if base_price is not None and sessions else base_price
        updates.update({
            "session_package_id": item["id"],
            "session_package_name": item["name"],
            "session_package_price": price,
            "session_package_sessions": sessions,
            "session_package_mode": payload.mode,
        })
        detail += f" · Package: {item['name']} ({sessions} sessions)"

    # The Rehab course is priced by hand: the catalogue holds the whole course fee as it
    # was typed, and it is charged as it stands. Nothing is derived, so nothing can come
    # back a rupee off what was agreed.
    #
    # The rate x sessions path below it is for rows written before that, which still hold
    # the total divided down. Startup converts them (migrate_course_prices_to_totals) and
    # the flag says which is which; keeping both means the order of a deploy and a restart
    # cannot decide what a patient is charged.
    #
    # Only accepted alongside the referral — a rehab course on a patient who was never sent
    # to rehab is a fee nobody would know to collect.
    if payload.rehab_referred and payload.rehab_item_id:
        rehab_item = await v3_col("store_items").find_one({"id": payload.rehab_item_id}, {"_id": 0})
        if not rehab_item:
            raise HTTPException(status_code=404, detail="Rehab package not found")
        if rehab_item.get("item_type") != "session" or rehab_item.get("category") != "rehab":
            raise HTTPException(status_code=400, detail="That item is not a Rehab package")
        r_amount = rehab_item.get("price_online") if payload.mode == "online" else rehab_item.get("price_offline")
        r_sessions = rehab_item.get("sessions_online") if payload.mode == "online" else rehab_item.get("sessions_offline")
        if rehab_item.get("price_is_total"):
            r_price = r_amount
        else:
            r_price = round(r_amount * r_sessions, 2) if r_amount is not None and r_sessions else r_amount
        updates.update({
            "rehab_package_id": rehab_item["id"],
            "rehab_package_name": rehab_item["name"],
            "rehab_package_price": r_price,
            "rehab_package_sessions": r_sessions,
            "rehab_package_mode": payload.mode,
        })
        detail += f" · Rehab: {rehab_item['name']} ({r_sessions} sessions)"

    # The Zumba membership, priced the way rehab is — its plan amount is stored divided
    # down to a per-class rate, so rate x classes lands back on the figure the catalogue
    # was given. Only accepted alongside its own flag, for the same reason.
    if payload.zumba_recommended and payload.zumba_item_id:
        zumba_item = await v3_col("store_items").find_one({"id": payload.zumba_item_id}, {"_id": 0})
        if not zumba_item:
            raise HTTPException(status_code=404, detail="Zumba package not found")
        if zumba_item.get("item_type") != "session" or zumba_item.get("category") != "zumba":
            raise HTTPException(status_code=400, detail="That item is not a Zumba package")
        z_rate = zumba_item.get("price_online") if payload.mode == "online" else zumba_item.get("price_offline")
        z_sessions = zumba_item.get("sessions_online") if payload.mode == "online" else zumba_item.get("sessions_offline")
        z_price = round(z_rate * z_sessions, 2) if z_rate is not None and z_sessions else z_rate
        updates.update({
            "zumba_package_id": zumba_item["id"],
            "zumba_package_name": zumba_item["name"],
            "zumba_package_price": z_price,
            "zumba_package_sessions": z_sessions,
            "zumba_package_mode": payload.mode,
        })
        detail += f" · Zumba: {zumba_item['name']} ({z_sessions} classes)"

    await v3_col("leads").update_one({"id": lead_id}, {"$set": updates})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "consultation_decision_saved",
        "details": detail,
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Saved & moved", "lead": V3LeadOut(**updated).model_dump()}


@router.post("/leads/{lead_id}/assign-consultation-physio")
async def hp_assign_consultation_physio(
    lead_id: str,
    payload: V3ConsultationPhysioAssignInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """Branch Admin picks the physio who will deliver the assigned package's
    treatment sessions — the last step in the Consultations pipeline. The lead
    rests at 'Fee Collected' once both fees are paid; this call is what actually
    advances it to 'Physio Assign'. Also callable while already at 'Physio Assign'
    for reassigning to a different physio."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("consultation_stage") not in ("Fee Collected", "Physio Assign") or lead.get("treatment_fee_paid") is None:
        raise HTTPException(status_code=400, detail="A physio can only be assigned after the Treatment Fee has been collected")
    physio = await v3_col("doctors").find_one(
        {"id": payload.physio_id, "profile_type": "physio"}, {"_id": 0}
    )
    if not physio:
        raise HTTPException(status_code=404, detail="Physio not found")

    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "assigned_physio_id": physio["id"],
        "assigned_physio_name": physio["full_name"],
        "physio_assigned_at": now_iso(),
        "consultation_stage": "Physio Assign",
        "updated_at": now_iso(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "consultation_physio_assigned",
        "details": f"Assigned {physio['full_name']} to deliver treatment sessions",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Physio assigned", "lead": V3LeadOut(**updated).model_dump()}


@router.post("/leads/{lead_id}/assign-physio-sessions")
async def hp_assign_physio_with_sessions(
    lead_id: str,
    payload: V3AssignPhysioSessionsInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """Branch Admin picks the physio AND books every one of the patient's paid
    session-package sessions against that physio's own calendar (Consultations >
    Physio Calendar), in one step — same eligibility guard as
    assign-consultation-physio, but this is what actually turns the paid session
    count into real, dated `sessions` records rather than just a label."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("consultation_stage") not in ("Fee Collected", "Physio Assign") or lead.get("treatment_fee_paid") is None:
        raise HTTPException(status_code=400, detail="A physio can only be assigned after the Treatment Fee has been collected")

    total_sessions = lead.get("session_package_sessions")
    if not total_sessions:
        raise HTTPException(status_code=400, detail="This lead has no session package to schedule")

    sorted_slots = sorted(set(payload.slot_times))
    if len(sorted_slots) != len(payload.slot_times):
        raise HTTPException(status_code=400, detail="Duplicate session slot times were submitted")
    if len(sorted_slots) != total_sessions:
        raise HTTPException(status_code=400, detail=f"Pick exactly {total_sessions} session slots (got {len(sorted_slots)})")

    physio = await v3_col("doctors").find_one({"id": payload.physio_id, "profile_type": "physio"}, {"_id": 0})
    if not physio:
        raise HTTPException(status_code=404, detail="Physio not found")

    # A physio runs a floor — two or three patients share a slot — so a slot is only
    # unavailable once it is FULL. This used to reject on a single existing booking, which
    # made the second and third patient of every hour unbookable.
    #
    # Counted through the shared helper, which reads the physio's rehab days as well as
    # their treatment days. This side used to count `sessions` alone, so a physio's rehab
    # course was invisible here and a slot already holding three rehab patients still
    # accepted three more treatment ones — while the picker, reading both off
    # get_doctor_calendar, had drawn that same slot full.
    #
    # This lead's own sessions are discounted rather than deleted first. Deleting first
    # answered "a re-assignment must not clash with itself" by destroying the schedule
    # before anything had agreed to replace it: every refusal below returned 400 with the
    # patient's existing sessions already gone from the physio's calendar.
    capacity = slot_capacity_of(physio)
    taken, lead_elsewhere = await physio_slot_load(
        payload.physio_id, sorted_slots, lead_id=lead_id, replacing="sessions",
    )

    # A rehab day of this patient's own is not a seat to book beside — it is this patient,
    # already spoken for at that hour. Named plainly, because "full" would send the branch
    # looking for someone else's booking that isn't there.
    clashing = sorted(s for s in sorted_slots if s in lead_elsewhere)
    if clashing:
        what = lead_elsewhere[clashing[0]]
        raise HTTPException(
            status_code=400,
            detail=f"{lead.get('name', 'This patient')} already has a {what} at: {', '.join(clashing)}",
        )

    full = sorted(s for s in sorted_slots if taken.get(s, 0) >= capacity)
    if full:
        raise HTTPException(
            status_code=400,
            detail=f"Full for this physio ({capacity} per slot): {', '.join(full)}",
        )

    # Past every refusal: the old set can go now, and the new one replaces it.
    await v3_col("sessions").delete_many({"lead_id": lead_id, "status": "upcoming"})

    now = now_iso()
    first_date = date.fromisoformat(sorted_slots[0].split("T")[0])
    session_docs = []
    for i, slot_time in enumerate(sorted_slots):
        this_date = date.fromisoformat(slot_time.split("T")[0])
        session_docs.append({
            "id": str(uuid.uuid4()),
            "lead_id": lead_id,
            "lead_name": lead.get("name", "Unknown"),
            "physio_id": physio["id"],
            "session_number": i + 1,
            "total_sessions": total_sessions,
            "week_number": (this_date - first_date).days // 7 + 1,
            "slot_time": slot_time,
            "status": "upcoming",
            "created_at": now,
        })
    await v3_col("sessions").insert_many([d.copy() for d in session_docs])

    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "assigned_physio_id": physio["id"],
        "assigned_physio_name": physio["full_name"],
        "physio_assigned_at": now,
        "consultation_stage": "Physio Assign",
        "updated_at": now,
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "consultation_physio_assigned",
        "details": f"Assigned {physio['full_name']} and booked all {total_sessions} sessions",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now,
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {
        "message": "Physio assigned and sessions booked",
        "lead": V3LeadOut(**updated).model_dump(),
        "sessions_booked": len(session_docs),
    }
