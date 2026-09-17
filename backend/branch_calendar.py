"""A branch's working calendar, day by day — the one answer to "is this branch open on this date".

Three things decide it, most specific first:

  holidays          dates the branch is on leave (MANAGEMENT → CALENDAR → MONTHLY CALENDAR)
  working_overrides dates opened although their weekday is normally closed
  weekly_hours      the usual week, keyed mon..sun as { is_open, open, close }

Kept out of any one router because the booking flow, the expert slot calendars and the
Monthly Calendar tab all have to agree on it; three copies of the rule would be three
answers the day somebody changes one.
"""
from datetime import datetime
from typing import Optional

DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]  # Mon=0 .. Sun=6
DEFAULT_OPEN = "09:00"
DEFAULT_CLOSE = "20:00"

WORKING = "working"
LEAVE = "leave"


def day_key(date_str: str) -> Optional[str]:
    try:
        return DAY_KEYS[datetime.strptime(date_str, "%Y-%m-%d").weekday()]
    except (ValueError, TypeError):
        return None


def day_status(branch: dict, date_str: str) -> dict:
    """{status, source, open, close, note} for one date.

    `source` says why: "leave" / "override" when set on the Monthly Calendar, "weekly" when
    it is only the usual week speaking — so the tab can show which days somebody chose.
    """
    branch = branch or {}
    note = (branch.get("holiday_notes") or {}).get(date_str, "")
    if date_str in (branch.get("holidays") or []):
        return {"status": LEAVE, "source": "leave", "open": None, "close": None, "note": note}
    cfg = (branch.get("weekly_hours") or {}).get(day_key(date_str) or "") or {}
    open_t = cfg.get("open") or DEFAULT_OPEN
    close_t = cfg.get("close") or DEFAULT_CLOSE
    if date_str in (branch.get("working_overrides") or []):
        return {"status": WORKING, "source": "override", "open": open_t, "close": close_t, "note": note}
    if cfg.get("is_open") is False:
        return {"status": LEAVE, "source": "weekly", "open": None, "close": None, "note": ""}
    return {"status": WORKING, "source": "weekly", "open": open_t, "close": close_t, "note": ""}


def is_leave(branch: dict, date_str: str) -> bool:
    return day_status(branch, date_str)["status"] == LEAVE
