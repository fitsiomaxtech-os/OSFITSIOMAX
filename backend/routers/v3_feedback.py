"""What a patient thought, written by the patient.

Kept apart from the Review pipeline next door, which is a clinical hand-off between a
branch and a Head Physio and has nothing to do with what the patient made of the place.
Two things called "review" would be one word covering two jobs, and the branch would open
the wrong one.

The board is three columns and the row moves left to right: it arrives New, somebody picks
it up, somebody finishes with it. A rating rides along but does not sort the board -- what
a branch acts on is whether a complaint has been dealt with, not how many stars it came
with, and sorting by sentiment leaves an unhappy patient sitting in a column nobody works
through.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import v3_col
from deps import v3_require_roles, is_branch_admin_role
from schemas.v3 import V3UserOut
from utils import now_iso

router = APIRouter(prefix="/api/v3")

# The three columns, in the order they are worked through. Fixed rather than configurable:
# these are what has been done about a piece of feedback, and unlike a sales pipeline there
# is no branch that runs those differently.
STATUS_NEW = "new"
STATUS_IN_PROGRESS = "in_progress"
# Asked, not closed. A branch that has done something says so and asks whether it settled
# it; the thread waits here until the patient answers. Nobody but the patient moves it on
# from here — see move_feedback.
STATUS_AWAITING = "awaiting_patient"
STATUS_RESOLVED = "resolved"
STATUSES = (STATUS_NEW, STATUS_IN_PROGRESS, STATUS_AWAITING, STATUS_RESOLVED)

# Who wrote a message in the thread. Two sides, whatever the staff member's role: to the
# patient there is no difference between a Branch Admin and head office answering, and the
# thread reads as a conversation rather than a case file.
AUTHOR_PATIENT = "patient"
AUTHOR_STAFF = "staff"

MAX_MESSAGE = 2000

# Who the patient chose to send it to.
#
# A branch runs its own people, so anything about a Consultant, a Physio or a Zumba master
# is the Branch Admin's to answer. What a Branch Admin cannot be asked to answer is a
# complaint about themselves -- so the portal offers Super Admin as the second address, and
# what goes there is not shown on the branch's board at all. Routing it to the branch and
# hoping they pass it up would ask the subject of a complaint to forward it.
#
# Rows written before this carry no audience and read as the branch's, which is where they
# were sent and where they have been read since.
AUDIENCE_BRANCH = "branch_admin"
AUDIENCE_SUPER = "super_admin"
AUDIENCES = (AUDIENCE_BRANCH, AUDIENCE_SUPER)


def _audience(value) -> str:
    slug = str(value or "").strip().lower()
    return slug if slug in AUDIENCES else AUDIENCE_BRANCH


def _status(value) -> str:
    slug = str(value or "").strip().lower()
    return slug if slug in STATUSES else STATUS_NEW


def _rating(value) -> Optional[int]:
    """One to five, or nothing. Anything else is dropped rather than clamped: a 9 is a
    mistake somewhere, and quietly recording it as 5 would put words in a patient's mouth."""
    try:
        rating = int(value)
    except (TypeError, ValueError):
        return None
    return rating if 1 <= rating <= 5 else None


def _thread(row: dict) -> list:
    """The conversation on one piece of feedback, oldest first.

    Synthesised for rows written before it was a conversation rather than migrated: the
    original message is the patient's first line and the single stored reply is the
    branch's answer to it, which is exactly what those two fields were. Doing it on read
    means no backfill can miss a row, and a thread that has never been added to costs
    nothing to keep in the old shape.
    """
    thread = row.get("messages")
    if isinstance(thread, list) and thread:
        return thread
    built = []
    if (row.get("message") or "").strip():
        built.append({
            "id": f"{row.get('id')}-open",
            "author": AUTHOR_PATIENT,
            "author_name": row.get("patient_name") or "",
            "body": row["message"],
            "created_at": row.get("created_at") or "",
        })
    if (row.get("reply") or "").strip():
        built.append({
            "id": f"{row.get('id')}-reply",
            "author": AUTHOR_STAFF,
            "author_name": row.get("replied_by") or "",
            "body": row["reply"],
            "created_at": row.get("replied_at") or row.get("handled_at") or "",
        })
    return built


class FeedbackMessageIn(BaseModel):
    body: str
    # Sent with the message that asks. The branch does not close its own complaint: it
    # says what it did and asks whether that settled it, and the patient's answer is what
    # moves the thread to resolved.
    ask_resolved: bool = False


class FeedbackStatusIn(BaseModel):
    status: str
    note: Optional[str] = ""
    # What the branch is telling the patient. Required to resolve, and the patient reads it
    # in their portal -- which is why it is its own field and not the note: the note is the
    # branch's working record, written to be read by colleagues.
    reply: Optional[str] = ""


@router.get("/branch/feedback")
async def list_feedback(
    branch_id: Optional[str] = Query(None),
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """The feedback addressed to whoever is asking, and the count their bell reads.

    A branch reads its own post and nothing else: what its patients sent it, for its branch
    only. What a patient addressed to head office is kept off that board deliberately — it
    was sent that way because the patient did not want the branch reading it, and half of
    those are about the Branch Admin themselves.

    Head office reads all of it, its own and every branch's. It owns the branches, and
    feedback about a branch it cannot see is oversight it cannot do. The asymmetry is the
    point rather than an oversight: confidentiality runs upward, not down.

    Super Admin may narrow to one branch; a Branch Admin is always held to theirs.

    unread is the New column rather than a flag of its own. A bell counting things nobody
    has picked up is the same question the first column already answers, and a second
    number kept beside it is one that can disagree with what is on screen.
    """
    query: dict = {}
    if is_branch_admin_role(user.role):
        if not user.branch_id:
            return {"feedback": [], "counts": {s: 0 for s in STATUSES}, "unread": 0}
        query["branch_id"] = user.branch_id
        # Anything addressed to Super Admin is kept off this board. It is there because the
        # patient did not want the branch to be the one who read it, and half of those are
        # about the Branch Admin themselves.
        query["audience"] = {"$ne": AUDIENCE_SUPER}
    else:
        # Head office reads everything: what was addressed to it, and what every branch
        # received. It owns the branches, and feedback about a branch it cannot see is
        # oversight it cannot do.
        #
        # The rule does NOT run the other way, and must not. A patient who wrote to head
        # office chose not to have the branch read it, and half of those are about the
        # Branch Admin themselves — the branch query above still excludes them. What is
        # asymmetric here is the relationship, not an oversight.
        #
        # `audience` is returned on every row so this board can still tell them apart, and
        # narrowing to one branch stays available.
        if branch_id:
            query["branch_id"] = branch_id

    rows = await v3_col("patient_feedback").find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
    # Named, not just identified. Head office reads this branch by branch, and a heading
    # of "5f2c…" is an id rather than a branch. Looked up here rather than copied onto the
    # row when it was written: a branch that is renamed should read by its name now, and
    # unlike the patient's own name this is not part of what somebody said on a day.
    branch_ids = {r.get("branch_id") for r in rows if r.get("branch_id")}
    names = {
        b["id"]: b.get("branch_name") or ""
        for b in await v3_col("branches").find(
            {"id": {"$in": list(branch_ids)}}, {"_id": 0, "id": 1, "branch_name": 1}
        ).to_list(500)
    } if branch_ids else {}
    counts = {s: 0 for s in STATUSES}
    for row in rows:
        row["status"] = _status(row.get("status"))
        row["audience"] = _audience(row.get("audience"))
        row["branch_name"] = names.get(row.get("branch_id"), "")
        row["messages"] = _thread(row)
        # What is waiting on this side. A thread the patient has answered since anyone
        # here last wrote is the one somebody has to pick back up, and without this it
        # looked identical to one still sitting where the branch left it.
        last = row["messages"][-1] if row["messages"] else None
        row["awaiting_staff"] = bool(last and last.get("author") == AUTHOR_PATIENT)
        counts[row["status"]] += 1
    # The bell counts what nobody has picked up and what somebody has written back into.
    # A patient replying to an answer is a thing to read, and counting only the New column
    # left those arriving silently in a column already worked through.
    unread = counts[STATUS_NEW] + sum(
        1 for r in rows if r["awaiting_staff"] and r["status"] != STATUS_NEW
    )
    return {"feedback": rows, "counts": counts, "unread": unread}


@router.patch("/branch/feedback/{feedback_id}")
async def move_feedback(
    feedback_id: str,
    payload: FeedbackStatusIn,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """Move a piece of feedback to another column, and record who moved it.

    Resolving takes a reply and will not go through without one. Closing a complaint is the
    branch saying it is dealt with, and the person who raised it is told what was done --
    a status changing under them with no words attached is how somebody learns that saying
    something here achieves nothing.

    The other moves ask for nothing. Requiring a sentence to pick something up would mean
    typing one to say "I have seen this", and a field that has to be filled to get past it
    fills with "ok".
    """
    existing = await v3_col("patient_feedback").find_one({"id": feedback_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="No such feedback")
    if is_branch_admin_role(user.role) and existing.get("branch_id") != user.branch_id:
        raise HTTPException(status_code=403, detail="Not your branch")

    status = str(payload.status or "").strip().lower()
    if status not in STATUSES:
        raise HTTPException(status_code=400, detail=f"Status must be one of: {', '.join(STATUSES)}")

    reply = (payload.reply or "").strip()[:MAX_MESSAGE]
    # Resolved is the patient's word, not this side's. A branch saying "dealt with" over a
    # complaint the patient still has is how somebody learns that saying something here
    # achieves nothing — so the branch says what it did and asks, and the patient's answer
    # closes it. POST .../message with ask_resolved is that door.
    if status == STATUS_RESOLVED:
        raise HTTPException(
            status_code=400,
            detail="Ask the patient whether it is settled — their answer is what resolves it",
        )
    if status == STATUS_AWAITING and not reply:
        raise HTTPException(status_code=400, detail="Say what was done — the patient reads this")

    changes = {
        "status": status,
        "handled_by": user.full_name or user.email,
        "handled_at": now_iso(),
    }
    # Only written when something was said, so walking a card back to In Progress and
    # resolving it again replaces the reply rather than the second move blanking it.
    if reply:
        changes["reply"] = reply
        changes["replied_by"] = user.full_name or user.email
        changes["replied_at"] = now_iso()
    if (payload.note or "").strip():
        changes["note"] = (payload.note or "").strip()
    await v3_col("patient_feedback").update_one({"id": feedback_id}, {"$set": changes})
    return {**existing, **changes}


@router.post("/branch/feedback/{feedback_id}/message")
async def reply_to_feedback(
    feedback_id: str,
    payload: FeedbackMessageIn,
    user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin")),
):
    """Write back to the patient on their own thread.

    Feedback used to be one message and one closing reply, which meant a patient whose
    answer raised another question had nowhere to put it and opened a second piece of
    feedback about the same thing. This is the same exchange as a conversation: either
    side can write, and the thread keeps its order.

    Answering picks the thread up if nobody had. Someone writing a reply has plainly
    started on it, and leaving it in New so it could be picked up later is a column saying
    something untrue about work already done.

    ask_resolved is how a branch closes one: it says what was done and asks whether that
    settled it. The thread then waits on the patient, and nothing this side does moves it
    to resolved.
    """
    body = (payload.body or "").strip()[:MAX_MESSAGE]
    if not body:
        raise HTTPException(status_code=400, detail="Write something to send")

    existing = await v3_col("patient_feedback").find_one({"id": feedback_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="No such feedback")
    if is_branch_admin_role(user.role):
        if existing.get("branch_id") != user.branch_id:
            raise HTTPException(status_code=403, detail="Not your branch")
        # The same wall the board is built on: what a patient sent past their branch is
        # not theirs to answer, and half of it is about the Branch Admin themselves.
        if _audience(existing.get("audience")) == AUDIENCE_SUPER:
            raise HTTPException(status_code=403, detail="Not your branch")

    now = now_iso()
    message = {
        "id": str(uuid.uuid4()),
        "author": AUTHOR_STAFF,
        "author_name": user.full_name or user.email,
        "body": body,
        "created_at": now,
    }
    # Materialised from the old two fields before appending, or the first answer on a row
    # written before threads would drop the patient's own words off the front of it.
    thread = [*_thread(existing), message]
    status = STATUS_AWAITING if payload.ask_resolved else STATUS_IN_PROGRESS
    changes = {
        "messages": thread,
        "status": status,
        "handled_by": user.full_name or user.email,
        "handled_at": now,
        "reply": body,
        "replied_by": message["author_name"],
        "replied_at": now,
    }
    await v3_col("patient_feedback").update_one({"id": feedback_id}, {"$set": changes})
    return {**existing, **changes, "awaiting_staff": False}
