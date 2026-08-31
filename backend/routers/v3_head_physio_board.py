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

    A Head Physio is SUPPOSED to have exactly one, branchless record — they cover the whole
    organisation — so their own user_id ought to resolve it outright. In practice they can
    end up with more than one: several paths mint these records, and consolidate_head_physio_doctors
    in seed.py exists because they have.

    find_one against that is a coin toss, and every screen a consultant has rides on the
    answer. Their patients are the appointments carrying this record's id and their calendar
    is its slots, so landing on the empty twin shows a consultant with a full book an empty
    board, and nothing on screen says why. That is not a hypothetical: it is what "I moved
    the patient to the consultant and the consultant cannot see them" looks like from the
    inside.

    So every record is read and the one holding the work is chosen: the one with
    appointments against it, else the one with published slots, else the oldest, which is
    the one the others were duplicated from. Read-only — nothing is merged or deleted here,
    because throwing away a record with bookings on it is not a repair a page load should
    be making.

    `branch_id` is only used by a Super Admin driving a specific branch's board, where there
    is no head-physio login to match on.
    """
    mine = await v3_col("doctors").find(
        {"user_id": user.id, "profile_type": "head_physio"}, {"_id": 0},
    ).to_list(50)
    if mine:
        if len(mine) == 1:
            return mine[0]
        ids = [d["id"] for d in mine]
        # Which of them anything is actually booked against. distinct rather than a count
        # per record: one query, and the question is only ever "does this one hold any".
        busy = set(await v3_col("appointments").distinct("doctor_id", {"doctor_id": {"$in": ids}}))
        mine.sort(key=lambda d: (
            0 if d["id"] in busy else 1,
            0 if (d.get("slots") or []) else 1,
            str(d.get("created_at") or ""),
        ))
        return mine[0]
    if user.role == "super_admin":
        return await v3_col("doctors").find_one({"profile_type": "head_physio"}, {"_id": 0})
    return None


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
        # `rescheduled` rides along so the grid can say this hour is not the one the
        # patient was first given. Read off the appointment rather than joined back to the
        # lead: this endpoint never loads leads, and the appointment is stamped with it at
        # the moment it is moved — see v3_schedule_branch_appointment.
        {"_id": 0, "slot_time": 1, "lead_name": 1, "id": 1, "rescheduled": 1, "rescheduled_from": 1},
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
        # A Diet referral IS a referral to the Nutritionist's consultation, so this follows
        # the flag rather than being asked for beside it.
        #
        # diet_chart is NOT written here, and not written back to False either. Whether the
        # patient needs a chart is the Nutritionist's judgement, made after seeing them and
        # recorded from their own board; clearing it here would take a chart the coach had
        # already recommended back off the branch's fee panel.
        "diet_consultation": bool(payload.diet_recommended),
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
        # Named as what it is: the one thing a Consultant can refer for on the diet side.
        # A chart, where the Nutritionist later recommends one, writes its own line.
        chosen += " + Diet Consultation"
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


def _physio_handover(lead: dict, new_physio_id: str, user: V3UserOut, now: str) -> dict:
    """The `$push` that closes the outgoing physio's spell with this patient.

    A reassignment is not a correction — the physio being replaced ran real treatment days,
    and the card that shows the new one has to be able to show what the last one got
    through first. The days themselves stay in `sessions` under the physio_id of whoever
    ran them, so the progress is still derived; what cannot be derived is a physio replaced
    before completing anything, whose upcoming days are deleted on the way out. This entry
    is what keeps that spell on the record.

    Empty when nothing changed hands — a first assignment, or a re-book with the same
    physio, which is a reschedule rather than a handover.

    The stage is what says whether there was anything to hand over. assigned_physio_id is
    written when the consultation appointment is booked, long before anyone picks who will
    deliver the treatment, so on its own it would read every first assignment as a
    reassignment away from the physio who merely took the consultation. Only a lead already
    at Physio Assign has a treatment physio to replace — see the note on the Fee Collected
    panel's Assign Physio button, which draws its label off the same test.
    """
    if lead.get("consultation_stage") != "Physio Assign":
        return {}
    previous_id = lead.get("assigned_physio_id")
    if not previous_id or previous_id == new_physio_id:
        return {}
    return {"$push": {"physio_assignment_history": {
        "physio_id": previous_id,
        "physio_name": lead.get("assigned_physio_name") or "",
        "assigned_at": lead.get("physio_assigned_at"),
        "ended_at": now,
        "replaced_by_id": new_physio_id,
        "handed_over_by": user.full_name,
        "handed_over_by_role": user.role,
    }}}


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

    now = now_iso()
    handover = _physio_handover(lead, physio["id"], user, now)
    await v3_col("leads").update_one({"id": lead_id}, {
        "$set": {
            "assigned_physio_id": physio["id"],
            "assigned_physio_name": physio["full_name"],
            "physio_assigned_at": now,
            "consultation_stage": "Physio Assign",
            "updated_at": now,
        },
        **handover,
    })
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "consultation_physio_assigned",
        "details": (
            f"Reassigned from {lead.get('assigned_physio_name')} to {physio['full_name']}"
            if handover else
            f"Assigned {physio['full_name']} to deliver treatment sessions"
        ),
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

    # Days already worked are neither re-bookable nor gone. A mid-course reassignment has
    # only the rest of the course left to place: this asked for the whole package again
    # while the completed days stayed on file under the physio who ran them, so a
    # 12-session patient moved after day 5 came out of it holding 17 treatment days — and
    # the progress the boards read off those rows said "5 of 17".
    done = await v3_col("sessions").count_documents({"lead_id": lead_id, "status": "completed"})
    to_book = total_sessions - done
    if to_book <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"All {total_sessions} treatment days are already completed — there is nothing left to book",
        )

    sorted_slots = sorted(set(payload.slot_times))
    if len(sorted_slots) != len(payload.slot_times):
        raise HTTPException(status_code=400, detail="Duplicate session slot times were submitted")
    if len(sorted_slots) != to_book:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Pick exactly {to_book} session slots (got {len(sorted_slots)})"
                + (f" — {done} of {total_sessions} days are already completed" if done else "")
            ),
        )

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

    # Where the course left off, so what is booked now carries on from it instead of
    # restarting. Day numbers drive the in-order completion guard and the "Day 3 of 9" the
    # physio's board reads; week numbers key the weekly assessments, and a second week 1
    # would land the new physio's first review on top of the old one's.
    prior_weeks = 0
    if done:
        last_done = await v3_col("sessions").find(
            {"lead_id": lead_id, "status": "completed"}, {"_id": 0, "week_number": 1},
        ).sort("week_number", -1).limit(1).to_list(1)
        prior_weeks = (last_done[0].get("week_number") or 0) if last_done else 0

    now = now_iso()
    first_date = date.fromisoformat(sorted_slots[0].split("T")[0])
    session_docs = []
    for i, slot_time in enumerate(sorted_slots):
        this_date = date.fromisoformat(slot_time.split("T")[0])
        session_docs.append({
            "id": str(uuid.uuid4()),
            "lead_id": lead_id,
            "lead_name": lead.get("name", "Unknown"),
            "branch_id": lead.get("branch_id") or user.branch_id,
            "physio_id": physio["id"],
            # Written down, not only pointed at. The Physio Assign card lists every physio a
            # patient has been through, and a name resolved per row out of `doctors` is a
            # lookup per spell for something that cannot change after the day it was booked.
            "physio_name": physio["full_name"],
            "session_number": done + i + 1,
            "total_sessions": total_sessions,
            "week_number": prior_weeks + (this_date - first_date).days // 7 + 1,
            "slot_time": slot_time,
            "status": "upcoming",
            "created_at": now,
        })
    await v3_col("sessions").insert_many([d.copy() for d in session_docs])

    handover = _physio_handover(lead, physio["id"], user, now)
    await v3_col("leads").update_one({"id": lead_id}, {
        "$set": {
            "assigned_physio_id": physio["id"],
            "assigned_physio_name": physio["full_name"],
            "physio_assigned_at": now,
            "consultation_stage": "Physio Assign",
            "updated_at": now,
        },
        **handover,
    })
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "consultation_physio_assigned",
        "details": (
            f"Reassigned from {lead.get('assigned_physio_name')} to {physio['full_name']} — "
            f"{done} of {total_sessions} days already completed, {len(session_docs)} rebooked"
            if handover else
            "Assigned " + physio["full_name"] + " and booked " + (
                f"all {total_sessions} sessions" if not done
                else f"the remaining {len(session_docs)} of {total_sessions} sessions"
            )
        ),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now,
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {
        "message": "Physio assigned and sessions booked",
        "lead": V3LeadOut(**updated).model_dump(),
        "sessions_booked": len(session_docs),
        "sessions_already_completed": done,
    }


def _blank_spell(physio_id: str) -> dict:
    """A spell nobody completed a day in. Zeroes rather than absence: the physio held the
    patient, they just have nothing to show for it, and a card that dropped them would tell
    the branch the handover never happened."""
    return {
        "physio_id": physio_id,
        "physio_name": "",
        "sessions_assigned": 0,
        "sessions_completed": 0,
        "sessions_upcoming": 0,
        "first_day": None,
        "last_day": None,
        "first_session_at": None,
        "last_session_at": None,
        "last_completed_at": None,
    }


@router.get("/leads/{lead_id}/physio-progress")
async def hp_lead_physio_progress(
    lead_id: str,
    _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio")),
):
    """Every physio this patient's treatment has been through, and how far each one got.

    What the Physio Assign card reads. `previous` is oldest first and `current` is the
    physio the patient is with now, so the card shows the spell that ended before the spell
    that is running — a reassignment mid-course leaves real completed days behind it, and
    the branch has to see those before it reads the new physio's.

    The counts are derived from the days themselves rather than kept on the lead: a
    completed day keeps the physio_id of whoever ran it, so grouping the collection by that
    field is the honest answer to how many each of them did. `physio_assignment_history`
    supplies only the chronology, and the physios whose spell ended with nothing completed
    — their upcoming days are deleted on handover and would otherwise leave no trace.

    One row per physio, not per spell: a patient handed back to someone they were already
    with reads as one spell spanning both, because their completed days cannot be told
    apart afterwards anyway.
    """
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    rows = await v3_col("sessions").find(
        {"lead_id": lead_id},
        {"_id": 0, "physio_id": 1, "physio_name": 1, "session_number": 1, "slot_time": 1,
         "status": 1, "completed_at": 1, "week_number": 1},
    ).sort("session_number", 1).to_list(1000)

    by_physio: dict = {}
    for row in rows:
        physio_id = row.get("physio_id") or ""
        if not physio_id:
            continue
        spell = by_physio.get(physio_id) or _blank_spell(physio_id)
        by_physio[physio_id] = spell
        spell["physio_name"] = spell["physio_name"] or (row.get("physio_name") or "")
        spell["sessions_assigned"] += 1
        completed = row.get("status") == "completed"
        spell["sessions_completed" if completed else "sessions_upcoming"] += 1

        number = row.get("session_number")
        if number:
            spell["first_day"] = number if spell["first_day"] is None else min(spell["first_day"], number)
            spell["last_day"] = number if spell["last_day"] is None else max(spell["last_day"], number)
        # A day still waiting on a date from the Branch Admin carries no slot_time, and the
        # empty string would sort ahead of every real date as this spell's first day.
        slot = (row.get("slot_time") or "").strip()
        if slot:
            spell["first_session_at"] = slot if not spell["first_session_at"] else min(spell["first_session_at"], slot)
            spell["last_session_at"] = slot if not spell["last_session_at"] else max(spell["last_session_at"], slot)
        if completed and row.get("completed_at"):
            spell["last_completed_at"] = max(spell["last_completed_at"] or "", row["completed_at"])

    # The chronology, deduplicated to one entry per physio: earliest start, latest end.
    history_by_physio: dict = {}
    order: list = []
    for entry in (lead.get("physio_assignment_history") or []):
        physio_id = entry.get("physio_id")
        if not physio_id:
            continue
        held = history_by_physio.get(physio_id)
        if held is None:
            history_by_physio[physio_id] = dict(entry)
            order.append(physio_id)
            continue
        if (entry.get("assigned_at") or "") and (not held.get("assigned_at") or entry["assigned_at"] < held["assigned_at"]):
            held["assigned_at"] = entry["assigned_at"]
        if (entry.get("ended_at") or "") > (held.get("ended_at") or ""):
            held["ended_at"] = entry["ended_at"]
            held["handed_over_by"] = entry.get("handed_over_by") or held.get("handed_over_by")

    # Same test as the handover above: before Physio Assign, assigned_physio_id is the
    # physio who took the consultation, not one who owes this patient any treatment days.
    current_id = (lead.get("assigned_physio_id") or "") if lead.get("consultation_stage") == "Physio Assign" else ""
    # Days belonging to a physio the history never recorded — a lead assigned before this
    # was kept, or one whose sessions were written by the older branch assign path. They
    # come after the recorded spells and before the current physio, in day order.
    unrecorded = sorted(
        (pid for pid in by_physio if pid not in history_by_physio and pid != current_id),
        key=lambda pid: by_physio[pid]["first_day"] or 0,
    )

    previous = []
    for physio_id in [*order, *unrecorded]:
        if physio_id == current_id:
            continue
        entry = history_by_physio.get(physio_id, {})
        spell = by_physio.get(physio_id) or _blank_spell(physio_id)
        previous.append({
            **spell,
            "physio_name": spell["physio_name"] or entry.get("physio_name") or "",
            "assigned_at": entry.get("assigned_at"),
            "ended_at": entry.get("ended_at"),
            "handed_over_by": entry.get("handed_over_by") or "",
            "is_current": False,
        })

    current = None
    if current_id:
        spell = by_physio.get(current_id) or _blank_spell(current_id)
        current = {
            **spell,
            "physio_name": spell["physio_name"] or lead.get("assigned_physio_name") or "",
            "assigned_at": lead.get("physio_assigned_at"),
            "ended_at": None,
            "handed_over_by": "",
            "is_current": True,
        }

    # Rows booked before physio_name was written onto them have only an id. One lookup for
    # all of them rather than one per spell.
    nameless = [s["physio_id"] for s in [*previous, *([current] if current else [])] if not s["physio_name"]]
    if nameless:
        found = await v3_col("doctors").find(
            {"id": {"$in": nameless}}, {"_id": 0, "id": 1, "full_name": 1},
        ).to_list(50)
        names = {d["id"]: d.get("full_name") or "" for d in found}
        for spell in [*previous, *([current] if current else [])]:
            spell["physio_name"] = spell["physio_name"] or names.get(spell["physio_id"]) or "Unknown physio"

    completed_sessions = sum(1 for r in rows if r.get("status") == "completed")
    # The last week the patient actually worked, so a picker placing the rest of the course
    # can go on numbering from it rather than opening a second Week 1 beside the first.
    weeks_completed = max(
        (r.get("week_number") or 0 for r in rows if r.get("status") == "completed"),
        default=0,
    )
    # What was sold and what is on the calendar are two different numbers, and they only
    # agree while the course is intact. Both are returned rather than one reconciled guess:
    # a patient reassigned before this booked the rest of their course instead of all of it
    # can hold more days than the package sold, and the card has to be able to say so.
    package_sessions = lead.get("session_package_sessions") or 0
    return {
        "lead_id": lead_id,
        "package_name": lead.get("session_package_name") or "",
        "package_sessions": package_sessions,
        "booked_sessions": len(rows),
        "completed_sessions": completed_sessions,
        "weeks_completed": weeks_completed,
        "remaining_sessions": max(0, (package_sessions or len(rows)) - completed_sessions),
        "reassigned": len(previous) > 0,
        "current": current,
        "previous": previous,
    }
