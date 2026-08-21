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

# What has become of a student, where that is anything other than still attending.
#
# Active is the absence of the other two rather than a value anybody sets, so a row written
# before this existed reads as active without a migration. Both of the others carry a
# reason: a class roll that shrinks says nothing on its own, and "why" is the whole of what
# the branch wants back from it a month later.
STATUS_ACTIVE = "active"
STATUS_DISCONTINUED = "discontinued"
STATUS_LEAVE = "leave"
STATUSES = (STATUS_ACTIVE, STATUS_DISCONTINUED, STATUS_LEAVE)
ENDED_STATUSES = (STATUS_DISCONTINUED, STATUS_LEAVE)


def _status(value) -> str:
    slug = str(value or "").strip().lower()
    return slug if slug in STATUSES else STATUS_ACTIVE


# When the class this student joins meets. Two slots, stored as they read, because they are
# a label on a registration rather than a booking anything schedules against -- the class
# itself is fixed at Mon/Wed/Fri. Anything else is dropped rather than stored, so the column
# can never hold a time no class runs at.
TIME_SLOTS = ("10:00 am - 11:00 am", "11:00 am - 12:00 pm")

# Recorded as typed, from a fixed set. Unset stays unset: a blank is "not asked", which is
# a different thing from any of the three answers.
GENDERS = ("female", "male", "other")

# How the class fee was taken. The same four the consultation and store desks offer, in the
# same slugs, so one student's cash reads as cash wherever the money is later counted.
# Cheque and Partial are deliberately not here: those belong to a treatment plan paid down
# over months, and a class membership is settled in one go.
PAYMENT_MODES = ("cash", "upi", "card", "account_transfer")

# The modes that leave a trail somewhere else -- a UPI handle, a card or bank transaction
# number -- and so must carry the thing a dispute is traced by. Cash leaves none, which is
# why it is not here rather than an oversight.
REFERENCE_MODES = ("upi", "card", "account_transfer")

# What to call that trail, per mode. A UPI ID and a transaction number are different kinds
# of thing, so the field says which is wanted rather than asking for a generic "reference"
# and leaving the desk to guess.
REFERENCE_LABELS = {
    "upi": "UPI ID",
    "card": "transaction ID",
    "account_transfer": "transaction ID",
}

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
    # How the fee was taken. Only meaningful once something has been collected, and cleared
    # when nothing has, so a mode can never sit against a registration that has paid zero.
    payment_mode: Optional[str] = ""
    # The UPI ID or transaction number behind that mode. Meaningless for cash, and dropped
    # with the mode when nothing has been collected.
    payment_reference: Optional[str] = ""
    package_id: Optional[str] = ""
    package_name: Optional[str] = ""
    fee_amount: Optional[float] = 0
    fee_paid: Optional[float] = 0
    # Where the registration sits in the Zumba pipeline. Left unset it starts at the entry
    # stage; a name the pipeline no longer has falls back there too.
    stage: Optional[str] = None


class ZumbaStatusInput(BaseModel):
    status: str
    remarks: Optional[str] = ""


class ZumbaStageInput(BaseModel):
    stage: str


def _is_master_account(user: V3UserOut) -> bool:
    """Whether this account IS a Zumba master, rather than merely being allowed to reach
    the Zumba desk.

    is_zumba_role answers True for Super Admin, deliberately, so they can read every board
    in the OS. That is a question about reach. Whose class roll this is, whose branch this
    is, and whose students these are, are questions about identity, and answering them with
    the reach predicate handed Super Admin a query for their own assigned students -- of
    which there are none -- so the Zumba tab read empty at every branch while the Branch
    Admin under them saw the class perfectly well.
    """
    return user.role != "super_admin" and is_zumba_role(user.role)


def _own_branch_only(user: V3UserOut) -> bool:
    """Everyone but Super Admin reads one branch: their own.

    A Zumba master runs the class at the branch they were hired into, so they are scoped
    exactly as the Branch Admin above them is. Super Admin is the only account that may
    ask for another branch, or for all of them at once.
    """
    if user.role == "super_admin":
        return False
    return is_branch_admin_role(user.role) or _is_master_account(user)


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
    if scoped or not _is_master_account(user):
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
    shaped["status"] = _status(row.get("status"))
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
    if _is_master_account(user):
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
    the first. The cost is that a live row cannot be edited from this tab, which is why
    accept_referral exists: the branch takes the patient over, and from then on the
    registration is the row and this stops reading the lead.
    """
    query = {"zumba_recommended": True}
    if branch_id:
        query["branch_id"] = branch_id
    leads = await v3_col("leads").find(query, {
        "_id": 0, "id": 1, "name": 1, "phone": 1, "branch_id": 1, "extra_fields": 1,
        "zumba_package_id": 1, "zumba_package_name": 1, "zumba_package_price": 1,
        "zumba_package_sessions": 1, "updated_at": 1,
    }).to_list(2000)
    if not leads:
        return []

    # Dropped once the branch has taken them over. Read from the registrations rather than
    # written back onto the lead, so the consultation's own record is never edited by this
    # tab and un-ticking Zumba there still means what it always did.
    taken = set(await v3_col("zumba_registrations").distinct(
        "lead_id", {"lead_id": {"$in": [l["id"] for l in leads]}}
    ))
    leads = [l for l in leads if l["id"] not in taken]
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
            # The catalogue item itself, not just what it was called. Carrying the id is
            # what lets the branch's own form open this row with the membership already
            # picked -- without it the row names a package the form cannot find, and the
            # branch is asked to choose one that was chosen at the consultation.
            "package_id": l.get("zumba_package_id") or "",
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


# A referral's row carries the lead's id under this prefix (see _referred_rows), so an id
# arriving with it is not a registration that has gone missing -- it is a row that was never
# in this collection, and "not found" sends the reader looking for a deletion that never
# happened.
LEAD_ROW_PREFIX = "lead:"


async def _registration_or_400(registration_id: str) -> dict:
    """The registration this id names, or the reason there is none.

    Split out of the four routes that each did the lookup themselves, because the answer for
    a lead-backed row is the same in all four and it is not "not found": the consultation
    owns that record, and it is edited, ended and removed there. Said once here, so a client
    running an older bundle is told what happened rather than told to go hunting.
    """
    if str(registration_id or "").startswith(LEAD_ROW_PREFIX):
        raise HTTPException(
            status_code=400,
            detail="This is a Consultant's referral, read live from the consultation that made it. Change it there — un-ticking Zumba on the lead takes it off this tab.",
        )
    existing = await v3_col("zumba_registrations").find_one({"id": registration_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Registration not found")
    return existing


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
    if not _is_master_account(user) and (branch_id or not _own_branch_only(user)):
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

    # A student who has discontinued has left the class, so they are counted on their own
    # card and on no other -- not in All, not under the source that brought them in, and
    # not among who owes money. A count of All that includes people who have gone is a roll
    # nobody can staff a class from, and Due Payment listing them turns a card somebody
    # works from into a list of calls not worth making.
    #
    # Leave is deliberately not the same. They are expected back, so they stay on the roll
    # and in every count that describes it. What they are out of is today's class, which is
    # the one figure that asks who is actually in the room.
    on_roll = [r for r in rows if _status(r.get("status")) != STATUS_DISCONTINUED]
    in_class = [r for r in on_roll if _status(r.get("status")) != STATUS_LEAVE]

    # today_session is who is booked into today's class, not who turned up: the class runs
    # Mon/Wed/Fri and a member is booked into every one of them, so on a class day it is the
    # whole roll and on any other day there is no class to be booked into. Nothing here
    # reads attendance, which is not recorded -- a member who skips a Friday still counts,
    # because they held the seat.
    summary = {"all": len(on_roll), "fee_collected": 0, "fee_total": 0.0}
    summary["today_session"] = len(in_class) if class_day else 0
    summary["is_class_day"] = class_day
    # The four the branch tab counts alongside the sources: where the money stands, and who
    # has stopped coming. Payment Done is a settled account rather than "paid something" --
    # a student who has handed over half of a 3,000 rupee membership is the Due Payment
    # card's business, not this one's. A row with no fee on it at all is neither: nothing
    # has been sold yet, so there is nothing to have settled or to owe.
    summary["payment_done"] = 0
    summary["due_payment"] = 0
    summary["discontinued"] = 0
    summary["leave"] = 0
    for card in CARDS:
        summary[card] = 0
    for r in rows:
        status = _status(r.get("status"))
        if status == STATUS_DISCONTINUED:
            # Counted here and nowhere else, money included: a fee still owed by somebody
            # who has left is not the branch's collectable, and the card that lists what to
            # chase should not send anyone after it.
            summary["discontinued"] += 1
            continue
        if status == STATUS_LEAVE:
            summary["leave"] += 1
        summary[r["card"]] += 1
        owed = _amount(r.get("fee_amount"))
        settled = _amount(r.get("fee_paid"))
        if owed > 0 and settled >= owed:
            summary["payment_done"] += 1
        elif owed > settled:
            summary["due_payment"] += 1
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
    for r in on_roll:
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
    if _is_master_account(user):
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
    if source == MASTER and not master_name and _is_master_account(user):
        master_name = (user.full_name or user.email or "").strip()
    if source == MASTER and not master_name:
        raise HTTPException(status_code=400, detail="Which master referred them?")

    gender = (payload.gender or "").strip().lower()
    time_slot = (payload.time_slot or "").strip()
    payment_mode = (payload.payment_mode or "").strip().lower()
    fee_paid = _amount(payload.fee_paid)
    if payment_mode not in PAYMENT_MODES or fee_paid <= 0:
        payment_mode = ""
    payment_reference = (payload.payment_reference or "").strip()
    if payment_mode in REFERENCE_MODES and not payment_reference:
        raise HTTPException(status_code=400, detail=f"Enter the {REFERENCE_LABELS[payment_mode]}")
    if payment_mode not in REFERENCE_MODES:
        # Cash keeps no reference, and neither does a row with no mode left on it.
        payment_reference = ""

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
        "fee_paid": fee_paid,
        # Tied to the money rather than kept as a free-standing preference: dropping the
        # collected amount to zero drops the mode with it, so a row can never claim cash
        # was taken while reporting that nothing was.
        "payment_mode": payment_mode,
        "payment_reference": payment_reference,
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
    if branch_id and _is_master_account(user):
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


@router.post("/branch/zumba/accept/{lead_id}")
async def accept_referral(
    lead_id: str,
    user: V3UserOut = Depends(require_zumba_reader),
):
    """Take a CONSULTANT's referral onto the branch's own books.

    Until this is called the row on the tab is the lead, read live, and there is nothing to
    assign a master to, set a class time on, or collect a fee against -- which is the whole
    of what the branch does next with a referred patient. This writes the registration that
    those answers can live on, seeded from what the consultation already decided: the
    patient, and the package it recommended.

    The lead is not touched. The link runs one way, from the registration back to the lead,
    so the consultation's record still says what it always said and un-ticking Zumba there
    still means what it meant. What changes is that this tab stops reading the lead for a
    row and reads the registration instead.

    Nothing is collected here either: fee_amount carries the package's price so the branch
    knows what to ask for, and fee_paid stays at zero until somebody actually records a
    payment on it.
    """
    lead = await v3_col("leads").find_one(
        {"id": lead_id, "zumba_recommended": True},
        {"_id": 0, "id": 1, "name": 1, "phone": 1, "branch_id": 1, "extra_fields": 1,
         "zumba_package_id": 1, "zumba_package_name": 1, "zumba_package_price": 1,
         "zumba_package_sessions": 1},
    )
    if not lead:
        raise HTTPException(status_code=404, detail="No Zumba referral on that lead")

    branch_id = lead.get("branch_id")
    if _own_branch_only(user) and branch_id != user.branch_id:
        raise HTTPException(status_code=403, detail="Not your branch")
    if not branch_id:
        raise HTTPException(status_code=400, detail="That lead is not posted to a branch")

    existing = await v3_col("zumba_registrations").find_one({"lead_id": lead_id}, {"_id": 0})
    if existing:
        # Not an error: two people opening the same row is ordinary, and the second one
        # wants the registration rather than a complaint about the first.
        return _shape(existing, await _zumba_stages())

    stages = await _zumba_stages()
    row = {
        "id": str(uuid.uuid4()),
        "branch_id": branch_id,
        # The link back, and the reason _referred_rows stops reading this lead.
        "lead_id": lead_id,
        "name": (lead.get("name") or "").strip(),
        "phone": (lead.get("phone") or "").strip(),
        "email": "",
        "age": _age(_extra(lead, "age")),
        "gender": "",
        "address": str(_extra(lead, "address", "city", "location") or ""),
        "source": "consultations",
        "master_name": "",
        "assigned_master_id": "",
        "assigned_master_name": "",
        "time_slot": "",
        "package_id": lead.get("zumba_package_id") or "",
        "package_name": lead.get("zumba_package_name") or "",
        "package_sessions": lead.get("zumba_package_sessions"),
        "fee_amount": _amount(lead.get("zumba_package_price")),
        "fee_paid": 0.0,
        "payment_mode": "",
        "payment_reference": "",
        "status": STATUS_ACTIVE,
        "stage": _entry_stage(stages, "consultant"),
        "created_at": now_iso(),
        "created_by": user.full_name or user.email,
    }
    await v3_col("zumba_registrations").insert_one(dict(row))
    return _shape(row, stages)


@router.patch("/branch/zumba/{registration_id}")
async def update_zumba(
    registration_id: str,
    payload: ZumbaInput,
    user: V3UserOut = Depends(require_zumba_reader),
):
    existing = await _registration_or_400(registration_id)
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
    existing = await _registration_or_400(registration_id)
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


@router.patch("/branch/zumba/{registration_id}/status")
async def set_zumba_status(
    registration_id: str,
    payload: ZumbaStatusInput,
    user: V3UserOut = Depends(require_zumba_reader),
):
    """Record that a student has discontinued or gone on leave, and why.

    The reason is required, not optional. A roll that quietly shrinks answers none of the
    questions asked of it a month later -- whether the class lost people to the timing, the
    price or the teaching is exactly what these two counts are for, and a blank remark
    turns the card into a number nobody can act on.

    Putting somebody back on the roll is the same route with status active, and that one
    needs no reason: returning to the class is the normal state resuming, not an event.
    """
    existing = await _registration_or_400(registration_id)
    if _own_branch_only(user) and existing.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=403, detail="Not your branch")

    status = str(payload.status or "").strip().lower()
    if status not in STATUSES:
        raise HTTPException(status_code=400, detail=f"Status must be one of: {', '.join(STATUSES)}")

    remarks = (payload.remarks or "").strip()
    if status in ENDED_STATUSES and not remarks:
        raise HTTPException(status_code=400, detail="Say why, so the card can be read as a reason rather than a number")

    changes = {
        "status": status,
        # Cleared on a return rather than left behind: an old reason sitting on somebody
        # back in class reads as current, and the history is the activity log's job.
        "status_remarks": remarks if status in ENDED_STATUSES else "",
        "status_at": now_iso() if status in ENDED_STATUSES else "",
        "status_by": (user.full_name or user.email or "") if status in ENDED_STATUSES else "",
        "updated_at": now_iso(),
        "updated_by": user.full_name or user.email,
    }
    await v3_col("zumba_registrations").update_one({"id": registration_id}, {"$set": changes})
    return _shape({**existing, **changes}, await _zumba_stages())


@router.delete("/branch/zumba/{registration_id}")
async def delete_zumba(
    registration_id: str,
    user: V3UserOut = Depends(require_zumba_reader),
):
    existing = await _registration_or_400(registration_id)
    if _own_branch_only(user) and existing.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=403, detail="Not your branch")
    await v3_col("zumba_registrations").delete_one({"id": registration_id})
    return {"deleted": True}
