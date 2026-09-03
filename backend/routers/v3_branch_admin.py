from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import Dict, Optional
from datetime import date, datetime, timedelta
from calendar import monthrange
import logging
import uuid

from database import v3_col
from utils import now_iso, active_doctor_query
from deps import (
    v3_require_roles, v3_current_user, is_head_physio_role, consultants_serving_branch,
    online_arm_practice, vertical_in_arm, lead_as_read_by,
)
import lead_control
from constants import (
    V3_BRANCH_STAGES, V3_CONSULTATION_STAGES, V3_HEAD_CONSULTATION_STAGES,
    BRANCH_CANCELLED_STAGE,
)
from stage_utils import branch_stage_names_for_branch, first_branch_stage_for_branch, get_first_stage_name
from schemas.v3 import (
    V3UserOut, V3LeadOut,
    V3BranchStageInput, V3CollectFeeInput, V3AssignPhysioInput, V3ConsultationStageInput,
    V3PortfolioScheduleInput,
)
from routers.v3_lead_documents import leads_with_prescription

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
    stages = [r for r in rows if not r.get("applies_to") or r.get("applies_to") == control]
    if control == lead_control.BRANCH_ADMIN:
        # Read before inserting: the branch's own opening is whatever sits first here, and
        # the mirror needs its name to know which leads it has stopped applying to.
        entry = stages[0]["name"] if stages else V3_BRANCH_STAGES[0]
        stages.insert(0, await _presales_mirror_stage(entry))
    return stages


async def _presales_mirror_stage(entry_stage_name: str) -> dict:
    """The "Leads" pill: the branch's own Pre-Sales New Leads, shown on Branch Leads.

    A branch running its own leads works them on its embedded Pre-Sales board first, so the
    raw arrivals were only visible on that tab. This surfaces them on Branch Leads too,
    where the rest of the journey already lives.

    Deliberately not a pipeline_stages row. It reads the lead's Pre-Sales `stage` rather
    than its `branch_stage`, so a lead appears here without anything being written to it —
    the point being visibility, not a change of ownership. `mirrors_stage` is the client's
    signal to count and filter it against that other field, and because no such stage
    exists in the collection, /branch-stage rejects any attempt to move a lead onto it.

    It stops applying the moment the branch works the lead: `unmoved_branch_stage` is the
    match, so a lead is shown under Leads only while it is still sitting at the branch's
    own opening, and moving it anywhere takes it out of this pill and into that stage.

    That opening no longer draws a pill of its own — Branch Leads shows four, Leads / RNR /
    Follow Up / Appointment, and this one is the first of them. So the match is on
    `unmoved_branch_stage` alone; it used to also require the lead to be an unworked
    Pre-Sales New Lead (`mirrors_stage`), which is where the pill's name comes from, and
    that half had to go when the pill became the whole of the opening rather than a second
    reading of it. A branch switched off Pre-Sales control has leads rehomed onto Branch
    Assign still carrying whatever Pre-Sales stage they had reached, and the narrow match
    left every one of them in no pill at all. `mirrors_stage` is still sent: it is what
    tells the client this pill is a view rather than a move target.
    """
    return {
        "id": "presales-new-leads",
        "name": "Leads",
        "color": "#6366f1",
        "type": "sales",
        # Ahead of the real entry stage: it is the earlier step of the same journey.
        "order": -1,
        "is_final": False,
        "applies_to": lead_control.BRANCH_ADMIN,
        # Resolved live — Super Admin can rename the Pre-Sales entry stage.
        "mirrors_stage": await get_first_stage_name("pre_sales", "New Leads"),
        "unmoved_branch_stage": entry_stage_name,
    }


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

    rows = [("CONSULTANT", a["head_physio"])]
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


async def _stamp_session_progress(leads: list) -> None:
    """Put each lead's treatment-day count on it: how many were booked, how many are done.

    Derived rather than stored. The days live in the sessions collection and are completed
    one at a time by whoever ran them, so a count kept on the lead would be a second copy
    of that to keep true — and the one that goes stale is the one the board reads.

    One aggregation for the whole branch rather than a query per lead: a branch with two
    thousand patients would otherwise open its board with two thousand round trips.

    Leads with no days booked are left without the fields entirely, which is not the same
    as zero: nobody has sold them treatment, so they are not partway through any.
    """
    ids = [lead["id"] for lead in leads if lead.get("id")]
    if not ids:
        return
    rows = await v3_col("sessions").aggregate([
        # lead_id is what a treatment day carries; an auth token in the same collection has
        # none, which is what this first stage keeps out.
        {"$match": {"lead_id": {"$in": ids}}},
        {"$group": {
            "_id": "$lead_id",
            "total": {"$sum": 1},
            "done": {"$sum": {"$cond": [{"$eq": ["$status", "completed"]}, 1, 0]}},
        }},
    ]).to_list(20000)
    progress = {r["_id"]: r for r in rows}
    for lead in leads:
        found = progress.get(lead.get("id"))
        if not found:
            continue
        lead["total_sessions"] = found["total"]
        lead["completed_sessions"] = found["done"]


async def _board_payload(leads: list, branch_id: Optional[str], role: str = "") -> dict:
    """The Branch Leads response, from a list of leads somebody else has already chosen.

    Split from the endpoint because there are two ways in now and they differ only in that
    choice: a branch's board asks for the leads at one branch, and an online arm's asks for
    the leads of one vertical, because an online arm is not a branch and its leads have
    none — see ONLINE_ARM_PRACTICE in deps.py. Everything after that is the same board and
    has to stay the same board, or the two would drift into disagreeing about what a stage
    count means.

    A None branch reads as Pre-Sales control throughout, which is what an arm wants and
    what branch_lead_control already returns for it: no branch of its own means nobody has
    said this desk runs its own leads.
    """
    await _stamp_session_progress(leads)
    stage_counts = {}
    branch_stages = await _branch_stages(branch_id)
    for stage in branch_stages:
        # The Leads pill is the branch's opening: it counts everyone still sitting at
        # `unmoved_branch_stage` and lets go of them the moment the branch moves them on,
        # or a lead already dealt with would go on being counted here as well as in the
        # stage it was moved to. Every real branch stage counts on `branch_stage` too, so
        # the two differ only in which name they compare against.
        #
        # It also required `stage == mirrors_stage` — that the lead was an unworked
        # Pre-Sales New Lead, which is where the pill's name comes from. Dropped when the
        # branch's own entry stage stopped drawing a pill of its own and this one became
        # the whole of the opening; a branch switched off Pre-Sales control has leads
        # rehomed onto that stage carrying their old Pre-Sales stage, and they were being
        # counted under nothing at all.
        mirrors = stage.get("mirrors_stage")
        if mirrors:
            unmoved = stage.get("unmoved_branch_stage")
            matches = sum(1 for lead in leads if lead.get("branch_stage") == unmoved)
        else:
            matches = sum(1 for lead in leads if lead.get("branch_stage") == stage["name"])
        stage_counts[stage["name"]] = matches
    # One malformed lead document shouldn't 500 the whole board — skip it and keep
    # showing every other lead rather than failing the entire list.
    lead_list = []
    for lead in leads:
        try:
            # `role` decides whether the ad record rides along — see lead_as_read_by.
            lead_list.append(V3LeadOut(**lead_as_read_by(lead, role)))
        except Exception as e:
            logging.getLogger(__name__).error(f"branch-board: skipping unparseable lead {lead.get('id')}: {e}")
    # The board tells the client which desk owns this branch's leads, so the Pre Sales
    # tab appears and disappears on the same fetch as the leads it works on rather
    # than needing a second round trip to /branches to find out.
    branch = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0, "lead_control": 1}) if branch_id else None
    return {
        "leads": [lead.model_dump() for lead in lead_list],
        "stage_counts": stage_counts,
        "lead_control": lead_control.normalize((branch or {}).get("lead_control")),
        # Sent with the board rather than fetched separately from /stages, which has no
        # branch to scope by: the stage strip must match the Lead Control on the same
        # response, or a flipped branch briefly renders the other mode's stages.
        "stages": branch_stages,
    }


@router.get("/branch-board/{branch_id}")
async def v3_branch_board_new(branch_id: str, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "business_dev"))):
    try:
        leads = await v3_col("leads").find({"branch_id": branch_id}, {"_id": 0}).sort("updated_at", -1).to_list(20000)
        return await _board_payload(leads, branch_id, user.role)
    except HTTPException:
        raise
    except Exception as e:
        logging.getLogger(__name__).exception("branch-board: failed to load")
        raise HTTPException(status_code=500, detail=f"branch-board error: {type(e).__name__}: {e}")


@router.get("/arm-board")
async def v3_arm_board(user: V3UserOut = Depends(v3_current_user)):
    """Branch Leads for an admin who runs an online arm rather than a branch.

    The arm is read off the caller's own role, not asked for in the URL. There are exactly
    two of these boards and each role runs exactly one of them, so a parameter would only
    be a way for the fitness admin to request the physio arm's patients.

    Scoped on the lead's `vertical`, which is what an online lead carries instead of a
    branch. Narrowed in the query on the "online" half and then decided properly in Python,
    because `vertical` is not a controlled field — this install already holds "Meta",
    "referral" and "whatsapp" in it — and a token test is the only honest reading of it.
    See vertical_in_arm in deps.py.
    """
    practice = online_arm_practice(user.role)
    if not practice:
        raise HTTPException(status_code=403, detail="Not allowed")
    try:
        rows = await v3_col("leads").find(
            {"vertical": {"$regex": "online", "$options": "i"}}, {"_id": 0},
        ).sort("updated_at", -1).to_list(20000)
        leads = [r for r in rows if vertical_in_arm(r.get("vertical"), practice)]
        return await _board_payload(leads, None, user.role)
    except HTTPException:
        raise
    except Exception as e:
        logging.getLogger(__name__).exception("arm-board: failed to load")
        raise HTTPException(status_code=500, detail=f"arm-board error: {type(e).__name__}: {e}")


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

    # Cancelled is where a booked consultation goes to die, and the slot it was holding has
    # to go back on the calendar with it. Without this the lead read as cancelled on every
    # board while the expert's 10:30 stayed Booked -- an hour nobody could sell and nobody
    # was coming to.
    #
    # Done here rather than in a cancel endpoint of its own because the stage is the event:
    # however a lead reaches Cancelled -- this pill, a bulk move, a later screen -- the
    # appointment behind it is off. Idempotent, since a lead already cancelled has no rows
    # left in new_appointment to match.
    freed = 0
    if payload.branch_stage == BRANCH_CANCELLED_STAGE:
        res = await v3_col("appointments").update_many(
            {"lead_id": lead_id, "status": "new_appointment"},
            {"$set": {"status": "cancelled", "updated_at": now_iso()}},
        )
        freed = res.modified_count

    activity = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "branch_stage_change",
        "details": f"Branch stage: '{old_stage}' -> '{payload.branch_stage}'"
                   + (f" · {freed} appointment{'' if freed == 1 else 's'} cancelled, slot freed" if freed else ""),
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
    physio = await v3_col("doctors").find_one(
        {"id": payload.physio_id}, {"_id": 0, "full_name": 1, "slot_details": 1, "meet_link": 1}
    )
    if not physio:
        raise HTTPException(status_code=404, detail="Physio not found")

    slot_time = f"{payload.appointment_date}T{payload.appointment_time}"

    # The booking this lead already holds, read before anything is written so the slot it
    # is on can be compared with the one being asked for. Rescheduling is not a separate
    # endpoint -- rebooking IS the reschedule, and always has been, since the branch picks
    # a new slot on the same popup either way. What was missing is that nothing said so
    # afterwards.
    #
    # Derived here rather than taken from the caller: a flag on the payload would let a
    # notes edit claim to be a reschedule, and this is the field the Consultant reads to
    # know the patient has been moved once already.
    prior_appt = await v3_col("appointments").find_one(
        {"lead_id": lead_id, "appt_kind": "consultation", "status": "new_appointment"},
        {"_id": 0, "id": 1, "slot_time": 1},
    )
    # Only a move counts. Re-picking the same slot is how the popup is used to edit notes
    # or hand the appointment to another expert, and calling that a reschedule would put
    # the tag on patients who were never moved at all.
    is_reschedule = bool(
        payload.final_stage == "Appointment Date & Time"
        and prior_appt
        and prior_appt.get("slot_time")
        and prior_appt["slot_time"] != slot_time
    )

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
    if is_reschedule:
        # Counted rather than merely flagged: a patient moved three times is a different
        # conversation from one moved once, and the flag alone cannot tell them apart.
        updates["appointment_rescheduled"] = True
        updates["appointment_reschedule_count"] = int(lead.get("appointment_reschedule_count") or 0) + 1
        updates["appointment_rescheduled_at"] = now_iso()
        updates["appointment_rescheduled_from"] = prior_appt["slot_time"]
    if payload.notes and payload.notes.strip():
        existing_notes = (lead.get("notes") or "").strip()
        appended = f"[Appt {payload.appointment_date} {payload.appointment_time}] {payload.notes.strip()}"
        updates["notes"] = f"{existing_notes}\n{appended}" if existing_notes else appended
    await v3_col("leads").update_one({"id": lead_id}, {"$set": updates})

    # The lead fields above drive the Branch Leads table; the `appointments` record below
    # is what the Calendar tab renders and what marks the expert's slot as Booked on the
    # Consultant Calendar. Both must be written or the booking is invisible to scheduling.
    existing_appt = prior_appt
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
            # The room as it stood when this was booked, copied onto the appointment rather
            # than looked up through the expert whenever somebody opens it.
            #
            # Read off the expert's own record here, never off the payload: the link is
            # about to be sent to a patient over the clinic's name, and a booking screen
            # that could name the room would be a booking screen that could send a patient
            # anywhere. The screen shows what this record says; it does not get to say it.
            #
            # Frozen on purpose. An expert who changes their room next month has not
            # changed where the patients already told to join are going, and rewriting
            # every past appointment to the new address would move a meeting that has
            # already been arranged.
            "meet_link": (physio.get("meet_link") or "").strip(),
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
        if is_reschedule:
            # On the appointment as well as on the lead. The Head Physio calendar draws
            # slots straight out of this collection and never joins back to the lead, so
            # without this the one screen where a moved appointment matters most -- the
            # day the expert is about to work -- could not know it had moved.
            appt_fields["rescheduled"] = True
            appt_fields["rescheduled_from"] = prior_appt["slot_time"]
            appt_fields["rescheduled_at"] = now_iso()
        if existing_appt:
            # Rescheduling an existing booking — move it rather than leaving a stale row
            # holding the old slot.
            await v3_col("appointments").update_one({"id": existing_appt["id"]}, {"$set": appt_fields})
        else:
            await v3_col("appointments").insert_one({**appt_fields, "id": str(uuid.uuid4()), "created_at": now_iso()})

    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "branch_appointment_rescheduled" if is_reschedule else "branch_appointment_scheduled",
        "details": (
            (f"Appointment moved from {prior_appt['slot_time'].replace('T', ' ')} to "
             f"{payload.appointment_date} {payload.appointment_time} with {physio['full_name']}"
             if is_reschedule else
             f"Appointment {payload.appointment_date} {payload.appointment_time} with {physio['full_name']} → {payload.final_stage}")
            + (f" · Notes: {payload.notes.strip()}" if payload.notes else "")
        ),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now_iso(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)



async def _expert_photos(experts: list) -> Dict[str, str]:
    """{ doctors.id: headshot URL } for the experts given, empty string where there is none.

    The picture is three documents away from the calendar record the booking popup lists:
    a `doctors` row names a login through user_id, the login names an employee through
    employee_id, and only the employee carries photo_url (see _employee_photo in
    v3_auth.py, which walks the last hop for the signed-in user).

    Two batched queries rather than a lookup per expert -- a branch with a dozen
    Consultants would otherwise pay two dozen round trips to draw one column of faces.
    An expert with no login, no employee behind the login, or no photo on the employee is
    simply absent from the result, which the avatar renders as their initial.
    """
    user_ids = [u for u in {e.get("user_id") for e in experts} if u]
    if not user_ids:
        return {}
    users = await v3_col("users").find(
        {"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "employee_id": 1},
    ).to_list(len(user_ids))
    emp_by_user = {u["id"]: u.get("employee_id") for u in users if u.get("employee_id")}
    emp_ids = list({v for v in emp_by_user.values() if v})
    if not emp_ids:
        return {}
    employees = await v3_col("employees").find(
        {"id": {"$in": emp_ids}}, {"_id": 0, "id": 1, "photo_url": 1},
    ).to_list(len(emp_ids))
    photo_by_emp = {e["id"]: e.get("photo_url") or "" for e in employees}
    out = {}
    for e in experts:
        photo = photo_by_emp.get(emp_by_user.get(e.get("user_id")), "")
        if photo:
            out[e.get("id")] = photo
    return out


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

    Consultations are conducted by Consultants only — regular Physios run treatment
    sessions, which are booked separately once a package is sold — so this never offers
    a Physio.

    Only the Consultants posted to this branch. They used to be offered at every branch
    whatever anybody selected, which is the rule this booking popup existed on the wrong
    side of: a Branch Admin picking an expert was shown the whole organisation.
    """
    if not date:
        raise HTTPException(status_code=400, detail="date is required")
    # Every consultant record, then narrowed to the ones posted here. Two steps because the
    # answer is not on the record — it is the branch list on the login behind it, and the
    # record itself stays branchless so one person keeps one calendar. See
    # consultants_serving_branch in deps.py.
    branch_experts = await v3_col("doctors").find(active_doctor_query({"profile_type": "head_physio"}), {"_id": 0}).to_list(500)
    branch_experts = await consultants_serving_branch(branch_experts, branch_id)

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

    # Faces for the picker's Consultant column, resolved once for the whole branch list
    # rather than per row. See _expert_photos.
    photo_by_expert = await _expert_photos(branch_experts)

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
            # The expert's own headshot where HR has one on file, "" where they do not --
            # the picker draws their initial in the same circle either way, so this never
            # has to be present for the row to render.
            "photo_url": photo_by_expert.get(d.get("id"), ""),
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
    # Only the Consultants posted to this branch, the same narrowing available-experts
    # does — the two are read together by the booking calendar, and a day lit up here that
    # the expert column then cannot fill is worse than the day simply not being offered.
    # user_id is projected because that is what the narrowing reads.
    branch_experts = await v3_col("doctors").find(
        active_doctor_query({"profile_type": "head_physio"}),
        {"_id": 0, "id": 1, "slots": 1, "user_id": 1, "profile_type": 1, "branch_id": 1},
    ).to_list(500)
    branch_experts = await consultants_serving_branch(branch_experts, branch_id)

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
        # Off the predicate, not the literal: the desk is `consultant`/`online_consultant`
        # now, and matching the retired slug exactly dropped every consultant onto the
        # Branch Admin's consultation pipeline instead of their own.
        is_hp = is_head_physio_role(user.role) or (user.role == "super_admin" and pipeline == "head_consultation")
        field = "head_consultation_stage" if is_hp else "consultation_stage"
        query = {field: {"$ne": None}}
        if branch_id and branch_id != "all":
            query["branch_id"] = branch_id
        leads_docs = await v3_col("leads").find(query, {"_id": 0}).sort("updated_at", -1).to_list(2000)
        stage_names = await _head_consultation_stage_names() if is_hp else await _consultation_stage_names()
        stage_counts = {}
        for stage in stage_names:
            stage_counts[stage] = sum(1 for ld in leads_docs if ld.get(field) == stage)
        # How far through their days each patient is. The branch-board next door has
        # always stamped this; here it was missing, so total_sessions and
        # completed_sessions arrived undefined and the Completed stage -- which is read
        # off exactly those two numbers -- could only ever find the Consultation Only
        # patients somebody had closed by hand. A patient who finished every day of a
        # course was not on it.
        await _stamp_session_progress(leads_docs)
        # One malformed lead document shouldn't 500 the whole board — skip it and keep
        # showing every other lead rather than failing the entire list.
        lead_list = []
        for ld in leads_docs:
            try:
                lead_list.append(V3LeadOut(**lead_as_read_by(ld, user.role)).model_dump())
            except Exception as e:
                logging.getLogger(__name__).error(f"consultations-board: skipping unparseable lead {ld.get('id')}: {e}")
        # Who has their prescription filed, as a list of ids beside the leads rather than a
        # field on each of them. The Consultation Fee is gated on that page, and the Collect
        # button at the end of a row has to know before it is pressed — a row that opens a
        # payment it will not take reads as broken.
        #
        # Kept off the lead deliberately. Every collect and every stage move replaces the
        # row it touched with the lead that endpoint returns, and a flag riding on the lead
        # would be dropped by every one of them — locking a row whose prescription is on
        # file. Answered once for the board, held beside it, and untouched by any of that.
        rx_ids = await leads_with_prescription([ld.get("id") for ld in leads_docs if ld.get("id")])
        return {
            "leads": lead_list,
            "stage_counts": stage_counts,
            "stages": stage_names,
            "rx_lead_ids": sorted(rx_ids),
        }
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
    rows = await v3_col("doctors").find(active_doctor_query({"branch_id": branch_id}), {"_id": 0}).to_list(500)
    return rows or await v3_col("doctors").find(active_doctor_query(), {"_id": 0}).to_list(500)


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



# ---------------------------------------------------------------- Branch Transfer
#
# Moving a patient from one branch to another, which is a different act at each end of
# their time with us and impossible in the middle of it.
#
# Two windows, and the gap between them is deliberate. Before a consultation is booked the
# lead is just a name and a phone number: nothing is on anyone's calendar, no money has
# been taken, and the move costs nothing but the stage they stand on. Once treatment is
# under way — Physio Assign — the move is real work but it is work with a shape: the days
# already delivered are finished, and the days still to come have to be released and
# rebooked wherever the patient is going.
#
# What is refused is everything between those two. A consultation booked but not yet held
# sits on a named Head Physio's calendar at this branch; a Treatment Fee part-collected
# sits on an installment plan that would end up split across two branches' books. Neither
# is impossible to move — both are things nobody has decided the rules for, and guessing
# at them in code is how a branch ends up with half a patient.
TRANSFERABLE_AT_PHYSIO_ASSIGN = "Physio Assign"


def _transfer_block_reason(lead: dict) -> Optional[str]:
    """Why this patient cannot be transferred right now, or None if they can.

    Phrased as the reason rather than a boolean because the answer is the useful half: a
    Super Admin told "no" wants to know whether to wait for the consultation to happen or
    to finish collecting the fee.
    """
    stage = lead.get("consultation_stage")
    # No consultation pipeline at all means no consultation has ever been booked — the
    # lead is still purely in the branch's own sales pipeline, which is the first window.
    if stage is None:
        return None
    if stage == TRANSFERABLE_AT_PHYSIO_ASSIGN:
        return None
    if stage in (BRANCH_CANCELLED_STAGE, "Cancel"):
        return "This consultation was cancelled — there is nothing to transfer."
    if stage == "Consultation Completed":
        return "This patient's consultation is closed. Transferring a finished record would move its revenue without moving any work."
    return (
        f"A patient at '{stage}' cannot be transferred. "
        "A booked consultation is held on this branch's Head Physio calendar and a "
        "part-collected Treatment Fee would leave its installments split across two "
        "branches. Transfer before the consultation is booked, or once treatment has "
        "started at Physio Assign."
    )


class V3BranchTransferInput(BaseModel):
    to_branch_id: str
    reason: Optional[str] = ""


@router.get("/leads/{lead_id}/transfer-eligibility")
async def v3_transfer_eligibility(
    lead_id: str,
    _: V3UserOut = Depends(v3_require_roles("super_admin")),
):
    """Whether this patient can be transferred, and what moving them would cost.

    Asked before the act rather than discovered during it: the days about to be released
    and the money about to stay behind are both things the Super Admin should read before
    they press the button, not in the toast afterwards.
    """
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    reason = _transfer_block_reason(lead)
    completed = await v3_col("sessions").count_documents({"lead_id": lead_id, "status": "completed"})
    booked = await v3_col("sessions").count_documents({"lead_id": lead_id, "status": {"$ne": "completed"}})
    return {
        "lead_id": lead_id,
        "can_transfer": reason is None,
        "blocked_reason": reason,
        "consultation_stage": lead.get("consultation_stage"),
        "branch_id": lead.get("branch_id"),
        "patient_number": lead.get("patient_number"),
        # What the move would do, in the two currencies that matter.
        "sessions_completed": completed,
        "sessions_to_release": booked,
        "current_physio_name": lead.get("assigned_physio_name") or "",
        "revenue_staying_behind": round(
            (lead.get("consultation_fee") or 0) + (lead.get("package_paid") or 0), 2
        ),
        "transfers_so_far": len(lead.get("branch_transfer_history") or []),
    }


@router.post("/leads/{lead_id}/transfer-branch")
async def v3_transfer_branch(
    lead_id: str,
    payload: V3BranchTransferInput,
    user: V3UserOut = Depends(v3_require_roles("super_admin")),
):
    """Move a patient to another branch.

    Super Admin only. A Branch Admin moving their own patient out is not a transfer, it is
    an exit, and the branch losing the revenue should not be the one deciding it.

    Three things happen, and only one of them is the branch_id:

    1. The money already collected is pinned to the branch that collected it. Finance reads
       revenue off the fee fields on the lead grouped by the lead's branch, so a bare
       branch_id flip would take every rupee this patient ever paid out of one branch's
       books and put it in another's — including months already reported on. The split
       recorded here is what keeps a closed month closed; see _branch_revenue_rows.

    2. Treatment days still to come are released. The physio delivering them works at the
       branch being left, so those days cannot survive the move. Days already completed
       stay exactly where they are, under the physio who ran them, and still count toward
       the course — the patient arrives at the new branch part-way through, at Physio
       Assign, with the rest of their course to book there.

    3. The lead lands on a stage that exists at the destination. A branch running its own
       leads opens at a different stage from one fed by Pre-Sales, so a lead moved without
       this can arrive at a stage its new board does not draw and vanish from both.

    The Patient Number does not change. It carries a branch code, so it stops describing
    where the patient is — but it is printed on every receipt already issued and is how
    the patient is looked up, and breaking that to keep a prefix honest is the worse trade.
    The transfer history is what says where they have been.
    """
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    from_branch_id = lead.get("branch_id")
    if not from_branch_id:
        raise HTTPException(status_code=400, detail="This lead does not belong to a branch yet")
    if payload.to_branch_id == from_branch_id:
        raise HTTPException(status_code=400, detail="This patient is already at that branch")

    destination = await v3_col("branches").find_one({"id": payload.to_branch_id}, {"_id": 0})
    if not destination:
        raise HTTPException(status_code=404, detail="Destination branch not found")
    origin = await v3_col("branches").find_one({"id": from_branch_id}, {"_id": 0}) or {}

    blocked = _transfer_block_reason(lead)
    if blocked:
        raise HTTPException(status_code=400, detail=blocked)

    now = now_iso()
    at_treatment = lead.get("consultation_stage") == TRANSFERABLE_AT_PHYSIO_ASSIGN

    # 1. Pin what this branch has already taken. Recorded even when it is zero: "nothing was
    #    collected here" is a fact the finance split needs as much as a number, and a lead
    #    transferred before any fee would otherwise leave a gap that reads as untransferred.
    split = {
        "branch_id": from_branch_id,
        "branch_name": origin.get("branch_name") or "",
        "consultation_fee": round(lead.get("consultation_fee") or 0, 2),
        "package_paid": round(lead.get("package_paid") or 0, 2),
        "until": now,
    }

    # 2. Release what has not been delivered. Completed days are untouched — they happened,
    #    at the old branch, under the physio who ran them, and the course counts them still.
    released = 0
    physio_updates: dict = {}
    handover: dict = {}
    if at_treatment:
        released = (await v3_col("sessions").delete_many(
            {"lead_id": lead_id, "status": {"$ne": "completed"}},
        )).deleted_count
        # The outgoing physio's spell closes here for the same reason a reassignment closes
        # one: their completed days stay on the record and the Physio Assign card at the new
        # branch has to be able to show where they left off. Written directly rather than
        # through _physio_handover, which lives on the other router and answers a slightly
        # different question — there is no incoming physio to name yet.
        if lead.get("assigned_physio_id"):
            handover = {"physio_assignment_history": {
                "physio_id": lead["assigned_physio_id"],
                "physio_name": lead.get("assigned_physio_name") or "",
                "assigned_at": lead.get("physio_assigned_at"),
                "ended_at": now,
                "replaced_by_id": "",
                "handed_over_by": user.full_name,
                "handed_over_by_role": user.role,
                "ended_by_branch_transfer": True,
            }}
        # Cleared, not carried. The patient arrives needing a physio at the branch they
        # arrived at, and a name left here would be a physio on another branch's floor.
        physio_updates = {
            "assigned_physio_id": None,
            "assigned_physio_name": None,
            "physio_assigned_at": None,
        }

    # 3. A stage the destination's board actually draws.
    updates = {
        "branch_id": payload.to_branch_id,
        "updated_at": now,
        **physio_updates,
    }
    if not at_treatment:
        updates["branch_stage"] = await first_branch_stage_for_branch(
            payload.to_branch_id, "New Appointment",
        )

    await v3_col("leads").update_one({"id": lead_id}, {
        "$set": updates,
        "$push": {
            "revenue_branch_splits": split,
            "branch_transfer_history": {
                "from_branch_id": from_branch_id,
                "from_branch_name": origin.get("branch_name") or "",
                "to_branch_id": payload.to_branch_id,
                "to_branch_name": destination.get("branch_name") or "",
                "at": now,
                "consultation_stage": lead.get("consultation_stage"),
                "sessions_released": released,
                "reason": (payload.reason or "").strip(),
                "transferred_by": user.full_name,
                "transferred_by_role": user.role,
            },
            **handover,
        },
    })

    detail = f"Transferred from {origin.get('branch_name') or 'branch'} to {destination.get('branch_name') or 'branch'}"
    if released:
        detail += f" · {released} booked treatment day{'s' if released != 1 else ''} released"
    if at_treatment and lead.get("assigned_physio_name"):
        detail += f" · left {lead['assigned_physio_name']}'s care"
    if (payload.reason or "").strip():
        detail += f" · {payload.reason.strip()}"
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "branch_transferred",
        "details": detail,
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": now,
    })

    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {
        "message": f"Transferred to {destination.get('branch_name') or 'the destination branch'}",
        "lead": V3LeadOut(**updated).model_dump(),
        "sessions_released": released,
        "sessions_kept": await v3_col("sessions").count_documents({"lead_id": lead_id, "status": "completed"}),
        "revenue_left_behind": round(split["consultation_fee"] + split["package_paid"], 2),
    }
