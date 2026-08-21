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
STATUS_RESOLVED = "resolved"
STATUSES = (STATUS_NEW, STATUS_IN_PROGRESS, STATUS_RESOLVED)

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
    """A branch's feedback, and the count the bell reads.

    Scoped the way every other branch board is: a Branch Admin reads their own branch and
    only Super Admin may ask for another or for all of them.

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
    elif branch_id:
        query["branch_id"] = branch_id

    rows = await v3_col("patient_feedback").find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
    counts = {s: 0 for s in STATUSES}
    for row in rows:
        row["status"] = _status(row.get("status"))
        row["audience"] = _audience(row.get("audience"))
        counts[row["status"]] += 1
    return {"feedback": rows, "counts": counts, "unread": counts[STATUS_NEW]}


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
    if status == STATUS_RESOLVED and not reply:
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
