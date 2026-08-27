"""Client Portal — a login (email + password) Branch Admin generates for a patient once
their Treatment Fee is paid, so the patient can check their own session progress without
staff involvement.

Kept in its own patient_portal_accounts / patient_portal_sessions collections rather than
reusing `users`/`sessions` — those are staff-only, and `sessions` already carries a second,
unrelated shape (treatment-session bookings, deliberately, per v3_reviews.py's docstring
about what happened the last time this collection grew a second shape); a third shape on
top of that is exactly the mistake to avoid, not repeat.
"""
import os
import random
import string
import uuid
from typing import Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from fastapi.responses import FileResponse

from database import v3_col
from routers.v3_reviews import review_numbers_for_lead
from utils import now_iso
from security import hash_password, verify_password
from deps import v3_require_roles, is_branch_admin_role
from routers.v3_lead_documents import DIET_CHART, DOC_DIR, is_shared_with_patient
from routers.v3_feedback import (
    AUDIENCE_SUPER, AUTHOR_PATIENT, AUTHOR_STAFF, MAX_MESSAGE,
    STATUS_AWAITING, STATUS_IN_PROGRESS, STATUS_NEW, STATUS_RESOLVED,
    _audience, _rating, _thread,
)
from schemas.v3 import V3UserOut, V3PortalAccountInput, V3PatientPortalLogin, V3PatientPortalGoogleLogin

router = APIRouter(prefix="/api/v3")

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
_google_request = google_requests.Request()


def _generate_password(length: int = 10) -> str:
    # No 0/O, 1/l/I or similarly-confusable characters — this is typed by a patient on
    # a phone keyboard, often copy-pasted imperfectly from a WhatsApp message on a small
    # screen, so every character needs to be unambiguous by eye. Length bumped up from 8
    # to 10 to keep entropy reasonable after shrinking the alphabet.
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
    return "".join(random.choices(alphabet, k=length))


async def _lead_or_404(lead_id: str) -> dict:
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Patient not found")
    return lead


def has_treatment(lead: dict) -> bool:
    """Whether this patient is on a course of treatment, and so gets the Client Portal.

    The portal exists for a course of sessions: progress to follow, a plan to read
    between visits, a balance to watch. That is what makes it worth logging in to, and
    what a one-off consultation does not have.

    Three signals, any one of which means treatment exists. Written as presence rather
    than as an amount, because HOW MUCH has been paid must never decide this — a patient
    on a 10,000 package who has paid 2,000 is mid-treatment and needs the portal most of
    all. `treatment_fee_paid` is set the moment any treatment money or Partial Payment
    schedule is recorded, whatever the figure, including zero.

    What this deliberately excludes: "Consultation Only", and a patient who came for a
    Diet Consultation alone. Both are paying patients, and neither is a treatment patient.
    A patient on treatment who ALSO takes a diet plan matches on the treatment side and
    keeps the portal.
    """
    return (
        lead.get("treatment_fee_paid") is not None          # fee collected, in full or part
        or bool(lead.get("session_package_id"))             # treatment package chosen
        or lead.get("consultation_decision") == "consultation_treatment"
    )


# ------------------------------------------------------------- Branch Admin: manage access

@router.get("/leads/{lead_id}/portal-account")
async def get_portal_account(lead_id: str, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    lead = await _lead_or_404(lead_id)
    if is_branch_admin_role(user.role) and lead.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=404, detail="Patient not found")
    account = await v3_col("patient_portal_accounts").find_one({"lead_id": lead_id}, {"_id": 0, "email": 1, "created_at": 1})
    if not account:
        return {"exists": False}
    return {"exists": True, "email": account["email"], "created_at": account.get("created_at")}


@router.post("/leads/{lead_id}/portal-account")
async def create_or_reset_portal_account(
    lead_id: str,
    payload: V3PortalAccountInput,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """Create-or-reset in one call: the first time, this creates the account; every call
    after that resets the password (freshly generated unless the caller supplies one),
    since re-sharing a lost password is the same action either way. The plaintext
    password is returned only here, this once — nothing later can ever read it back."""
    lead = await _lead_or_404(lead_id)
    if is_branch_admin_role(user.role) and lead.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=404, detail="Patient not found")
    if not has_treatment(lead):
        raise HTTPException(
            status_code=400,
            detail="Only treatment patients get the Client Portal — this patient has no treatment sessions.",
        )

    email = (payload.email or lead.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="An email is required for portal access")

    clash = await v3_col("patient_portal_accounts").find_one(
        {"email": email, "lead_id": {"$ne": lead_id}}, {"_id": 0, "id": 1}
    )
    if clash:
        raise HTTPException(status_code=409, detail="This email is already used for another patient's portal account")

    password = (payload.password or "").strip() or _generate_password()
    now = now_iso()
    existing = await v3_col("patient_portal_accounts").find_one({"lead_id": lead_id}, {"_id": 0, "id": 1})
    if existing:
        await v3_col("patient_portal_accounts").update_one(
            {"lead_id": lead_id},
            {"$set": {"email": email, "password_hash": hash_password(password), "updated_at": now, "updated_by": user.full_name}},
        )
    else:
        await v3_col("patient_portal_accounts").insert_one({
            "id": str(uuid.uuid4()),
            "lead_id": lead_id,
            "branch_id": lead.get("branch_id"),
            "email": email,
            "password_hash": hash_password(password),
            "created_at": now,
            "created_by": user.full_name,
            "updated_at": now,
        })
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "portal_account_reset" if existing else "portal_account_created",
        "details": f"{'Reset' if existing else 'Created'} Client Portal access for {email}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now,
    })
    return {"email": email, "password": password}


# --------------------------------------------------------------------- Patient: log in

async def _start_portal_session(account: dict) -> dict:
    token = str(uuid.uuid4())
    await v3_col("patient_portal_sessions").insert_one({
        "token": token,
        "account_id": account["id"],
        "lead_id": account["lead_id"],
        "created_at": now_iso(),
    })
    lead = await v3_col("leads").find_one({"id": account["lead_id"]}, {"_id": 0, "name": 1})
    return {"token": token, "patient_name": (lead or {}).get("name", "")}


@router.post("/patient-portal/login")
async def patient_portal_login(payload: V3PatientPortalLogin):
    email = payload.email.strip().lower()
    account = await v3_col("patient_portal_accounts").find_one({"email": email}, {"_id": 0})
    if not account or not verify_password(payload.password, account.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return await _start_portal_session(account)


@router.post("/patient-portal/google-login")
async def patient_portal_google_login(payload: V3PatientPortalGoogleLogin):
    """Sign-in with Google — does NOT create accounts. A patient only gets in this way
    if their Google account's email already matches a portal account a Branch Admin
    created for them; this keeps the "who can log in" decision where it already lives
    (treatment_fee_paid + Branch Admin action), same as the email/password path."""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google Sign-In is not configured for this clinic yet")
    try:
        claims = google_id_token.verify_oauth2_token(payload.credential, _google_request, GOOGLE_CLIENT_ID)
    except ValueError:
        raise HTTPException(status_code=401, detail="Could not verify Google sign-in")

    if not claims.get("email_verified"):
        raise HTTPException(status_code=401, detail="Google account email is not verified")

    email = claims["email"].strip().lower()
    account = await v3_col("patient_portal_accounts").find_one({"email": email}, {"_id": 0})
    if not account:
        raise HTTPException(
            status_code=404,
            detail="No portal account found for this Google account. Ask your clinic to share your portal login.",
        )
    return await _start_portal_session(account)


async def _current_patient_lead_id(authorization: str = Header(...)) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization.split(" ", 1)[1].strip()
    session = await v3_col("patient_portal_sessions").find_one({"token": token}, {"_id": 0, "lead_id": 1})
    if not session:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    return session["lead_id"]


@router.post("/patient-portal/logout")
async def patient_portal_logout(authorization: str = Header(...)):
    if not authorization.startswith("Bearer "):
        return {"message": "Logged out"}
    token = authorization.split(" ", 1)[1].strip()
    await v3_col("patient_portal_sessions").delete_one({"token": token})
    return {"message": "Logged out"}


async def _diet_chart_for_patient(lead: dict) -> dict:
    """What the Client Portal may say about this patient's Diet Chart.

    The one rule, in one place: the chart is shown once the Diet Chart Fee is collected and
    not before. The coach can prepare and send it whenever their work reaches them — it sits
    here complete and invisible until the desk takes the money.

    Read live off the lead every time it is asked, never off a flag written when the chart
    was sent. A "shared" flag set at send time would be a copy of a payment state that can
    still change, and the first refund or corrected collection would leave a patient reading
    a chart they had not paid for with nothing in the system saying why.

    Unpaid, the patient is told a chart is waiting rather than told nothing. Silence would
    have them ringing the branch to ask whether the Nutritionist had forgotten them, when
    the actual answer is a fee at the desk. Nothing identifying the chart goes out with that
    — no document id, no filename — because the id is the key to the download route.
    """
    paid = lead.get("diet_chart_fee_paid") is not None
    doc = await v3_col("lead_documents").find_one(
        {"lead_id": lead["id"], "kind": DIET_CHART}, {"_id": 0}, sort=[("created_at", -1)]
    )
    if not doc:
        return {"available": False, "awaiting_payment": False}
    if not paid:
        return {"available": False, "awaiting_payment": True}
    return {
        "available": True,
        "awaiting_payment": False,
        "document_id": doc.get("id"),
        "original_name": doc.get("original_name"),
        "content_type": doc.get("content_type"),
        "size_bytes": doc.get("size_bytes"),
        "sent_at": lead.get("diet_chart_sent_at") or doc.get("created_at"),
        "sent_by": lead.get("diet_chart_sent_by") or doc.get("uploaded_by"),
    }


async def _build_portal_payload(lead: dict) -> dict:
    """Everything all four Client Portal tabs (Sessions / Treatment / Payment History /
    Profile) render from — shared by the patient's own `/patient-portal/me` and staff's
    `/leads/{lead_id}/portal-preview`, so a Super Admin looking at a patient's Operations
    board sees exactly what that patient sees, not a second hand-maintained copy of it."""
    lead_id = lead["id"]

    # `sessions` is physio treatment days only — diet check-ins live in their own
    # collection, so nothing here can miscount one as the other.
    sessions = await v3_col("sessions").find({"lead_id": lead_id}, {"_id": 0}).sort("slot_time", 1).to_list(500)
    assessments = await v3_col("weekly_assessments").find({"lead_id": lead_id}, {"_id": 0}).sort("week_number", 1).to_list(100)
    reviews = await v3_col("reviews").find({"lead_id": lead_id}, {"_id": 0}).sort("raised_at", 1).to_list(50)
    review_numbers = review_numbers_for_lead(reviews)
    diet_days = await v3_col("diet_sessions").find({"lead_id": lead_id}, {"_id": 0}).sort("slot_time", 1).to_list(200)
    # The video room each of these is held in, joined on at read rather than copied onto
    # every row when the days were booked.
    #
    # Read live on purpose, which is the opposite of what a consultation does. A
    # consultation freezes the link onto the appointment because the patient was sent a
    # confirmation naming it, and moving a meeting somebody has already been told about is
    # not something a later edit should be able to do. Nothing is sent for these: the
    # patient reads this page, so the room it shows should be the room the expert is in
    # today. An online physio changing their room otherwise leaves thirty booked days
    # pointing at a room nobody will be in.
    #
    # Blank for a branch's own physio, who has no room recorded because the field is only
    # offered to the online arms — which is exactly right. Their patient comes to the
    # branch, and a join link on that day would be an invitation to somewhere nobody is.
    expert_ids = {s.get("physio_id") for s in sessions if s.get("physio_id")}
    expert_ids |= {d.get("coach_id") for d in diet_days if d.get("coach_id")}
    meet_by_expert: Dict[str, str] = {}
    if expert_ids:
        async for d in v3_col("doctors").find(
            {"id": {"$in": list(expert_ids)}}, {"_id": 0, "id": 1, "meet_link": 1},
        ):
            link = str(d.get("meet_link") or "").strip()
            if link:
                meet_by_expert[d["id"]] = link
    for s in sessions:
        s["meet_link"] = meet_by_expert.get(s.get("physio_id"), "")
    for d in diet_days:
        d["meet_link"] = meet_by_expert.get(d.get("coach_id"), "")
    # The coach on the lead rather than on a day, because the diet card shows one
    # appointment rather than a list — and the days above may not exist yet when the first
    # one is booked from the consultation.
    diet_meet_link = ""
    if lead.get("diet_coach_id"):
        coach_row = await v3_col("doctors").find_one(
            {"id": lead["diet_coach_id"]}, {"_id": 0, "meet_link": 1},
        )
        diet_meet_link = str((coach_row or {}).get("meet_link") or "").strip()

    total = len(sessions)
    completed = len([s for s in sessions if s.get("status") == "completed"])

    branch = {}
    if lead.get("branch_id"):
        branch = await v3_col("branches").find_one(
            {"id": lead["branch_id"]}, {"_id": 0, "branch_name": 1, "phone": 1, "address": 1}
        ) or {}

    # Every Treatment Fee installment collected so far, split into what's actually
    # been paid vs the next thing due — same math the Physio's own Payment History
    # tab and Branch Admin's Outstanding Amount board use.
    installments = (lead.get("treatment_fee_payment_details") or {}).get("installments") or []
    is_partial = lead.get("treatment_fee_payment_mode") == "partial"
    treatment_paid = (
        sum(i.get("amount", 0) for i in installments if i.get("paid")) if is_partial
        else (lead.get("treatment_fee_paid") or 0)
    )
    unpaid = sorted((i for i in installments if not i.get("paid")), key=lambda i: i.get("due_date", "")) if is_partial else []
    next_due = unpaid[0] if unpaid else None

    return {
        "patient_name": lead.get("name", "Unknown"),
        "phone": lead.get("phone", ""),
        "email": lead.get("email", ""),
        "patient_number": lead.get("patient_number"),
        "age": lead.get("age"),
        "gender": lead.get("gender"),
        "occupation": lead.get("occupation"),
        "address": lead.get("address"),
        "city": lead.get("city"),
        "state": lead.get("state"),
        "condition": lead.get("condition"),

        # Doctor detail card — physio_name from the session docs (same source the
        # Physio board itself uses); head_physio_name is informational only, no
        # contact info is ever included anywhere in this response on purpose.
        "physio_name": next((s.get("physio_name") for s in sessions if s.get("physio_name")), ""),
        "head_physio_name": next((s.get("head_physio_name") for s in sessions if s.get("head_physio_name")), ""),

        "branch_name": branch.get("branch_name", ""),
        "branch_phone": branch.get("phone", ""),
        "branch_address": branch.get("address", ""),

        "total_sessions": total,
        "completed_sessions": completed,
        "remaining_sessions": total - completed,
        "sessions": [
            {
                "session_number": s.get("session_number"),
                "week_number": s.get("week_number"),
                "slot_time": s.get("slot_time"),
                "status": s.get("status"),
                "jr_physio_remarks": s.get("jr_physio_remarks"),
                "rehab_remarks": s.get("rehab_remarks"),
            }
            for s in sessions
        ],
        "weekly_assessments": [
            {"week_number": a.get("week_number"), "jr_physio_notes": a.get("jr_physio_notes"), "status": a.get("status")}
            for a in assessments
        ],

        "diagnosis": lead.get("diagnosis"),
        "physio_diagnosis_report": lead.get("physio_diagnosis_report"),
        "treatment_summary": lead.get("treatment_summary"),
        "session_package_name": lead.get("session_package_name"),
        "session_package_sessions": lead.get("session_package_sessions"),

        # Numbered by the same rule the Physio board uses, so a patient reading their own
        # reviews and the physio reading theirs are looking at the same week numbers. The
        # arithmetic that was here divided the closing review down onto the week before it,
        # and, having no floor of 1, numbered a course shorter than a week "review 0".
        "reviews": [
            {
                "review_number": review_numbers.get(r.get("id"), 1),
                "status": r.get("status"),
                "review_date": r.get("review_date"),
                "head_physio_suggestions": r.get("head_physio_suggestions"),
            }
            for r in reviews
        ],

        # The diet side of the patient's care. Absent entirely until now, so a patient on a
        # diet plan had no sign of it here and — worse — no sign of the fee they paid for
        # it. Returned as its own block rather than folded into the physio numbers: they
        # are separate courses of care with separate clinicians.
        "diet": {
            "coach_name": lead.get("diet_coach_name"),
            "appointment_at": lead.get("diet_appointment_at"),
            # Where to join, for a check-in held over video. Empty for a coach seen at the
            # branch, which is every coach but an online arm's.
            "meet_link": diet_meet_link,
            "stage": lead.get("diet_stage"),
            # The coach's written plan — the diet counterpart of the physio's Diagnosis
            # Report, and the thing the patient is actually meant to follow.
            "consultation_report": lead.get("diet_consultation_report"),
            "consultation_report_at": lead.get("diet_consultation_report_at"),
            "consultation_report_by": lead.get("diet_consultation_report_by"),
            # The Diet Chart, and only if it has been paid for. See
            # _diet_chart_for_patient — the fee is read at the moment this is asked, so the
            # portal can never show a chart the money has not been taken for.
            #
            # Separate from consultation_report above, which is not gated and should not be:
            # that is the coach's write-up of an appointment the patient already paid to
            # attend. The chart is a product they buy on its own.
            "chart": await _diet_chart_for_patient(lead),
            "total_checkins": len(diet_days),
            "completed_checkins": len([d for d in diet_days if d.get("status") == "completed"]),
            "checkins": [
                {
                    "day_number": d.get("day_number"),
                    "slot_time": d.get("slot_time"),
                    "status": d.get("status"),
                    "coach_remarks": d.get("coach_remarks"),
                    "weight_kg": d.get("weight_kg"),
                }
                for d in diet_days
            ],
        },

        "payment": {
            "consultation_fee_total": lead.get("package_price"),
            "consultation_fee_paid": lead.get("package_paid"),
            "consultation_payment_mode": lead.get("package_payment_mode"),
            "treatment_fee_total": lead.get("session_package_price"),
            "treatment_fee_paid": treatment_paid,
            "treatment_payment_mode": lead.get("treatment_fee_payment_mode"),
            "is_partial": is_partial,
            "installments_total": len(installments),
            "installments_paid": len([i for i in installments if i.get("paid")]),
            "next_due_amount": next_due.get("amount") if next_due else None,
            "next_due_date": next_due.get("due_date") if next_due else None,
            # The third fee. Left out, the portal's own Total was short by whatever the
            # patient paid for their diet consultation — a wrong number on the one screen
            # where the patient checks what they have been charged.
            "diet_package_name": lead.get("diet_package_name"),
            "diet_fee_total": lead.get("diet_package_price"),
            "diet_fee_paid": lead.get("diet_fee_paid"),
            "diet_payment_mode": lead.get("diet_fee_payment_mode"),
            # The fourth fee, and its own line rather than a sum into the diet one above. A
            # patient sold both a consultation and a chart would otherwise see a single
            # figure they cannot reconcile against either receipt, on the one screen whose
            # whole job is telling them what they have been charged for.
            "diet_chart_package_name": lead.get("diet_chart_package_name"),
            "diet_chart_fee_total": lead.get("diet_chart_package_price"),
            "diet_chart_fee_paid": lead.get("diet_chart_fee_paid"),
            "diet_chart_payment_mode": lead.get("diet_chart_fee_payment_mode"),
        },
    }


@router.get("/patient-portal/me")
async def patient_portal_me(lead_id: str = Depends(_current_patient_lead_id)):
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Patient not found")
    return await _build_portal_payload(lead)


class V3PatientFeedbackIn(BaseModel):
    rating: Optional[int] = None
    message: Optional[str] = ""
    # Who it is for: the branch that runs their care, or Super Admin. Anything unrecognised
    # reads as the branch, which is where a patient who was not asked would have sent it.
    audience: Optional[str] = None


@router.post("/patient-portal/feedback")
async def patient_portal_feedback(
    payload: V3PatientFeedbackIn,
    lead_id: str = Depends(_current_patient_lead_id),
):
    """What a patient thought, in their own words, from their own session.

    Written here rather than in the feedback router because this is the one place that
    knows which patient is asking -- the portal session is the identity, and taking a lead
    id from the body would let anybody file feedback as anybody.

    The patient and their branch are copied onto the row rather than looked up when the
    branch reads it. Feedback is a thing somebody said on a day: it should still name who
    said it after they have been moved to another branch, or after the lead behind it is
    gone.

    Refused when there is nothing to say. A rating with no words is a fine piece of
    feedback and is allowed; an empty form is a misclick.
    """
    message = (payload.message or "").strip()[:MAX_MESSAGE]
    rating = _rating(payload.rating)
    audience = _audience(payload.audience)
    # The words are the whole of it now: the portal stopped asking for a rating, because a
    # star out of five says something happened without saying what and a branch cannot act on
    # four stars. The field is still read for anything sent by an older app, and a row that
    # carries one keeps it.
    if not message:
        raise HTTPException(status_code=400, detail="Tell us how it went")

    lead = await _lead_or_404(lead_id)
    row = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "branch_id": lead.get("branch_id"),
        "patient_name": (lead.get("name") or "").strip(),
        "patient_phone": (lead.get("phone") or "").strip(),
        "rating": rating,
        "message": message,
        "audience": audience,
        "status": STATUS_NEW,
        "note": "",
        "created_at": now_iso(),
    }
    # The first line of the conversation, not a field beside it. `message` stays written
    # as well: it is what every existing reader of this collection looks for, and the
    # thread is the same words rather than a second copy of a different truth.
    row["messages"] = [{
        "id": str(uuid.uuid4()),
        "author": AUTHOR_PATIENT,
        "author_name": row["patient_name"],
        "body": message,
        "created_at": row["created_at"],
    }]
    await v3_col("patient_feedback").insert_one(dict(row))
    # Says who has it, because the patient chose. "Your branch has it" over a complaint the
    # patient deliberately sent past the branch would be the one thing they were avoiding.
    return {
        "message": "Thank you — Super Admin has it." if audience == AUDIENCE_SUPER else "Thank you — your branch has it.",
        "feedback": row,
    }


@router.get("/patient-portal/feedback")
async def patient_portal_my_feedback(lead_id: str = Depends(_current_patient_lead_id)):
    """What this patient has sent, and what has become of it.

    A patient who says something and hears nothing back assumes it went nowhere, and sends
    it again or stops sending. Showing the state of each one -- waiting, being looked at,
    finished -- is the smallest honest answer: it does not promise a reply, it says
    somebody has it.

    The reply comes back with it -- what the branch said when they closed it, which they
    wrote knowing the patient would read it. The note does not: that is the branch's working
    record of what they did, written to be read by colleagues, and putting it in front of
    the person it is about would change what gets written there.
    """
    rows = await v3_col("patient_feedback").find(
        {"lead_id": lead_id},
        {"_id": 0, "id": 1, "rating": 1, "message": 1, "status": 1, "created_at": 1,
         "audience": 1, "reply": 1, "replied_at": 1, "replied_by": 1, "patient_name": 1,
         "messages": 1},
    ).sort("created_at", -1).to_list(200)
    for row in rows:
        row["messages"] = _thread(row)
        # Whether the last word was theirs, so the portal can show which of these is
        # waiting on the clinic and which is waiting on them.
        last = row["messages"][-1] if row["messages"] else None
        row["awaiting_clinic"] = bool(last and last.get("author") == AUTHOR_PATIENT)
    return {"feedback": rows}


class PortalFeedbackReplyIn(BaseModel):
    body: Optional[str] = ""
    # Answering the clinic's "did that settle it?". True closes the thread, False sends it
    # back to them. Left unset for an ordinary message that answers nothing.
    resolved: Optional[bool] = None


@router.post("/patient-portal/feedback/{feedback_id}/message")
async def patient_portal_feedback_reply(
    feedback_id: str,
    payload: PortalFeedbackReplyIn,
    lead_id: str = Depends(_current_patient_lead_id),
):
    """The patient's next word on their own thread.

    Their session is the identity here, as everywhere else in this router, and the thread
    has to be theirs — a feedback id from the body would otherwise let anybody write into
    anybody's conversation.

    `resolved` is the answer to being asked whether it was settled, and it is the only
    thing that closes a thread. The branch can say what it did and ask; whether that was
    enough is not theirs to decide, and a complaint marked dealt with by the person
    complained about is how somebody learns not to bother saying anything.

    Saying "not yet" hands it straight back rather than leaving it closed-with-a-caveat:
    In Progress is a column somebody works through, and Awaiting is one that waits.
    """
    row = await v3_col("patient_feedback").find_one(
        {"id": feedback_id, "lead_id": lead_id}, {"_id": 0}
    )
    if not row:
        raise HTTPException(status_code=404, detail="No such feedback")

    body = (payload.body or "").strip()[:MAX_MESSAGE]
    if payload.resolved is None and not body:
        raise HTTPException(status_code=400, detail="Write something to send")

    now = now_iso()
    thread = _thread(row)
    if body:
        thread = [*thread, {
            "id": str(uuid.uuid4()),
            "author": AUTHOR_PATIENT,
            "author_name": row.get("patient_name") or "",
            "body": body,
            "created_at": now,
        }]

    changes = {"messages": thread}
    if payload.resolved is True:
        changes.update({"status": STATUS_RESOLVED, "resolved_by_patient_at": now})
    elif payload.resolved is False:
        changes["status"] = STATUS_IN_PROGRESS
    elif row.get("status") == STATUS_RESOLVED:
        # Writing again on something closed opens it back up. The alternative is a message
        # nobody is looking at, in a column nobody works through.
        changes["status"] = STATUS_IN_PROGRESS

    await v3_col("patient_feedback").update_one({"id": feedback_id}, {"$set": changes})
    return {**row, **changes}


# --------------------------------------------------------------- Staff: preview a patient's
# --------------------------------------------------------------- own portal, without logging
# --------------------------------------------------------------- in as them

@router.get("/leads/{lead_id}/portal-preview")
async def staff_view_patient_portal(lead_id: str, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Operations' Client tab reaching a patient's own board the same way it already
    reaches a Physio's or Pre Sales rep's — no separate portal login needed, and (unlike
    the patient's own session) no password or account is involved at all."""
    lead = await _lead_or_404(lead_id)
    if is_branch_admin_role(user.role) and lead.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=404, detail="Patient not found")
    return await _build_portal_payload(lead)


# ------------------------------------------------------------------ Patient: own documents

@router.get("/patient-portal/documents")
async def patient_portal_documents(lead_id: str = Depends(_current_patient_lead_id)):
    """The patient's own documents, and only the ones the branch has shared.

    `lead_id` comes from the session token and is never accepted from the caller — the
    staff route takes it in the path, which is right there because staff legitimately read
    across patients, and would be a way to read anyone's file here.
    """
    docs = await v3_col("lead_documents").find(
        {"lead_id": lead_id}, {"_id": 0, "stored_name": 0}
    ).sort("created_at", -1).to_list(500)
    return {
        "documents": [
            {
                "id": d.get("id"),
                "label": d.get("label"),
                "original_name": d.get("original_name"),
                "kind": d.get("kind"),
                "content_type": d.get("content_type"),
                "size_bytes": d.get("size_bytes"),
                "created_at": d.get("created_at"),
            }
            for d in docs if is_shared_with_patient(d)
        ]
    }


@router.get("/patient-portal/diet-chart")
async def patient_portal_download_diet_chart(lead_id: str = Depends(_current_patient_lead_id)):
    """The Diet Chart's bytes, for the patient who paid for it.

    Its own route rather than a document id handed to the generic download above, and that
    is the point: the generic route decides by is_shared_with_patient, which is a flag on a
    row and cannot see what has been paid. This one re-reads the fee off the lead and
    refuses without it, so the gate holds on the bytes and not only on the screen that links
    to them.

    Takes no parameters at all. `lead_id` comes from the session token, and which chart is
    "the" chart is decided here rather than by the caller — there is nothing to pass, and so
    nothing to pass that belongs to somebody else.

    The same 404 whether the fee is unpaid or no chart exists. Which of the two it is tells
    a patient something about their own file that the portal has already said properly in
    the diet block; repeating it here as the difference between two error codes is just a
    way to probe.
    """
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead or lead.get("diet_chart_fee_paid") is None:
        raise HTTPException(status_code=404, detail="No Diet Chart is available yet")
    doc = await v3_col("lead_documents").find_one(
        {"lead_id": lead_id, "kind": DIET_CHART}, {"_id": 0}, sort=[("created_at", -1)]
    )
    if not doc:
        raise HTTPException(status_code=404, detail="No Diet Chart is available yet")
    path = os.path.join(DOC_DIR, doc["stored_name"])
    if os.path.dirname(os.path.abspath(path)) != os.path.abspath(DOC_DIR) or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File is missing from storage")
    return FileResponse(path, media_type=doc.get("content_type"), filename=doc.get("original_name"))


@router.get("/patient-portal/documents/{doc_id}/download")
async def patient_portal_download_document(
    doc_id: str, lead_id: str = Depends(_current_patient_lead_id)
):
    """The bytes, for one of this patient's own shared documents.

    Three things have to hold, and each is checked rather than assumed: the document
    belongs to the lead this session is for, the branch has shared it, and the resolved
    path is still inside the documents folder. A document id on its own is not a key.
    """
    doc = await v3_col("lead_documents").find_one({"id": doc_id, "lead_id": lead_id}, {"_id": 0})
    if not doc or not is_shared_with_patient(doc):
        # The same 404 either way: "exists but is not shared with you" is itself something
        # a patient does not need told.
        raise HTTPException(status_code=404, detail="Document not found")
    path = os.path.join(DOC_DIR, doc["stored_name"])
    if os.path.dirname(os.path.abspath(path)) != os.path.abspath(DOC_DIR) or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File is missing from storage")
    return FileResponse(path, media_type=doc.get("content_type"), filename=doc.get("original_name"))
