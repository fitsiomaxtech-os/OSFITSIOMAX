"""Zumba registrations for a branch.

Zumba is sold alongside the clinic's own verticals but is not a clinical journey: nobody
is consulted, treated or discharged, so it never belonged in the leads pipeline where
every row carries a branch_stage and a consultation decision. It gets its own small
collection and its own tab.

What the branch actually wants to know is where the registrations came from, so the
summary is a split by source. A referral names the master who made it, which is why the
masters are listed one by one rather than sitting behind a single "Masters" option: the
question asked of a referral is always which master, and a name typed once is offered from
then on. Fee's Collected sits among the source cards counting the registrations whose
money is actually in, which is a different question from how many registered.

Money is stored on the registration rather than in the finance ledger: a Zumba fee is a
flat class fee with no package, no installments and no consultation behind it, and putting
it through the leads' fee machinery would have meant inventing a lead to hang it on.
"""

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import v3_col
from deps import v3_current_user, is_branch_admin_role, is_zumba_role
from schemas.v3 import V3UserOut
from utils import now_iso

router = APIRouter(prefix="/api/v3")

# How a registration arrived. MASTER carries a master_name alongside it — the others are
# whole answers on their own.
MASTER = "master"
SOURCES = (MASTER, "board", "consultations", "branch", "social_media", "personal", "fitsiomax")
DEFAULT_SOURCE = "personal"

# The first cut of this tab shipped with a different, shorter vocabulary. Rows written then
# still say "direct" or "consultant", so they are read forward rather than left to fall
# through to the default and quietly change which card they count towards. "fitsiomax" is
# not listed: it is a source in its own right now and needs no translation.
LEGACY_SOURCES = {
    "direct": "personal",
    "consultant": "consultations",
    "masters": MASTER,
}

# Which summary card a source counts towards.
#
# Direct means nobody referred them: they walked in, they found the page, they read the
# board. Every other card names whoever did the referring. That is the line the cards are
# actually drawn on, and it is why three sources feed Direct while the rest feed one card
# each — a registration taken straight into this tab is Direct by default, since the
# default source is the one nobody referred.
CARD_OF_SOURCE = {
    "personal": "direct",
    "social_media": "direct",
    "board": "direct",
    # A lead the branch itself took counts as Direct too: nobody referred them either, and
    # its own card had no place left on a strip that now ends in the revenue split, so the
    # count was being kept where nothing could show it.
    "branch": "direct",
    "consultations": "consultant",
    MASTER: "masters",
    "fitsiomax": "fitsiomax",
}
CARDS = ("direct", "consultant", "masters", "fitsiomax")

# When the class this student joins meets. Two slots, stored as they read, because they are
# a label on a registration rather than a booking anything schedules against -- the class
# itself is fixed at Mon/Wed/Fri. Anything else is dropped rather than stored, so the column
# can never hold a time no class runs at.
TIME_SLOTS = ("10:00 am - 11:00 am", "11:00 am - 12:00 pm")

# Recorded as typed, from a fixed set. Unset stays unset: a blank is "not asked", which is
# a different thing from any of the three answers.
GENDERS = ("female", "male", "other")

# What the Zumba pipeline starts life as, so CI/CD ROOTS lists something on a fresh install
# rather than "No stages yet" — the branch tab's own summary cards, so the two screens open
# on one vocabulary instead of two.
#
# A starting point, not a fixture: these are ordinary stages once seeded, renameable and
# deletable in CI/CD ROOTS like any other pipeline's, and a registration still moves along
# them by hand. What the card decides is only where it starts.
#
# The three that count people, not the three that count money: a rupee figure is not a
# place a student can stand, and Total Fees already answers a different question by
# filtering the same list on whether it has been paid.
#
# Name, the card it mirrors, and that card's colour on the branch tab.
ZUMBA_STAGE_CARDS = [
    ("Direct", "direct", "#f59e0b"),
    ("Consultant", "consultant", "#f97316"),
    ("Refer Master", "masters", "#d97706"),
]

# Every seeded stage is a source, so every one of them can be a start.
START_CARDS = frozenset(card for _n, card, _c in ZUMBA_STAGE_CARDS if card in CARDS)

# A stage seeded before the card was stamped on it is recognised by the name it shipped
# with, so an install that already ran this needs no migration.
CARD_OF_SEEDED_NAME = {name: card for name, card, _c in ZUMBA_STAGE_CARDS}


def stage_card(stage: dict):
    """The card a stage mirrors: what it was stamped with, else what it was named at
    seeding. A stage Super Admin wrote themselves mirrors nothing, and nothing starts
    there — it is reached by moving somebody into it, like any other stage."""
    return stage.get("card") or CARD_OF_SEEDED_NAME.get(stage.get("name"))

# The class runs three evenings a week, the same three the membership is sold on (see
# ZUMBA_CLASS_DAYS in frontend/src/components/PackagesBoard.jsx). Monday, Wednesday and
# Friday as Python numbers them.
CLASS_WEEKDAYS = {0, 2, 4}
# Read in local time, not UTC: at 9pm on a Friday in India, UTC has not reached Friday's
# end but the class has been and gone -- and on a Monday morning UTC is still on Sunday,
# which would report no class on a day the room is full.
IST = timezone(timedelta(hours=5, minutes=30))


def _is_class_day_today() -> bool:
    return datetime.now(IST).weekday() in CLASS_WEEKDAYS


# What a master keeps of the fees their students paid. The other half is Fitsiomax's,
# taken as the remainder rather than a second multiplication so the two always add back up
# to exactly what was collected -- this figure is somebody's pay.
MASTER_SHARE = 0.5


async def require_zumba_reader(user: V3UserOut = Depends(v3_current_user)) -> V3UserOut:
    """Who may read and keep the class roll: the branch that runs it, the Zumba desk that
    fills it, and Super Admin. Written as a predicate rather than a role tuple because the
    Zumba role's slug is typed by hand and varies by install."""
    if is_branch_admin_role(user.role) or is_zumba_role(user.role):
        return user
    raise HTTPException(status_code=403, detail="Not allowed")


def _source(value) -> str:
    slug = str(value or "").strip().lower()
    slug = LEGACY_SOURCES.get(slug, slug)
    return slug if slug in SOURCES else DEFAULT_SOURCE


def _amount(value) -> float:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return amount if amount > 0 else 0.0


def _age(value) -> Optional[int]:
    """Blank rather than 0 when it is not known — a Zumba class takes anyone, and a 0 in an
    age column reads as a fact about the person rather than as a gap in the record."""
    try:
        age = int(value)
    except (TypeError, ValueError):
        return None
    return age if 0 < age < 120 else None


class ZumbaInput(BaseModel):
    name: str
    phone: Optional[str] = ""
    age: Optional[int] = None
    address: Optional[str] = ""
    source: Optional[str] = DEFAULT_SOURCE
    # Only meaningful when source is "master"; dropped otherwise, so moving the source off
    # a referral cannot leave a stale master's name attached to the row.
    master_name: Optional[str] = ""
    # Which master's class this student sits in. Kept apart from master_name on purpose:
    # master_name records who *referred* them, which a master writes for themselves, while
    # this records who *teaches* them, which only a Branch Admin decides. A master's board
    # reads this one, so referring somebody cannot put them on your own roll.
    assigned_master_id: Optional[str] = ""
    email: Optional[str] = ""
    gender: Optional[str] = ""
    # Which of the two class slots they attend, and the membership they bought -- the
    # package's own name and id off the Zumba shelf, so a renamed or repriced package
    # cannot rewrite what this student was actually sold.
    time_slot: Optional[str] = ""
    package_id: Optional[str] = ""
    package_name: Optional[str] = ""
    fee_amount: Optional[float] = 0
    fee_paid: Optional[float] = 0
    # Where the registration sits in the Zumba pipeline. Left unset it starts at the entry
    # stage; a name the pipeline no longer has falls back there too.
    stage: Optional[str] = None


class ZumbaStageInput(BaseModel):
    stage: str


def _own_branch_only(user: V3UserOut) -> bool:
    """Everyone but Super Admin reads one branch: their own.

    A Zumba master runs the class at the branch they were hired into, so they are scoped
    exactly as the Branch Admin above them is. Super Admin is the only account that may
    ask for another branch, or for all of them at once.
    """
    if user.role == "super_admin":
        return False
    return is_branch_admin_role(user.role) or is_zumba_role(user.role)


def _scoped_branch(user: V3UserOut, branch_id: Optional[str]) -> Optional[str]:
    """Branch Admin and the Zumba desk are locked to their own branch; Super Admin may pass
    one or omit it to see every branch at once, the same rule the finance and board
    endpoints use."""
    if _own_branch_only(user):
        return user.branch_id
    return branch_id


# The class runs out of one branch today, so a Zumba account created without a branch of
# its own writes here rather than being told to "pick a branch" by a form that offers no
# way to pick one.
#
# A default, not a rule: an account that HAS a branch keeps writing to its own, and giving
# the account its branch in HR makes this line dead weight. Matched on the name at write
# time rather than pinned to an id, so the branch can be recreated without a migration.
DEFAULT_ZUMBA_BRANCH_NAME = "Anna Nagar"


def _normalized(name: Optional[str]) -> str:
    """A branch name reduced to the letters and digits in it, for comparing by hand."""
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


async def _default_branch_id() -> Optional[str]:
    """The branch a Zumba account with none of its own reads and writes.

    Matched loosely -- case, spaces and punctuation removed -- because a branch is named by
    hand and "Anna Nagar", "ANNA NAGAR" and "Anna-Nagar" are one place. An exact match on
    that reduced form wins; failing that, the first name that starts with it, so a branch
    saved as "Anna Nagar Clinic" still answers while "Nagarjuna" never does.

    Sorted by name before either pass, so if two branches could answer, the same one
    answers every time rather than whichever Mongo happened to return first.
    """
    wanted = _normalized(DEFAULT_ZUMBA_BRANCH_NAME)
    rows = await v3_col("branches").find({}, {"_id": 0, "id": 1, "branch_name": 1}).to_list(500)
    rows.sort(key=lambda b: (b.get("branch_name") or "").lower())
    for row in rows:
        if _normalized(row.get("branch_name")) == wanted:
            return row.get("id")
    for row in rows:
        if _normalized(row.get("branch_name")).startswith(wanted):
            return row.get("id")
    return None


async def _branch_label(branch_id: Optional[str]) -> dict:
    """The branch this board is actually reading, named -- so the screen can say which one
    rather than leaving a master to trust that "your branch" meant the right place."""
    if not branch_id:
        return {"id": "", "name": ""}
    row = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0, "branch_name": 1})
    return {"id": branch_id, "name": (row or {}).get("branch_name") or ""}


async def _branch_for(user: V3UserOut, branch_id: Optional[str]) -> Optional[str]:
    """The branch this request reads and writes, falling back for a branchless master.

    Only the Zumba desk falls back. A Branch Admin without a branch is a broken account and
    should read nothing rather than quietly be handed somebody else's branch, which is what
    it has always done.
    """
    scoped = _scoped_branch(user, branch_id)
    if scoped or not (_own_branch_only(user) and is_zumba_role(user.role)):
        return scoped
    return await _default_branch_id()


def _shape(row: dict, stages: Optional[list] = None) -> dict:
    """The stored row plus the card it counts towards, worked out here so the list and the
    summary can never disagree about where a registration belongs.

    The stage is settled against the live pipeline for the same reason: a registration
    written before Super Admin added the pipeline, or holding a stage since deleted, reads
    as sitting at the entry stage rather than at a name the board no longer draws.
    """
    source = _source(row.get("source"))
    card = CARD_OF_SOURCE.get(source, "direct")
    shaped = {**row, "source": source, "card": card}
    if stages is not None:
        shaped["stage"] = _settle_stage(row.get("stage"), stages, card)
    return shaped


def _master_of(row: dict) -> str:
    return (row.get("master_name") or "").strip()


async def _zumba_stages() -> list:
    """The Zumba pipeline as Super Admin has it in CI/CD ROOTS.

    Read on every request rather than cached: renaming a stage there rewrites the name on
    every registration holding it (see v3_stages.py), so the list here has to be whatever
    that screen says right now. An empty list is a legitimate answer — a clinic that has
    not set the pipeline up simply has no stages, and the tab shows none.
    """
    await ensure_zumba_stages()
    return await v3_col("pipeline_stages").find(
        {"type": "zumba"}, {"_id": 0}
    ).sort("order", 1).to_list(100)


async def ensure_zumba_stages() -> None:
    """Seed the pipeline from the branch tab's cards, once, while it is empty.

    Only ever when there is nothing there. The names are the Super Admin's to change from
    the moment they exist, and re-seeding over a curated list would undo that every time
    somebody opened the screen.
    """
    if await v3_col("pipeline_stages").count_documents({"type": "zumba"}) > 0:
        return
    await v3_col("pipeline_stages").insert_many([
        {
            "id": str(uuid.uuid4()),
            "name": name,
            "color": color,
            "type": "zumba",
            "order": order,
            "is_final": False,
            # Which card this stage mirrors, stored rather than matched by name — so
            # renaming Direct to "Walked In" keeps new walk-ins starting there instead of
            # quietly sending them to the top of the list.
            "card": card,
            "created_at": now_iso(),
        }
        for order, (name, card, color) in enumerate(ZUMBA_STAGE_CARDS)
    ])


def _entry_stage(stages: list, card: Optional[str] = None) -> str:
    """Where a registration starts.

    The stage mirroring its card, if the pipeline still has one — a walk-in opens at
    Direct, a consultation referral at Consultant — else the first stage in the order, as
    anything without a card to go on always did. Blank while the pipeline is empty, which
    is honest: there is nowhere for it to start yet.
    """
    if card in START_CARDS:
        for st in stages:
            if stage_card(st) == card:
                return st["name"]
    return stages[0]["name"] if stages else ""


def _settle_stage(value, stages: list, card: Optional[str] = None) -> str:
    """A stage the pipeline actually has, or where this registration starts.

    Names are matched case-insensitively but the pipeline's own spelling is what gets
    stored, so a stage renamed in CI/CD ROOTS stays matchable and the value on the row is
    always one the pipeline recognises. Anything unrecognised — nothing stored yet, or a
    stage since deleted — falls to the start for its card rather than to the top of the
    list, so a walk-in and a consultation referral do not both open at the same place.
    """
    wanted = str(value or "").strip().lower()
    for st in stages:
        if st["name"].strip().lower() == wanted:
            return st["name"]
    return _entry_stage(stages, card)


def _visible_query(user: V3UserOut, branch_id: Optional[str]) -> Optional[dict]:
    """Which registrations this account may read, or None when that is none of them.

    A Zumba master reads their own roll and nothing else: the students a Branch Admin put
    in their class, whatever branch the row was entered against. Not their branch's whole
    book, and not the students they themselves referred -- a referral says who brought
    somebody in, which is a claim on the lead, not a seat in a class. A master who refers
    ten people has an empty board until the branch assigns them, which is the intended
    reading and not a misconfiguration.

    Everyone else -- Branch Admin, Super Admin -- is read by branch, unchanged.
    """
    if is_zumba_role(user.role):
        return {"assigned_master_id": user.id}
    if branch_id:
        return {"branch_id": branch_id}
    # Super Admin asking for every branch at once. Anyone else with nothing to scope by
    # reads nothing, which the caller turns into an empty board.
    return None if _own_branch_only(user) else {}


def _extra(lead: dict, *keys):
    """Age and address are configured lead fields rather than columns, so they arrive in
    extra_fields under whatever key the branch set up. Try the likely ones and give up
    quietly — a blank age is a gap in the record, not a reason to fail the list."""
    extra = lead.get("extra_fields") or {}
    for k in keys:
        for candidate in (k, k.title(), k.upper(), k.replace("_", " ").title()):
            if extra.get(candidate) not in (None, ""):
                return extra[candidate]
    return ""


async def _referred_rows(branch_id: Optional[str], entry_stage: str = "") -> list:
    """Zumba referrals made by a CONSULTANT, read off the leads rather than copied here.

    A referral is a decision recorded on the consultation, so this reads it live instead of
    writing a registration at Save & Move. Un-ticking Zumba on the decision takes the row
    back out on its own, and there is no second copy of the patient to keep in step with
    the first. The cost is that these rows cannot be edited or deleted from this tab, which
    is right: the consultation owns them.
    """
    query = {"zumba_recommended": True}
    if branch_id:
        query["branch_id"] = branch_id
    leads = await v3_col("leads").find(query, {
        "_id": 0, "id": 1, "name": 1, "phone": 1, "branch_id": 1, "extra_fields": 1,
        "zumba_package_name": 1, "zumba_package_price": 1, "zumba_package_sessions": 1,
        "updated_at": 1,
    }).to_list(2000)
    if not leads:
        return []

    # When the referral was made: the moment the decision holding it was last saved. Read
    # from the activity trail rather than from a field, so nothing has to be written into
    # the consultation's own save path to support this tab.
    activities = await v3_col("lead_activity").find(
        {"lead_id": {"$in": [l["id"] for l in leads]}, "action": "consultation_decision_saved"},
        {"_id": 0, "lead_id": 1, "created_at": 1},
    ).to_list(4000)
    saved_at = {}
    for a in activities:
        prev = saved_at.get(a["lead_id"])
        if not prev or (a.get("created_at") or "") > prev:
            saved_at[a["lead_id"]] = a.get("created_at") or ""

    rows = []
    for l in leads:
        rows.append({
            # Prefixed so it cannot collide with a registration's uuid, and so the frontend
            # can tell at a glance that this row is not one of its own.
            "id": f"lead:{l['id']}",
            "lead_id": l["id"],
            "branch_id": l.get("branch_id"),
            "name": l.get("name") or "",
            "phone": l.get("phone") or "",
            "age": _age(_extra(l, "age")),
            "address": str(_extra(l, "address", "city", "location") or ""),
            "source": "consultations",
            "card": "consultant",
            "master_name": "",
            # What the package costs. Nothing is collected here: a referred patient pays
            # through the consultation's own fee steps, and reporting money as in the
            # drawer because a package was named would be a lie the accountant inherits.
            "fee_amount": _amount(l.get("zumba_package_price")),
            "fee_paid": 0.0,
            "package_name": l.get("zumba_package_name") or "",
            "package_sessions": l.get("zumba_package_sessions"),
            "created_at": saved_at.get(l["id"]) or l.get("updated_at") or "",
            "created_by": "Consultation",
            # At the pipeline's entry stage and staying there. The row is read off the
            # lead, so there is nothing here to write a move onto — moving it would mean
            # copying the patient into this collection, which is what reading live avoids.
            "stage": entry_stage,
            # The tab reads this and offers no Edit or Delete: the consultation owns it.
            "origin": "consultation",
        })
    return rows


@router.get("/branch/zumba")
async def list_zumba(
    branch_id: Optional[str] = Query(None),
    user: V3UserOut = Depends(require_zumba_reader),
):
    branch_id = await _branch_for(user, branch_id)
    query = _visible_query(user, branch_id)
    if query is None:
        return {
            "summary": {},
            "registrations": [],
            "masters": [],
            "stages": [],
            "branch": await _branch_label(branch_id),
        }

    stages = await _zumba_stages()
    entry_stage = _entry_stage(stages)

    raw = await v3_col("zumba_registrations").find(query, {"_id": 0}).to_list(2000)
    # A consultant's referral carries no master, so it can only be scoped by branch. An
    # account with no branch to scope by gets none of them rather than every branch's.
    # A master never sees these: nobody has assigned them to a class yet, so they belong
    # to the branch's inbox rather than to anybody's roll.
    referred = []
    if not is_zumba_role(user.role) and (branch_id or not _own_branch_only(user)):
        referred = await _referred_rows(branch_id, entry_stage)
    rows = [_shape(r, stages) for r in raw] + referred
    # Sorted after the merge, not before: two sources of rows interleave by date the way
    # one would, rather than arriving as two blocks.
    rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)

    # today_session is who is booked into today's class, not who turned up: the class runs
    # Mon/Wed/Fri and a member is booked into every one of them, so on a class day it is the
    # whole roll and on any other day there is no class to be booked into. Nothing here
    # reads attendance, which is not recorded -- a member who skips a Friday still counts,
    # because they held the seat.
    class_day = _is_class_day_today()
    summary = {"all": len(rows), "fee_collected": 0, "fee_total": 0.0}
    summary["today_session"] = len(rows) if class_day else 0
    summary["is_class_day"] = class_day
    for card in CARDS:
        summary[card] = 0
    for r in rows:
        summary[r["card"]] += 1
        paid = _amount(r.get("fee_paid"))
        if paid > 0:
            summary["fee_collected"] += 1
            summary["fee_total"] += paid

    # Worked out here, not on each board, so the master's Payment card and the Branch
    # Admin's Master's Revenue card cannot drift apart: they are reading one number.
    summary["master_revenue"] = round(summary["fee_total"] * MASTER_SHARE, 2)
    summary["fitsiomax_revenue"] = round(summary["fee_total"] - summary["master_revenue"], 2)

    # The masters this branch has actually been referred by, gathered off the registrations
    # themselves. No separate roster to keep in step with reality: a name typed once is
    # offered from then on, and a master nobody has referred anybody never clutters it.
    masters = sorted(
        {_master_of(r) for r in rows if r["source"] == MASTER and _master_of(r)},
        key=str.lower,
    )

    # Counted by name rather than by id, which is what the registrations hold and what a
    # rename in CI/CD ROOTS rewrites. A stage nobody is at still reports 0 rather than
    # going missing from the bar.
    stage_counts = {st["name"]: 0 for st in stages}
    for r in rows:
        if r.get("stage") in stage_counts:
            stage_counts[r["stage"]] += 1
    summary["stage_counts"] = stage_counts

    return {
        "summary": summary,
        "registrations": rows,
        "masters": masters,
        "stages": stages,
        "branch": await _branch_label(branch_id),
    }


async def _assignment(payload: ZumbaInput, user: V3UserOut) -> dict:
    """The master this student is assigned to, resolved to id and name.

    Empty for a Zumba master: assigning is the Branch Admin's call, and a master posting
    their own referral must not be able to put themselves on the roll -- that is exactly
    the thing the assignment is meant to keep out. Returning no keys at all rather than
    blank ones also means a master editing a row leaves the branch's assignment alone
    instead of clearing it.

    The name is stored beside the id so a board can print it without a second read, while
    the id stays the thing that is matched on -- a master who is renamed keeps their roll.
    """
    if is_zumba_role(user.role):
        return {}
    master_id = (payload.assigned_master_id or "").strip()
    if not master_id:
        return {"assigned_master_id": "", "assigned_master_name": ""}
    account = await v3_col("users").find_one(
        {"id": master_id}, {"_id": 0, "full_name": 1, "email": 1}
    )
    if not account:
        raise HTTPException(status_code=400, detail="That master no longer has an account")
    return {
        "assigned_master_id": master_id,
        "assigned_master_name": (account.get("full_name") or account.get("email") or "").strip(),
    }


async def _clean(payload: ZumbaInput, user: V3UserOut) -> dict:
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    source = _source(payload.source)
    master_name = (payload.master_name or "").strip()
    # A master referring from their own board signs the row with their own name, so when
    # that name is missing it is because the account was created without one -- not because
    # the question went unanswered. Signing it with the account instead of refusing keeps
    # the referral on the branch's Refer Master card, which is the whole point of sending
    # it; an account with no name at all is the only case left to refuse.
    if source == MASTER and not master_name and is_zumba_role(user.role):
        master_name = (user.full_name or user.email or "").strip()
    if source == MASTER and not master_name:
        raise HTTPException(status_code=400, detail="Which master referred them?")

    gender = (payload.gender or "").strip().lower()
    time_slot = (payload.time_slot or "").strip()

    return {
        "name": name,
        "phone": (payload.phone or "").strip(),
        "email": (payload.email or "").strip(),
        "age": _age(payload.age),
        "gender": gender if gender in GENDERS else "",
        "address": (payload.address or "").strip(),
        "time_slot": time_slot if time_slot in TIME_SLOTS else "",
        "package_id": (payload.package_id or "").strip(),
        "package_name": (payload.package_name or "").strip(),
        "source": source,
        "master_name": master_name if source == MASTER else "",
        "fee_amount": _amount(payload.fee_amount),
        "fee_paid": _amount(payload.fee_paid),
        "stage": _settle_stage(payload.stage, await _zumba_stages(), CARD_OF_SOURCE.get(source, "direct")),
        **await _assignment(payload, user),
    }


@router.get("/branch/zumba/masters")
async def list_zumba_masters(
    branch_id: Optional[str] = Query(None),
    user: V3UserOut = Depends(require_zumba_reader),
):
    """The Zumba master accounts at this branch, for the Branch Admin's assign control.

    Sifted in Python rather than queried by a role literal because the slug is whatever was
    typed in Roles & Credentials -- "zumba" on this install, "zumba_master" on the next --
    and is_zumba_role is the one place that knows both read as the Zumba desk.

    A branch with no master accounts comes back empty and the control says so, rather than
    offering a dropdown that assigns students to nobody.
    """
    branch_id = await _branch_for(user, branch_id)
    query: dict = {"is_active": {"$ne": False}}
    if branch_id:
        query["branch_id"] = branch_id
    rows = await v3_col("users").find(
        query, {"_id": 0, "id": 1, "full_name": 1, "email": 1, "role": 1}
    ).sort("full_name", 1).to_list(200)
    # Super Admin excluded deliberately. is_zumba_role answers "may this account reach the
    # Zumba desk", which Super Admin may, not "is this person a master who teaches a class",
    # which they are not -- and this list is the one that hands students to somebody.
    return [
        {"id": r["id"], "name": (r.get("full_name") or r.get("email") or "").strip()}
        for r in rows
        if (r.get("role") or "") != "super_admin" and is_zumba_role(r.get("role") or "")
    ]


async def _write_branch(user: V3UserOut, branch_id: Optional[str]) -> Optional[str]:
    """The branch a new registration is filed against.

    Unlike reading, a Zumba master may name one: a referral is handed to whoever runs the
    class nearest the person, which is not always the branch the master is on. It widens
    nothing they can see -- a master's board reads assignments, not branches -- so filing a
    referral elsewhere still leaves the receiving branch to decide whose class it becomes.

    Checked against the branches that exist, so a stale id from a form left open writes a
    row nobody's board reads rather than being told the branch is gone.
    """
    if branch_id and is_zumba_role(user.role):
        exists = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0, "id": 1})
        if not exists:
            raise HTTPException(status_code=400, detail="That branch no longer exists")
        return branch_id
    return await _branch_for(user, branch_id)


@router.post("/branch/zumba")
async def add_zumba(
    payload: ZumbaInput,
    branch_id: Optional[str] = Query(None),
    user: V3UserOut = Depends(require_zumba_reader),
):
    branch_id = await _write_branch(user, branch_id)
    if not branch_id:
        raise HTTPException(status_code=400, detail="Pick a branch to register against")

    row = {
        "id": str(uuid.uuid4()),
        "branch_id": branch_id,
        **await _clean(payload, user),
        "created_at": now_iso(),
        "created_by": user.full_name or user.email,
    }
    await v3_col("zumba_registrations").insert_one(dict(row))
    return _shape(row)


@router.patch("/branch/zumba/{registration_id}")
async def update_zumba(
    registration_id: str,
    payload: ZumbaInput,
    user: V3UserOut = Depends(require_zumba_reader),
):
    existing = await v3_col("zumba_registrations").find_one({"id": registration_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Registration not found")
    # A Branch Admin or a Zumba master edits their own branch's registrations, nobody else's.
    if _own_branch_only(user) and existing.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=403, detail="Not your branch")

    changes = {
        **await _clean(payload, user),
        "updated_at": now_iso(),
        "updated_by": user.full_name or user.email,
    }
    await v3_col("zumba_registrations").update_one({"id": registration_id}, {"$set": changes})
    return _shape({**existing, **changes})


@router.patch("/branch/zumba/{registration_id}/stage")
async def move_zumba_stage(
    registration_id: str,
    payload: ZumbaStageInput,
    user: V3UserOut = Depends(require_zumba_reader),
):
    """Move one registration along the Zumba pipeline.

    Its own route rather than a field on the edit form: moving somebody through the class
    is the thing done daily, from a dropdown in the list, and routing it through the full
    payload would mean the rest of the record had to be sent along to change one word.
    """
    existing = await v3_col("zumba_registrations").find_one({"id": registration_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Registration not found")
    if _own_branch_only(user) and existing.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=403, detail="Not your branch")

    stages = await _zumba_stages()
    if not stages:
        raise HTTPException(status_code=400, detail="No Zumba stages yet — Super Admin sets them up in CI/CD ROOTS")
    wanted = str(payload.stage or "").strip().lower()
    if not any(st["name"].strip().lower() == wanted for st in stages):
        raise HTTPException(status_code=400, detail="That stage is not in the Zumba pipeline")

    stage = _settle_stage(payload.stage, stages)
    await v3_col("zumba_registrations").update_one({"id": registration_id}, {"$set": {
        "stage": stage,
        "updated_at": now_iso(),
        "updated_by": user.full_name or user.email,
    }})
    return _shape({**existing, "stage": stage}, stages)


@router.delete("/branch/zumba/{registration_id}")
async def delete_zumba(
    registration_id: str,
    user: V3UserOut = Depends(require_zumba_reader),
):
    existing = await v3_col("zumba_registrations").find_one({"id": registration_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Registration not found")
    if _own_branch_only(user) and existing.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=403, detail="Not your branch")
    await v3_col("zumba_registrations").delete_one({"id": registration_id})
    return {"deleted": True}
