"""Which day a dashboard figure is counted on.

The only tests here that need no server: the date-window helpers are pure, and the two
of them are the whole reason a single row of cards can disagree with itself. Every board
sends a plain calendar day and means the clinic's day; the fields it lands on are stored
on two different clocks (see the comment above the helpers in routers/v3_dashboard.py),
and getting that wrong is what put six sessions on a day that also reported no money and
nobody seen.

Twice before, figures on this row were fixed by a commit that had nothing to check it
against -- see "Stop counting login tokens as booked sessions" and "Fix two wrong figures
on the analytics cards". This is that check.
"""
import os

# The router imports database.py at module scope, which reads these. Motor connects
# lazily, so a URL nothing dials is enough to get at the pure functions below.
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_date_windows")

from datetime import datetime, timezone  # noqa: E402

from utils import CLINIC_UTC_OFFSET  # noqa: E402
from routers.v3_dashboard import (  # noqa: E402
    _clinic_day_start_utc,
    _local_date_range_query,
    _utc_stamp_range_query,
)

DAY = "2026-09-03"


def stored_stamp(clinic_wall_clock: str) -> str:
    """What now_iso() would have written for something done at that time in the clinic."""
    naive = datetime.fromisoformat(clinic_wall_clock)
    return (naive - CLINIC_UTC_OFFSET).replace(tzinfo=timezone.utc).isoformat()


def in_window(stamp: str, window: dict) -> bool:
    """The comparison Mongo makes on these string bounds."""
    rng = window["created_at"]
    return (stamp >= rng.get("$gte", "")) and ("$lt" not in rng or stamp < rng["$lt"])


# ---------------------------------------------------------------- local-clock fields

def test_local_fields_compare_the_day_as_written():
    """slot_time and appointment_date are stored as the branch typed them."""
    assert _local_date_range_query("slot_time", DAY, DAY) == {
        "slot_time": {"$gte": DAY, "$lte": f"{DAY}T23:59:59"}
    }


def test_local_upper_bound_covers_a_wall_clock_slot_and_a_bare_date():
    rng = _local_date_range_query("slot_time", DAY, DAY)["slot_time"]
    for value in (f"{DAY}T00:00", f"{DAY}T10:00", f"{DAY}T23:30", DAY):
        assert rng["$gte"] <= value <= rng["$lte"], value


# ------------------------------------------------------------------ UTC-stamp fields

def test_clinic_day_opens_at_1830_utc_the_day_before():
    assert _clinic_day_start_utc(DAY) == "2026-09-02T18:30:00"
    assert _clinic_day_start_utc(DAY, plus_days=1) == "2026-09-03T18:30:00"


def test_the_whole_clinic_day_is_counted_and_nothing_either_side():
    """The 00:00-05:30 band is the regression: those hours were being dropped, and the
    same hours of the NEXT morning counted in their place."""
    window = _utc_stamp_range_query("created_at", DAY, DAY)
    inside = ["2026-09-03T00:00:00", "2026-09-03T00:05:00", "2026-09-03T05:29:59",
              "2026-09-03T09:00:00", "2026-09-03T23:59:59"]
    outside = ["2026-09-02T23:59:59", "2026-09-04T00:00:00", "2026-09-04T00:01:00"]
    for wall in inside:
        assert in_window(stored_stamp(wall), window), f"{wall} should count as {DAY}"
    for wall in outside:
        assert not in_window(stored_stamp(wall), window), f"{wall} should not count as {DAY}"


def test_upper_bound_is_half_open_so_the_offset_suffix_cannot_sort_past_it():
    """A "+00:00" suffix makes a stamp sort AFTER an otherwise-equal bound, which is why
    the top of the range names the next midnight instead of reaching for the last second
    of this one."""
    window = _utc_stamp_range_query("created_at", DAY, DAY)
    midnight_tonight = "2026-09-03T18:30:00+00:00"      # 00:00 tomorrow, clinic time
    last_instant_today = "2026-09-03T18:29:59.999999+00:00"
    assert not in_window(midnight_tonight, window)
    assert in_window(last_instant_today, window)


def test_a_multi_day_range_spans_every_day_it_names():
    window = _utc_stamp_range_query("created_at", "2026-09-01", DAY)
    for wall in ("2026-09-01T00:00:00", "2026-09-02T12:00:00", "2026-09-03T23:59:00"):
        assert in_window(stored_stamp(wall), window), wall
    assert not in_window(stored_stamp("2026-08-31T23:59:00"), window)
    assert not in_window(stored_stamp("2026-09-04T00:00:00"), window)


# ------------------------------------------------------------------- absent / unusable

def test_no_dates_is_no_clause_on_either_clock():
    """What the "All" preset asks for. A missing clause has to widen the query, never
    narrow it -- an empty {} here is every row, which is the point."""
    assert _utc_stamp_range_query("created_at", None, None) == {}
    assert _local_date_range_query("slot_time", None, None) == {}


def test_an_unreadable_date_leaves_that_end_unbounded():
    assert _clinic_day_start_utc("not-a-date") is None
    assert _utc_stamp_range_query("created_at", "not-a-date", None) == {}
    assert _utc_stamp_range_query("created_at", "not-a-date", DAY) == {
        "created_at": {"$lt": "2026-09-03T18:30:00"}
    }


def test_one_open_end_is_still_a_range():
    assert _utc_stamp_range_query("created_at", DAY, None) == {
        "created_at": {"$gte": "2026-09-02T18:30:00"}
    }
