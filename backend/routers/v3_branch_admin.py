from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import Dict, Optional
from datetime import date, datetime, timedelta
from calendar import monthrange
import logging
import uuid

from database import v3_col
from utils import now_iso
from deps import v3_require_roles
import lead_control
from constants import V3_BRANCH_STAGES, V3_CONSULTATION_STAGES, V3_HEAD_CONSULTATION_STAGES
from stage_utils import branch_stage_names_for_branch
from schemas.v3 import (
    V3UserOut, V3LeadOut,
    V3BranchStageInput, V3CollectFeeInput, V3AssignPhysioInput, V3ConsultationStageInput,
    V3PortfolioScheduleInput,
)

router = APIRouter(prefix="/api/v3")


async def _branch_stage_names(branch_id: Optional[str] = None) -> list:
    """Live Branch Stages as configured in Super Admin > Pipeline Stage Management,
    falling back to the built-in defaults if none have been configured yet.

    Scoped to one branch when given: the opening stages differ by Lead Control, so a branch
    running its own leads gets Branch Assign + RNR where a Pre-Sales-fed one gets New
    Appointment. Passing no branch returns every mode's stages, which is what callers
    validating across the whole org (rather than against one board) want.
    """
    if branch_id:
        return await branch_stage_names_for_branch(branch_id, V3_BRANCH_STAGES)
    rows = await v3_col("pipeline_stages").find({"type": "sales"}, {"_id": 0, "name": 1}).sort("order", 1).to_list(200)
    names = [r["name"] for r in rows]
    return names or V3_BRANCH_STAGES


async def _branch_stages(branch_id: str) -> list:
    """Full stage documents for one branch's board — the client needs colours and order,
    not just names, and must not be handed the other Lead Control mode's stages."""
    control = await lead_control.branch_lead_control(branch_id)
    rows = await v3_col("pipeline_stages").find({"type": "sales"}, {"_id": 0}).sort("order", 1).to_list(200)
    return [r for r in rows if not r.get("applies_to") or r.get("applies_to") == control]


async def _consultation_stage_names() -> list:
    """Live Consultation Stages as configured in Super Admin > Pipeline Stage Management,
    falling back to the built-in defaults if none have been configured yet."""
    rows = await v3_col("pipeline_stages").find({"type": "consultation"}, {"_id": 0, "name": 1}).sort("order", 1).to_list(200)
    names = [r["name"] for r in rows]
    return names or V3_CONSULTATION_STAGES


async def _head_consultation_stage_names() -> list:
    """Live Head Consultation Stages as configured in Super Admin > Pipeline Stage Management,
    falling back to the built-in defaults if none have been configured yet."""
    rows = await v3_col("pipeline_stages").find({"type": "head_consultation"}, {"_id": 0, "name": 1}).sort("order", 1).to_list(200)
    names = [r["name"] for r in rows]
    return names or V3_HEAD_CONSULTATION_STAGES


# ---------------------------------------------- Public appointment confirmation page

LOGO_URL = ("https://customer-assets.emergentagent.com/job_3d74aa9e-a241-4207-b148-2bbe29802707"
            "/artifacts/nozl77ti_Logo%20Icon.webp")


def _esc(s) -> str:
    return (str(s if s is not None else "")
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&#39;"))


def _to12h(t: str) -> str:
    """'14:05' -> '2:05 PM'. Left as-is if it isn't a real HH:MM."""
    try:
        h, m = (t or "").split(":")[:2]
        h, m = int(h), int(m)
    except (ValueError, TypeError):
        return t or "—"
    suffix = "AM" if h < 12 else "PM"
    hour = h % 12 or 12
    return f"{hour}:{m:02d} {suffix}"


def _end12h(t: str, minutes: int) -> str:
    try:
        h, m = (t or "").split(":")[:2]
        total = int(h) * 60 + int(m) + int(minutes or 0)
    except (ValueError, TypeError):
        return "—"
    return _to12h(f"{(total // 60) % 24:02d}:{total % 60:02d}")


def _weekday_label(d: str) -> str:
    """"Friday, July 17, 2026" — the same wording the card image uses, so the page the
    link opens reads as the note the patient was already sent."""
    try:
        dt = date.fromisoformat(d)
    except (ValueError, TypeError):
        return d or "—"
    # Built by hand rather than with %-d/%#d, neither of which is portable across the
    # dev (Windows) and deploy (Linux) platforms.
    return f"{dt.strftime('%A, %B')} {dt.day}, {dt.year}"


_PAGE_CSS = """
*{box-sizing:border-box}
body{margin:0;padding:24px 12px;background:#f1f5f9;color:#0f172a;
     font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif}
.wrap{max-width:480px;margin:0 auto}
.card{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(15,23,42,.10)}
.head{display:flex;align-items:center;gap:12px;padding:16px 20px;background:#0d9488;color:#fff}
.head.cancelled{background:#e11d48}
.logo{width:44px;height:44px;flex:none;border-radius:10px;background:rgba(255,255,255,.9);object-fit:contain;padding:4px}
.h-title{font-size:18px;font-weight:700}
.h-ref{font-size:12px;opacity:.85;margin-top:2px}
.body{padding:20px}
.hero{border:2px solid #99f6e4;background:#f0fdfa;border-radius:12px;padding:18px;text-align:center}
.hero.cancelled{border-color:#fecdd3;background:#fff1f2}
.hero-label{font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#0d9488}
.hero.cancelled .hero-label{color:#e11d48}
.hero-date{font-size:24px;font-weight:800;color:#0f766e;margin-top:4px}
.hero-time{font-size:18px;font-weight:700;color:#0f766e}
.hero-with{font-size:14px;font-weight:600;color:#0d9488;margin-top:4px}
.hero.cancelled .hero-date,.hero.cancelled .hero-time,.hero.cancelled .hero-with{color:#be123c}
.banner{margin-top:14px;border:1px solid #fecdd3;background:#fff1f2;border-radius:8px;
        padding:10px 12px;font-size:12px;font-weight:600;color:#be123c}
.greet{margin-top:18px;font-size:17px;font-weight:700;color:#0f172a}
.say{margin-top:10px;border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:12px 14px}
.say p{margin:0;font-size:14px;line-height:1.7;color:#475569}
.sign{margin-top:8px;text-align:right;font-size:13px;font-weight:700;color:#0d9488}
.map{display:inline-block;margin-top:10px;padding:8px 14px;border-radius:8px;background:#0d9488;
     color:#fff;font-size:13px;font-weight:600;text-decoration:none}
table{width:100%;border-collapse:collapse;margin-top:18px;font-size:14px}
td{padding:9px 0;border-bottom:1px solid #f1f5f9;vertical-align:top}
td.k{color:#64748b}
td.v{text-align:right;font-weight:600;color:#1e293b}
tr:last-child td{border-bottom:0}
.box{margin-top:14px;border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:12px}
.box-label{font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#94a3b8}
.box p{margin:4px 0 0;font-size:13px;color:#475569;line-height:1.6;white-space:pre-wrap}
.note{margin-top:14px;border:1px solid #ccfbf1;background:rgba(240,253,250,.7);border-radius:8px;
      padding:12px;font-size:12px;line-height:1.7;color:#115e59}
.note p{margin:0}
.foot{margin-top:16px;text-align:center;font-size:12px;color:#94a3b8}
@media print{body{background:#fff;padding:0}.card{box-shadow:none}}
"""


def _appt_missing_html() -> str:
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Appointment not found — FITSIOMAX</title><style>{_PAGE_CSS}</style></head>
<body><div class="wrap"><div class="card">
<div class="head"><img class="logo" src="{LOGO_URL}" alt="FITSIOMAX"><div class="h-title">FITSIOMAX</div></div>
<div class="body"><p style="text-align:center;color:#64748b;font-size:14px;padding:24px 0">
This appointment link is not valid.<br>Please contact the branch for help.</p></div>
</div></div></body></html>"""


REASSURANCE = ("We understand the pain you are going through. Don't worry — our team is "
               "here to consult with you and see you through it.")


def _appt_card_html(a: dict) -> str:
    """The confirmation as a standalone page. Kept in step with the card image the branch
    sends (frontend/src/lib/apptCard.js) so the link opens to the same note the patient
    already has in their chat — a greeting, the day, the place, and the line telling them
    they are in hand, rather than a dump of every field on the record.

    The og:* tags are what WhatsApp, Signal and the rest read to draw their preview card
    above the message — without them a shared link is just a bare URL."""
    cancelled = bool(a["cancelled"])
    when = f"{_to12h(a['time'])} to {_end12h(a['time'], a['duration'])}"
    title = ("Appointment Cancelled" if cancelled else "Appointment Confirmed")
    og_desc = f"{_weekday_label(a['date'])} · {when}"
    if a["branch"]:
        og_desc += f" at {a['branch']}"

    rows = [("Head Physio", a["head_physio"])]
    if a["ref_no"]:
        rows.append(("Reference", a["ref_no"]))
    rows_html = "".join(
        f'<tr><td class="k">{_esc(k)}</td><td class="v">{_esc(v)}</td></tr>' for k, v in rows
    )

    # The map link is a plain anchor rather than an embed: an iframe would need a keyed
    # Maps API and would be blocked in the in-app browsers this page mostly opens in.
    map_html = ""
    if a["map_location"]:
        map_html = (f'<a class="map" href="{_esc(a["map_location"])}" target="_blank" '
                    f'rel="noopener noreferrer">Open in Maps</a>')

    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{_esc(title)} — FITSIOMAX</title>
<meta name="theme-color" content="{'#e11d48' if cancelled else '#0d9488'}">
<meta name="description" content="{_esc(og_desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="FITSIOMAX">
<meta property="og:title" content="{_esc(title)} — {_esc(a['patient'])}">
<meta property="og:description" content="{_esc(og_desc)}">
<meta property="og:image" content="{LOGO_URL}">
<meta name="twitter:card" content="summary">
<meta name="robots" content="noindex,nofollow">
<style>{_PAGE_CSS}</style></head>
<body><div class="wrap"><div class="card">
  <div class="head{' cancelled' if cancelled else ''}">
    <img class="logo" src="{LOGO_URL}" alt="FITSIOMAX">
    <div><div class="h-title">{_esc(title)}</div>
    <div class="h-ref">FITSIOMAX · Physiotherapy &amp; Rehabilitation</div></div>
  </div>
  <div class="body">
    <div class="hero{' cancelled' if cancelled else ''}">
      <div class="hero-label">Your Appointment</div>
      <div class="hero-date">{_esc(_weekday_label(a['date']))}</div>
      <div class="hero-time">{_esc(when)}</div>
      {f'<div class="hero-with">at {_esc(a["branch"])}</div>' if a["branch"] else ''}
    </div>
    <div class="greet">Hi {_esc(a['patient'])},</div>
    {'<div class="banner">This appointment has been cancelled. Please contact the branch to book another.</div>'
     if cancelled else
     f'<div class="say"><p>{_esc(REASSURANCE)}</p><div class="sign">— Team Fitsiomax</div></div>'}
    <table>{rows_html}</table>
    {f'<div class="box"><div class="box-label">Notes</div><p>{_esc(a["notes"])}</p></div>' if a["notes"] else ''}
    {f'<div class="box"><div class="box-label">Location</div><p>{_esc(a["branch_address"])}</p>{map_html}</div>'
     if (a["branch_address"] or map_html) else ''}
    {'' if cancelled else '<div class="note"><p>Please arrive 10 minutes early.</p></div>'}
  </div>
</div>
<p class="foot">FITSIOMAX · Physiotherapy &amp; Rehabilitation</p>
</div></body></html>"""


@router.get("/public/appointment/{share_token}", response_class=HTMLResponse)
async def v3_public_appointment(share_token: str):
    """The appointment confirmation behind its share link — what the patient opens.

    Server-rendered rather than a route in the SPA, for two reasons: WhatsApp and every
    other chat app fetch a shared link with a crawler that does not run JavaScript, so
    only real HTML gets the preview card; and the patient opening it on a phone gets the
    confirmation immediately instead of downloading an app bundle first.

    Deliberately unauthenticated: the patient has no login. The token is the only key, so
    it must stay unguessable (a CSPRNG value minted at booking), and only the fields
    already printed on the confirmation they were sent are rendered — holding a link
    reveals nothing further about the lead.
    """
    appt = await v3_col("appointments").find_one({"share_token": share_token}, {"_id": 0})
    if not appt:
        return HTMLResponse(_appt_missing_html(), status_code=404)

    lead = await v3_col("leads").find_one(
        {"id": appt.get("lead_id")}, {"_id": 0, "branch_id": 1}
    ) or {}
    branch = await v3_col("branches").find_one(
        {"id": appt.get("branch_id") or lead.get("branch_id")},
        {"_id": 0, "branch_name": 1, "address": 1, "map_location": 1},
    ) or {}

    return HTMLResponse(_appt_card_html({
        "ref_no": appt.get("ref_no") or "",
        "patient": appt.get("patient_name") or appt.get("lead_name") or "—",
        "date": appt.get("appointment_date") or "",
        "time": appt.get("appointment_time") or "",
        "duration": appt.get("duration") or 30,
        "head_physio": appt.get("doctor_name") or "—",
        "branch": branch.get("branch_name") or "",
        "branch_address": branch.get("address") or "",
        "map_location": branch.get("map_location") or "",
        "notes": appt.get("notes") or "",
        # A cancelled booking keeps its link working, but says so rather than showing a
        # confirmation for an appointment that is no longer happening.
        "cancelled": appt.get("status") == "cancelled",
    }))


@router.get("/branch-board/{branch_id}")
async def v3_branch_board_new(branch_id: str, _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "business_dev"))):
    try:
        leads = await v3_col("leads").find({"branch_id": branch_id}, {"_id": 0}).sort("updated_at", -1).to_list(20000)
        stage_counts = {}
        branch_stages = await _branch_stages(branch_id)
        for stage in [s["name"] for s in branch_stages]:
            stage_counts[stage] = sum(1 for lead in leads if lead.get("branch_stage") == stage)
        # One malformed lead document shouldn't 500 the whole board — skip it and keep
        # showing every other lead rather than failing the entire list.
        lead_list = []
        for lead in leads:
            try:
                lead_list.append(V3LeadOut(**lead))
            except Exception as e:
                logging.getLogger(__name__).error(f"branch-board: skipping unparseable lead {lead.get('id')}: {e}")
        # The board tells the client which desk owns this branch's leads, so the Pre Sales
        # tab appears and disappears on the same fetch as the leads it works on rather
        # than needing a second round trip to /branches to find out.
        branch = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0, "lead_control": 1})
        return {
            "leads": [lead.model_dump() for lead in lead_list],
            "stage_counts": stage_counts,
            "lead_control": lead_control.normalize((branch or {}).get("lead_control")),
            # Sent with the board rather than fetched separately from /stages, which has no
            # branch to scope by: the stage strip must match the Lead Control on the same
            # response, or a flipped branch briefly renders the other mode's stages.
            "stages": branch_stages,
        }
    except HTTPException:
        raise
    except Exception as e:
        logging.getLogger(__name__).exception("branch-board: failed to load")
        raise HTTPException(status_code=500, detail=f"branch-board error: {type(e).__name__}: {e}")


@router.post("/leads/{lead_id}/branch-stage")
async def v3_move_branch_stage(lead_id: str, payload: V3BranchStageInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    # Validated against this lead's own branch, not the whole sales list: Branch Assign and
    # RNR only exist for a branch running its own leads, and moving a Pre-Sales-fed lead
    # onto one would strand it on a stage its board never draws.
    if payload.branch_stage not in await _branch_stage_names(lead.get("branch_id")):
        raise HTTPException(status_code=400, detail="Invalid branch stage")
    old_stage = lead.get("branch_stage", "Unknown")
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {"branch_stage": payload.branch_stage, "updated_at": now_iso()}})
    activity = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "branch_stage_change",
        "details": f"Branch stage: '{old_stage}' -> '{payload.branch_stage}'",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("lead_activity").insert_one(activity.copy())
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


@router.post("/leads/{lead_id}/schedule-portfolio", response_model=V3LeadOut)
async def v3_schedule_portfolio(lead_id: str, payload: V3PortfolioScheduleInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Move a lead to the 'Portfolio' branch stage with a Date + Time attached."""
    if "Portfolio" not in await _branch_stage_names():
        raise HTTPException(status_code=400, detail="'Portfolio' is not a configured branch stage")
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    old_stage = lead.get("branch_stage", "Unknown")
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "branch_stage": "Portfolio",
        "portfolio_date": payload.portfolio_date,
        "portfolio_time": payload.portfolio_time,
        "portfolio_datetime": f"{payload.portfolio_date}T{payload.portfolio_time}:00",
        "updated_at": now_iso(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "portfolio_scheduled",
        "details": f"Branch stage: '{old_stage}' -> 'Portfolio' · {payload.portfolio_date} at {payload.portfolio_time}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


@router.post("/leads/{lead_id}/collect-fee")
async def v3_collect_fee(lead_id: str, payload: V3CollectFeeInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    updates = {"updated_at": now_iso()}
    if payload.fee_type == "consultation":
        updates["consultation_fee"] = payload.amount
    elif payload.fee_type == "package":
        updates["package_amount"] = payload.amount
        if payload.package_weeks:
            updates["package_weeks"] = payload.package_weeks
    await v3_col("leads").update_one({"id": lead_id}, {"$set": updates})
    activity = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "fee_collected",
        "details": f"{payload.fee_type.title()} fee collected: Rs.{payload.amount}" + (f" ({payload.package_weeks} weeks)" if payload.package_weeks else ""),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("lead_activity").insert_one(activity.copy())
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


@router.post("/leads/{lead_id}/assign-physio")
async def v3_assign_physio(lead_id: str, payload: V3AssignPhysioInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    physio = await v3_col("doctors").find_one({"id": payload.physio_id}, {"_id": 0})
    if not physio:
        raise HTTPException(status_code=404, detail="Physio not found")
    consultation_stage = lead.get("consultation_stage") or (await _consultation_stage_names())[0]
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "assigned_physio_id": payload.physio_id,
        "assigned_physio_name": physio["full_name"],
        "physio_assigned_at": now_iso(),
        "branch_stage": "Appointment Date & Time",
        "consultation_stage": consultation_stage,
        "updated_at": now_iso(),
    }})
    activity = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "physio_assigned",
        "details": f"Jr. Physio assigned: {physio['full_name']}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    }
    await v3_col("lead_activity").insert_one(activity.copy())
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


class V3BranchAppointmentInput(BaseModel):
    appointment_date: str   # YYYY-MM-DD
    appointment_time: str   # HH:MM
    physio_id: str
    notes: Optional[str] = ""
    final_stage: str = "Appointment Date & Time"   # "Appointment Date & Time" or "Cancelled"
    # Length of the picked slot, carried from the expert's published calendar so the
    # Calendar tab can render the real end time (09:30–10:00) rather than assuming 30.
    duration: Optional[int] = None
    # The confirmation the patient is sent: `ref_no` is what's printed on it, and
    # `share_token` is the unguessable id its public link is keyed by. Both are minted
    # by the caller so the link can be built without a second round trip.
    ref_no: Optional[str] = None
    share_token: Optional[str] = None


@router.post("/leads/{lead_id}/schedule-branch-appointment", response_model=V3LeadOut)
async def v3_schedule_branch_appointment(lead_id: str, payload: V3BranchAppointmentInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Schedule appointment date/time, assign physio, add notes, then move to final stage."""
    if payload.final_stage not in ("Appointment Date & Time", "Cancelled"):
        raise HTTPException(status_code=400, detail="final_stage must be 'Appointment Date & Time' or 'Cancelled'")
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    physio = await v3_col("doctors").find_one({"id": payload.physio_id}, {"_id": 0, "full_name": 1, "slot_details": 1})
    if not physio:
        raise HTTPException(status_code=404, detail="Physio not found")

    slot_time = f"{payload.appointment_date}T{payload.appointment_time}"
    # Someone else already holding this exact slot blocks the booking — the slot belongs
    # to whichever client took it. Re-picking the same slot for the SAME lead is fine
    # (that's a reschedule onto itself / a notes edit), so this lead is excluded.
    if payload.final_stage == "Appointment Date & Time":
        clash = await v3_col("appointments").find_one(
            {
                "doctor_id": payload.physio_id,
                "slot_time": slot_time,
                "status": "new_appointment",
                "lead_id": {"$ne": lead_id},
            },
            {"_id": 0, "lead_name": 1},
        )
        if clash:
            raise HTTPException(
                status_code=409,
                detail=f"{payload.appointment_time} is already booked with {physio['full_name']}"
                       + (f" for {clash.get('lead_name')}" if clash.get("lead_name") else ""),
            )

    updates = {
        "appointment_date": payload.appointment_date,
        "appointment_time": payload.appointment_time,
        "appointment_datetime": f"{payload.appointment_date}T{payload.appointment_time}:00",
        "assigned_physio_id": payload.physio_id,
        "assigned_physio_name": physio["full_name"],
        "physio_assigned_at": now_iso(),
        "branch_stage": payload.final_stage,
        "updated_at": now_iso(),
    }
    # When the appointment is booked (not cancelled), hand the lead to BOTH consultation
    # pipelines at once:
    #   - Head Physio's own board -> its first stage ("New Appointment"), where they pick it up
    #   - Branch Admin's own board -> its first stage ("Follow Up"), kept for rescheduling
    # Existing values are never overwritten, so a lead already further along stays put.
    if payload.final_stage == "Appointment Date & Time":
        updates["consultation_stage"] = lead.get("consultation_stage") or (await _consultation_stage_names())[0]
        updates["head_consultation_stage"] = lead.get("head_consultation_stage") or (await _head_consultation_stage_names())[0]
    if payload.notes and payload.notes.strip():
        existing_notes = (lead.get("notes") or "").strip()
        appended = f"[Appt {payload.appointment_date} {payload.appointment_time}] {payload.notes.strip()}"
        updates["notes"] = f"{existing_notes}\n{appended}" if existing_notes else appended
    await v3_col("leads").update_one({"id": lead_id}, {"$set": updates})

    # The lead fields above drive the Branch Leads table; the `appointments` record below
    # is what the Calendar tab renders and what marks the expert's slot as Booked on the
    # Consultant Calendar. Both must be written or the booking is invisible to scheduling.
    existing_appt = await v3_col("appointments").find_one(
        {"lead_id": lead_id, "appt_kind": "consultation", "status": "new_appointment"}, {"_id": 0, "id": 1}
    )
    if payload.final_stage == "Cancelled":
        # Frees the slot again for everyone else.
        await v3_col("appointments").update_many(
            {"lead_id": lead_id, "status": "new_appointment"},
            {"$set": {"status": "cancelled", "updated_at": now_iso()}},
        )
    else:
        duration = payload.duration
        if not duration:
            # Fall back to whatever length the expert published this slot at.
            detail = next(
                (d for d in (physio.get("slot_details") or []) if d.get("slot_time") == slot_time),
                None,
            )
            duration = (detail or {}).get("duration") or 30
        appt_fields = {
            "branch_id": lead.get("branch_id"),
            "doctor_id": payload.physio_id,
            "doctor_name": physio["full_name"],
            "lead_id": lead_id,
            "lead_name": lead.get("name"),
            "patient_name": lead.get("name"),
            "appointment_date": payload.appointment_date,
            "appointment_time": payload.appointment_time,
            "slot_time": slot_time,
            "duration": duration,
            "notes": (payload.notes or "").strip(),
            "status": "new_appointment",
            "appt_kind": "consultation",
            "created_by": user.full_name,
            "created_by_role": user.role,
            "updated_at": now_iso(),
        }
        if payload.ref_no:
            appt_fields["ref_no"] = payload.ref_no
        if payload.share_token:
            appt_fields["share_token"] = payload.share_token
        if existing_appt:
            # Rescheduling an existing booking — move it rather than leaving a stale row
            # holding the old slot.
            await v3_col("appointments").update_one({"id": existing_appt["id"]}, {"$set": appt_fields})
        else:
            await v3_col("appointments").insert_one({**appt_fields, "id": str(uuid.uuid4()), "created_at": now_iso()})

    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "branch_appointment_scheduled",
        "details": f"Appointment {payload.appointment_date} {payload.appointment_time} with {physio['full_name']} → {payload.final_stage}" + (f" · Notes: {payload.notes.strip()}" if payload.notes else ""),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)



@router.get("/branch-admin/available-experts/{branch_id}")
async def v3_available_experts(
    branch_id: str,
    date: str,
    time: Optional[str] = None,
    lead_id: Optional[str] = None,
    _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio")),
):
    """Head Physios at this branch who can take a consultation on the given date
    (optionally narrowed to an exact time).

    Consultations are conducted by Head Physios only — regular Physios run treatment
    sessions, which are booked separately once a package is sold — so this never offers
    a Physio. A Head Physio assigned to several branches has one doctors record per
    branch, so they appear only in the branches they're actually assigned to.
    """
    if not date:
        raise HTTPException(status_code=400, detail="date is required")
    # Head Physios are org-wide: they take consultations for every branch, so this
    # never narrows by branch_id.
    branch_experts = await v3_col("doctors").find({"profile_type": "head_physio"}, {"_id": 0}).to_list(500)

    # Availability is decided per slot, not per day: an expert with a 9:30 booking is
    # still free at 10:00. So a same-day booking no longer hides them — only being
    # genuinely full does (every slot they published for this date is taken). An expert
    # who published nothing stays listed, so the booking popup can say so and point at
    # the Consultant Calendar instead of silently offering no one.
    booked_rows = await v3_col("appointments").find(
        {"status": "new_appointment", "slot_time": {"$regex": f"^{date}T"}},
        {"_id": 0, "doctor_id": 1, "slot_time": 1, "lead_id": 1, "lead_name": 1},
    ).to_list(2000)
    booked_by_doc: Dict[str, set] = {}
    # Who holds each taken slot, so the picker can name them rather than only saying the
    # time is gone. Read off the appointment row, which already carries lead_name — no
    # second lookup against leads.
    booked_names: Dict[tuple, str] = {}
    for r in booked_rows:
        # A slot this same lead already holds isn't "taken" as far as they're concerned —
        # reopening their own booking has to keep offering the slot they're sitting in,
        # otherwise the popup can't show the current appointment or reschedule off it.
        if lead_id and r.get("lead_id") == lead_id:
            continue
        booked_by_doc.setdefault(r.get("doctor_id"), set()).add(r.get("slot_time"))
        if r.get("lead_name"):
            booked_names[(r.get("doctor_id"), r.get("slot_time"))] = r.get("lead_name")

    available = []
    for d in branch_experts:
        published = {s for s in (d.get("slots") or []) if isinstance(s, str) and s.startswith(f"{date}T")}
        taken = booked_by_doc.get(d.get("id"), set())
        free = published - taken
        if time:
            # Caller asked about one exact time — only offer experts free right then.
            if f"{date}T{time}" in taken:
                continue
        elif published and not free:
            continue  # fully booked for the day
        # The free slots themselves, not just how many — the booking popup lists the
        # date's open times first and only then who can take each one, so it needs to
        # know which times each expert actually has open.
        detail_by_slot = {x.get("slot_time"): x for x in (d.get("slot_details") or [])}
        available.append({
            **d,
            "free_slot_count": len(free),
            "published_slot_count": len(published),
            "free_slots": [
                {
                    "slot_time": s,
                    "time": s.split("T")[1],
                    "duration": (detail_by_slot.get(s) or {}).get("duration") or 30,
                }
                for s in sorted(free)
            ],
            # The taken ones too, so the booking popup can show the expert's whole day
            # rather than only the gaps. A grid of four free times says nothing about
            # whether the day is quiet or nearly full, and Branch Admin is choosing a slot
            # for a patient on the phone who wants to know what else is around.
            #
            # `taken` already excludes this lead's own booking, so reopening an existing
            # appointment still shows that slot as free and selectable rather than as a
            # clash with itself.
            "booked_slots": [
                {
                    "slot_time": s,
                    "time": s.split("T")[1],
                    "duration": (detail_by_slot.get(s) or {}).get("duration") or 30,
                    "lead_name": booked_names.get((d.get("id"), s)),
                }
                for s in sorted(taken)
            ],
        })
    return {
        "date": date,
        "time": time,
        "branch_id": branch_id,
        "total_branch_experts": len(branch_experts),
        "available_count": len(available),
        "busy_count": len(branch_experts) - len(available),
        "experts": available,
    }



@router.get("/branch-admin/available-dates/{branch_id}")
async def v3_available_dates(
    branch_id: str,
    month: str = Query(..., description="YYYY-MM"),
    lead_id: Optional[str] = None,
    _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio")),
):
    """Every date in `month` that still has a free published Head Physio slot, and how many.

    Read from the same two places as available-experts — doctors.slots minus live
    appointments — so the booking calendar can only ever highlight a day its own expert
    and slot columns will actually be able to fill. (The older calendar-availability
    endpoint can't be used for this: it ignores the date when reading an expert's slots
    and falls back to a default 09:00-17:30 grid, so it reports every day as open.)
    """
    # Head Physios are org-wide: they take consultations for every branch, so this
    # never narrows by branch_id.
    branch_experts = await v3_col("doctors").find(
        {"profile_type": "head_physio"}, {"_id": 0, "id": 1, "slots": 1}
    ).to_list(500)

    booked_rows = await v3_col("appointments").find(
        {"status": "new_appointment", "slot_time": {"$regex": f"^{month}-"}},
        {"_id": 0, "doctor_id": 1, "slot_time": 1, "lead_id": 1},
    ).to_list(5000)
    # This lead's own bookings don't count against it — the day it already sits on has to
    # stay reachable so the appointment can be seen and moved.
    taken = {
        (r.get("doctor_id"), r.get("slot_time"))
        for r in booked_rows
        if not (lead_id and r.get("lead_id") == lead_id)
    }

    dates: Dict[str, int] = {}
    for d in branch_experts:
        for s in (d.get("slots") or []):
            if not isinstance(s, str) or not s.startswith(f"{month}-") or "T" not in s:
                continue
            if (d["id"], s) in taken:
                continue
            day = s.split("T")[0]
            dates[day] = dates.get(day, 0) + 1
    return {"month": month, "branch_id": branch_id, "dates": dates}


@router.get("/branch-admin/consultations/{branch_id}/board")
async def v3_consultations_board(branch_id: str, pipeline: Optional[str] = None, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio"))):
    """Return leads in the Consultations pipeline for a branch, grouped by the caller's own
    pipeline field. Head Physio has a fully independent pipeline (head_consultation_stage) from
    Branch Admin's own (consultation_stage) — filtering by the wrong field would show a Head
    Physio every branch lead that has merely entered the Branch's pipeline, not just the ones
    actually handed off to them, inflating "All Stages" beyond the sum of their own stage pills.
    Super Admin driving a branch's Head Physio board (Branch Management > Branch Control) can
    pass pipeline=head_consultation to see it the same way that branch's head physio would.

    branch_id="all" drops the branch filter. Head Physios cover every branch and so carry no
    branch of their own; without this their board would ask for a branch it doesn't have and
    come back empty."""
    try:
        is_hp = user.role == "head_physio" or (user.role == "super_admin" and pipeline == "head_consultation")
        field = "head_consultation_stage" if is_hp else "consultation_stage"
        query = {field: {"$ne": None}}
        if branch_id and branch_id != "all":
            query["branch_id"] = branch_id
        leads_docs = await v3_col("leads").find(query, {"_id": 0}).sort("updated_at", -1).to_list(2000)
        stage_names = await _head_consultation_stage_names() if is_hp else await _consultation_stage_names()
        stage_counts = {}
        for stage in stage_names:
            stage_counts[stage] = sum(1 for ld in leads_docs if ld.get(field) == stage)
        # One malformed lead document shouldn't 500 the whole board — skip it and keep
        # showing every other lead rather than failing the entire list.
        lead_list = []
        for ld in leads_docs:
            try:
                lead_list.append(V3LeadOut(**ld).model_dump())
            except Exception as e:
                logging.getLogger(__name__).error(f"consultations-board: skipping unparseable lead {ld.get('id')}: {e}")
        return {"leads": lead_list, "stage_counts": stage_counts, "stages": stage_names}
    except HTTPException:
        raise
    except Exception as e:
        logging.getLogger(__name__).exception("consultations-board: failed to load")
        raise HTTPException(status_code=500, detail=f"consultations-board error: {type(e).__name__}: {e}")


# Stages reachable only through their own dedicated, validated action endpoint —
# never through a plain manual move.
_CONSULTATION_STAGE_GATED = {
    "Consultation Visit",   # via consultation-decision (Head Physio's Save & Move)
    "Fee Collected",        # via collect-package-payment / collect-treatment-fee
    "Physio Assign",        # via assign-consultation-physio
    "Consultation Completed",  # via mark-consultation-completed
}


@router.post("/leads/{lead_id}/move-consultation-stage", response_model=V3LeadOut)
async def v3_move_consultation_stage(lead_id: str, payload: V3ConsultationStageInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio"))):
    stage_names = await _consultation_stage_names()
    if payload.consultation_stage not in stage_names:
        raise HTTPException(status_code=400, detail=f"Invalid consultation_stage. Allowed: {stage_names}")
    if payload.consultation_stage in _CONSULTATION_STAGE_GATED:
        raise HTTPException(
            status_code=403,
            detail=f"'{payload.consultation_stage}' can only be reached through its own action, not a manual stage move.",
        )

    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    previous = lead.get("consultation_stage") or "—"
    # Backward moves (to an earlier stage than the lead's current one) are never
    # allowed once a lead has moved forward — "Cancel" is a side-exit, not a
    # reorder, so it's exempt.
    if previous in stage_names and payload.consultation_stage != "Cancel":
        prev_idx = stage_names.index(previous)
        next_idx = stage_names.index(payload.consultation_stage)
        if next_idx < prev_idx:
            raise HTTPException(
                status_code=403,
                detail=f"'{previous}' has already moved forward — it can't be sent back to '{payload.consultation_stage}'.",
            )

    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "consultation_stage": payload.consultation_stage,
        "updated_at": now_iso(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "consultation_stage_moved",
        "details": f"Consultation: {previous} → {payload.consultation_stage}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


class V3BranchFollowUpInput(BaseModel):
    date: str  # YYYY-MM-DD
    time: str  # HH:MM (24h)
    remarks: Optional[str] = ""


class V3BranchFollowUpRescheduleInput(BaseModel):
    date: str
    time: str
    reason: Optional[str] = ""


@router.post("/leads/{lead_id}/branch-follow-up", response_model=V3LeadOut)
async def v3_schedule_branch_follow_up(lead_id: str, payload: V3BranchFollowUpInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Schedule a Branch Leads follow-up. Appends to follow_ups[] and moves branch_stage to 'Follow Up'.

    Distinct from Pre-Sales' /leads/{id}/follow-up, which instead moves the pre-sales `stage`
    field — Branch Admin's own pipeline is tracked via `branch_stage`, so it needs its own
    endpoint rather than overloading the pre-sales one."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    entry = {
        "id": str(uuid.uuid4()),
        "date": payload.date,
        "time": payload.time,
        "remarks": (payload.remarks or "").strip(),
        "status": "active",
        "created_by": user.full_name,
        "created_at": now_iso(),
    }
    await v3_col("leads").update_one(
        {"id": lead_id},
        {"$push": {"follow_ups": entry}, "$set": {"branch_stage": "Follow Up", "next_follow_up_at": f"{payload.date}T{payload.time}:00", "updated_at": now_iso()}},
    )
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "branch_follow_up_scheduled",
        "details": f"Branch follow-up on {payload.date} at {payload.time} — {entry['remarks'] or 'no remarks'}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


@router.post("/leads/{lead_id}/branch-follow-up/{followup_id}/reschedule", response_model=V3LeadOut)
async def v3_reschedule_branch_follow_up(lead_id: str, followup_id: str, payload: V3BranchFollowUpRescheduleInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Mark an existing branch follow-up as rescheduled (with a reason) and add a new active one in its place."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    follow_ups = lead.get("follow_ups") or []
    old = next((f for f in follow_ups if f.get("id") == followup_id), None)
    if not old:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    reason = (payload.reason or "").strip()
    for f in follow_ups:
        if f.get("id") == followup_id:
            f["status"] = "rescheduled"
            f["reschedule_reason"] = reason
    new_entry = {
        "id": str(uuid.uuid4()),
        "date": payload.date,
        "time": payload.time,
        "remarks": old.get("remarks", ""),
        "status": "active",
        "rescheduled_from": followup_id,
        "created_by": user.full_name,
        "created_at": now_iso(),
    }
    follow_ups.append(new_entry)
    await v3_col("leads").update_one(
        {"id": lead_id},
        {"$set": {"follow_ups": follow_ups, "branch_stage": "Follow Up", "next_follow_up_at": f"{payload.date}T{payload.time}:00", "updated_at": now_iso()}},
    )
    old_summary = f"{old.get('date')} at {old.get('time')}"
    details = f"Branch follow-up rescheduled from {old_summary} to {payload.date} at {payload.time}"
    if reason:
        details += f" — reason: {reason}"
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "branch_follow_up_rescheduled",
        "details": details,
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


class V3ConsultationFollowUpInput(BaseModel):
    date: str  # YYYY-MM-DD
    time: str  # HH:MM (24h)
    remarks: Optional[str] = ""


class V3ConsultationFollowUpRescheduleInput(BaseModel):
    date: str
    time: str
    reason: Optional[str] = ""


@router.post("/leads/{lead_id}/consultation-follow-up", response_model=V3LeadOut)
async def v3_schedule_consultation_follow_up(lead_id: str, payload: V3ConsultationFollowUpInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio"))):
    """Schedule a consultation follow-up. Appends to consultation_follow_ups[] and moves consultation_stage to 'Follow Up'."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    entry = {
        "id": str(uuid.uuid4()),
        "date": payload.date,
        "time": payload.time,
        "remarks": (payload.remarks or "").strip(),
        "status": "active",
        "created_by": user.full_name,
        "created_at": now_iso(),
    }
    # The confirmed Follow-Up date/time IS the patient's consultation appointment —
    # hand off to the Head Physio's own pipeline, seeding it only the first time so a
    # later reschedule never regresses progress the doctor has already made.
    set_fields = {
        "consultation_stage": "Follow Up",
        "next_consultation_follow_up_at": f"{payload.date}T{payload.time}:00",
        "appointment_date": payload.date,
        "appointment_time": payload.time,
        "appointment_datetime": f"{payload.date}T{payload.time}:00",
        "updated_at": now_iso(),
    }
    if not lead.get("head_consultation_stage"):
        set_fields["head_consultation_stage"] = (await _head_consultation_stage_names())[0]
    await v3_col("leads").update_one(
        {"id": lead_id},
        {"$push": {"consultation_follow_ups": entry}, "$set": set_fields},
    )
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "consultation_follow_up_scheduled",
        "details": f"Consultation follow-up on {payload.date} at {payload.time} — {entry['remarks'] or 'no remarks'}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


@router.post("/leads/{lead_id}/consultation-follow-up/{followup_id}/reschedule", response_model=V3LeadOut)
async def v3_reschedule_consultation_follow_up(lead_id: str, followup_id: str, payload: V3ConsultationFollowUpRescheduleInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio"))):
    """Mark an existing consultation follow-up as rescheduled (with a reason) and add a new active one in its place."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    follow_ups = lead.get("consultation_follow_ups") or []
    old = next((f for f in follow_ups if f.get("id") == followup_id), None)
    if not old:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    reason = (payload.reason or "").strip()
    for f in follow_ups:
        if f.get("id") == followup_id:
            f["status"] = "rescheduled"
            f["reschedule_reason"] = reason
    new_entry = {
        "id": str(uuid.uuid4()),
        "date": payload.date,
        "time": payload.time,
        "remarks": old.get("remarks", ""),
        "status": "active",
        "rescheduled_from": followup_id,
        "created_by": user.full_name,
        "created_at": now_iso(),
    }
    follow_ups.append(new_entry)
    set_fields = {
        "consultation_follow_ups": follow_ups,
        "consultation_stage": "Follow Up",
        "next_consultation_follow_up_at": f"{payload.date}T{payload.time}:00",
        "appointment_date": payload.date,
        "appointment_time": payload.time,
        "appointment_datetime": f"{payload.date}T{payload.time}:00",
        "updated_at": now_iso(),
    }
    if not lead.get("head_consultation_stage"):
        set_fields["head_consultation_stage"] = (await _head_consultation_stage_names())[0]
    await v3_col("leads").update_one(
        {"id": lead_id},
        {"$set": set_fields},
    )
    old_summary = f"{old.get('date')} at {old.get('time')}"
    details = f"Consultation follow-up rescheduled from {old_summary} to {payload.date} at {payload.time}"
    if reason:
        details += f" — reason: {reason}"
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "consultation_follow_up_rescheduled",
        "details": details,
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


# ---------- Smart Booking ----------

DEFAULT_SLOTS = [f"{h:02d}:{m:02d}" for h in range(9, 18) for m in (0, 30)]  # 09:00 → 17:30 every 30 min


async def _branch_experts(branch_id: str):
    rows = await v3_col("doctors").find({"branch_id": branch_id}, {"_id": 0}).to_list(500)
    return rows or await v3_col("doctors").find({}, {"_id": 0}).to_list(500)


def _expert_slots(expert: dict):
    """Return the 30-min HH:MM slot list for an expert.

    Prefer slot_details filtered to consultation_type == "Initial Consultation"
    (because Smart Booking only books fresh appointments, not follow-ups/reviews).
    Falls back to the legacy `slots` list, then to the default 09:00-17:30 grid.
    """
    details = expert.get("slot_details") or []
    initial = [d.get("slot_time", "")[:5] for d in details
               if (d.get("consultation_type") or "Initial Consultation") == "Initial Consultation"
               and d.get("slot_time")]
    if initial:
        return sorted(set(initial))
    custom = expert.get("slots") or []
    norm = []
    for s in custom:
        if isinstance(s, str) and len(s) >= 5 and s[2] == ":":
            norm.append(s[:5])
    return norm if norm else DEFAULT_SLOTS


async def _booked_by_expert(branch_id: str, date_str: str):
    """Return {expert_id: set(HH:MM)} of already-booked slots for a branch on a date."""
    cursor = v3_col("leads").find(
        {"branch_id": branch_id, "appointment_date": date_str,
         "assigned_physio_id": {"$ne": None}, "branch_stage": {"$ne": "Cancelled"}},
        {"_id": 0, "assigned_physio_id": 1, "appointment_time": 1}
    )
    booked = {}
    async for ld in cursor:
        eid = ld.get("assigned_physio_id")
        t = (ld.get("appointment_time") or "")[:5]
        if not eid or not t:
            continue
        booked.setdefault(eid, set()).add(t)
    return booked


@router.get("/branch-admin/calendar-availability/{branch_id}")
async def v3_calendar_availability(
    branch_id: str,
    month: str = Query(..., description="YYYY-MM"),
    _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio")),
):
    """Return per-day availability for a branch in a given month."""
    try:
        y, m = month.split("-")
        y, m = int(y), int(m)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM") from exc
    _, last_day = monthrange(y, m)
    experts = await _branch_experts(branch_id)
    days = {}
    for d in range(1, last_day + 1):
        date_str = f"{y:04d}-{m:02d}-{d:02d}"
        booked = await _booked_by_expert(branch_id, date_str)
        # Count experts who have at least 1 free slot today
        free_experts = 0
        for e in experts:
            slots = set(_expert_slots(e))
            taken = booked.get(e.get("id"), set())
            if slots - taken:
                free_experts += 1
        days[date_str] = {
            "available_experts": free_experts,
            "total_experts": len(experts),
            "fully_booked": free_experts == 0 and len(experts) > 0,
        }
    return {"month": month, "branch_id": branch_id, "experts_total": len(experts), "days": days}


@router.get("/branch-admin/day-slots/{branch_id}")
async def v3_day_slots(
    branch_id: str,
    date: str = Query(..., description="YYYY-MM-DD"),
    _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio")),
):
    """Return 30-min slots for a given day with the list of available experts per slot."""
    experts = await _branch_experts(branch_id)
    booked = await _booked_by_expert(branch_id, date)
    # Union of all slots offered by any expert that day
    all_slots = set()
    for e in experts:
        all_slots.update(_expert_slots(e))
    out = []
    for t in sorted(all_slots):
        free_experts = []
        for e in experts:
            if t not in _expert_slots(e):
                continue
            if t in booked.get(e.get("id"), set()):
                continue
            free_experts.append({"id": e["id"], "full_name": e.get("full_name"), "specialization": e.get("specialization"), "profile_type": e.get("profile_type")})
        out.append({"time": t, "available_experts": free_experts, "available_count": len(free_experts)})
    return {"date": date, "branch_id": branch_id, "slots": out}


@router.get("/branch-admin/expert-calendar/{expert_id}")
async def v3_expert_calendar(
    expert_id: str,
    month: str = Query(..., description="YYYY-MM"),
    _: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio")),
):
    """Return per-day availability for a single expert in a month + the slots they offer."""
    try:
        y, m = month.split("-")
        y, m = int(y), int(m)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM") from exc
    expert = await v3_col("doctors").find_one({"id": expert_id}, {"_id": 0})
    if not expert:
        raise HTTPException(status_code=404, detail="Expert not found")
    slots = _expert_slots(expert)
    _, last_day = monthrange(y, m)
    days = {}
    branch_id = expert.get("branch_id")
    for d in range(1, last_day + 1):
        date_str = f"{y:04d}-{m:02d}-{d:02d}"
        if branch_id:
            booked = await _booked_by_expert(branch_id, date_str)
            taken = booked.get(expert_id, set())
        else:
            # Fallback: look at any lead assigned to this expert that day
            cursor = v3_col("leads").find(
                {"assigned_physio_id": expert_id, "appointment_date": date_str, "branch_stage": {"$ne": "Cancelled"}},
                {"_id": 0, "appointment_time": 1},
            )
            taken = set()
            async for ld in cursor:
                t = (ld.get("appointment_time") or "")[:5]
                if t:
                    taken.add(t)
        free_slots = [s for s in slots if s not in taken]
        days[date_str] = {"available_slots": free_slots, "total_slots": len(slots), "fully_booked": len(free_slots) == 0}
    return {"expert_id": expert_id, "expert_name": expert.get("full_name"), "month": month, "slots_per_day": slots, "days": days}

