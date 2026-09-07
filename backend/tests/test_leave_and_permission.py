"""The rules behind a leave and a permission request.

Unit tests, in the same shape as test_hr_ops_payroll.py beside this one and for the same
reason: what is worth pinning down here is not that the endpoints are wired up, it is the
rule that decides what a request is allowed to be. Two screens now post through
`build_request` -- HR's own form and the person's own profile -- so a change to it lands
on both at once, and a regression is somebody being told they can have four and a half
hours off in the middle of a shift.

Nothing here touches a database. `build_request` and `_clashes` are pure by design, which
is most of the point of them being where they are.

See backend/routers/v3_hr_ops.py and backend/routers/v3_me.py for the reasoning each
of these is checking.
"""
import os
import sys

import pytest

# Same note as the file beside this one: pytest with no __init__.py puts this directory on
# the path rather than the backend root, so this is what makes `import routers.…` resolve.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import HTTPException  # noqa: E402

from routers.v3_hr_ops import (  # noqa: E402
    APPROVED, LEAVE_KIND, MAX_PERMISSION_MINUTES, MIN_PERMISSION_MINUTES, PENDING,
    PERMISSION_KIND, REJECTED, SOURCE_HR, SOURCE_SELF,
    _hhmm, _valid_time, build_request, permission_of,
)
from routers.v3_me import _clashes, _public_request  # noqa: E402

EMPLOYEE = {"id": "e1", "full_name": "Test Person", "employee_code": "EMP0001", "department": "Ops"}


def leave(from_date, to_date="", **kw):
    return build_request(EMPLOYEE, LEAVE_KIND, from_date=from_date, to_date=to_date, **kw)


def permission(day="2026-09-10", start="14:00", end="16:00", **kw):
    return build_request(
        EMPLOYEE, PERMISSION_KIND, from_date=day, from_time=start, to_time=end, **kw
    )


class TestTimes:
    def test_hhmm_pads_both_halves(self):
        assert _hhmm(450) == "07:30"
        assert _hhmm(0) == "00:00"
        assert _hhmm(23 * 60 + 59) == "23:59"

    def test_valid_time_returns_minutes_past_midnight(self):
        assert _valid_time("07:30", "from_time") == 450

    @pytest.mark.parametrize("bad", ["", "7.30", "25:00", "12:61", "noon", "12", None])
    def test_a_time_that_is_not_one_is_refused(self, bad):
        with pytest.raises(HTTPException) as e:
            _valid_time(bad, "from_time")
        assert e.value.status_code == 400
        # The field is named, because the form has two of these and "must be a time" alone
        # does not say which one to look at.
        assert "from_time" in e.value.detail


class TestLeave:
    def test_one_day_leave_is_one_day(self):
        row = leave("2026-09-10")
        assert (row["from_date"], row["to_date"], row["days"]) == ("2026-09-10", "2026-09-10", 1)

    def test_blank_second_date_means_the_same_day(self):
        assert leave("2026-09-10", "")["to_date"] == "2026-09-10"

    def test_a_span_counts_both_ends(self):
        assert leave("2026-09-10", "2026-09-12")["days"] == 3

    def test_backwards_is_refused(self):
        with pytest.raises(HTTPException) as e:
            leave("2026-09-12", "2026-09-10")
        assert e.value.status_code == 400

    def test_no_date_at_all_is_refused(self):
        with pytest.raises(HTTPException):
            leave("")

    def test_a_leave_carries_no_times(self):
        # The two halves of the form are exclusive: a leave that arrived with times on it
        # would show on the register as hours off inside a day it in fact took whole.
        row = leave("2026-09-10")
        assert (row["from_time"], row["to_time"], row["minutes"]) == ("", "", 0)


class TestPermission:
    def test_hours_of_one_day(self):
        row = permission(day="2026-09-10", start="14:00", end="16:00")
        assert row["minutes"] == 120
        # Both ends are the same day on purpose -- every query that reads requests by date
        # reads a span, and a permission with no `to_date` would fall out of all of them.
        assert row["from_date"] == row["to_date"] == "2026-09-10"
        assert row["days"] == 0

    def test_times_are_stored_one_way(self):
        row = permission(start="9:5", end="11:05")
        assert (row["from_time"], row["to_time"]) == ("09:05", "11:05")

    def test_the_end_has_to_be_after_the_start(self):
        with pytest.raises(HTTPException) as e:
            permission(start="16:00", end="14:00")
        assert e.value.status_code == 400

    def test_the_same_time_twice_is_not_a_permission(self):
        with pytest.raises(HTTPException):
            permission(start="14:00", end="14:00")

    def test_shorter_than_the_floor_is_a_break(self):
        with pytest.raises(HTTPException) as e:
            permission(start="14:00", end="14:10")
        assert "break" in e.value.detail

    def test_the_floor_itself_is_allowed(self):
        assert permission(start="14:00", end="14:15")["minutes"] == MIN_PERMISSION_MINUTES

    def test_the_ceiling_itself_is_allowed(self):
        assert permission(start="10:00", end="14:00")["minutes"] == MAX_PERMISSION_MINUTES

    def test_longer_than_the_ceiling_is_leave(self):
        with pytest.raises(HTTPException) as e:
            permission(start="10:00", end="14:30")
        assert "leave" in e.value.detail

    def test_a_permission_needs_a_day(self):
        with pytest.raises(HTTPException):
            permission(day="")

    def test_a_permission_needs_both_times(self):
        with pytest.raises(HTTPException):
            build_request(EMPLOYEE, PERMISSION_KIND, from_date="2026-09-10", from_time="14:00", to_time="")


class TestRowShape:
    def test_a_new_request_is_pending_and_undecided(self):
        row = leave("2026-09-10")
        assert row["status"] == PENDING
        assert row["decided_by"] == "" and row["decided_at"] == ""

    def test_the_employee_is_copied_onto_the_row(self):
        row = leave("2026-09-10")
        # Denormalised so a request decided last year still names the person as they were
        # on the record then.
        assert row["employee_name"] == "Test Person"
        assert row["employee_code"] == "EMP0001"
        assert row["department"] == "Ops"

    def test_the_source_says_which_door_it_came_through(self):
        assert leave("2026-09-10", source=SOURCE_SELF)["source"] == SOURCE_SELF
        assert leave("2026-09-10")["source"] == SOURCE_HR

    def test_an_unknown_kind_is_refused(self):
        with pytest.raises(HTTPException) as e:
            build_request(EMPLOYEE, "sabbatical", from_date="2026-09-10")
        assert e.value.status_code == 400

    def test_money_kinds_still_want_an_amount(self):
        # Unchanged behaviour, held here because build_request took it over from the
        # endpoint that used to check it.
        with pytest.raises(HTTPException):
            build_request(EMPLOYEE, "advance", amount=0)
        assert build_request(EMPLOYEE, "advance", amount=5000)["amount"] == 5000.0


class TestPermissionOnTheRegister:
    def test_a_day_with_no_permission_reads_as_none(self):
        # None rather than an empty object: a screen drawing the second would put an empty
        # chip on every row in the register.
        assert permission_of({"status": "present"}) is None
        assert permission_of({}) is None
        assert permission_of(None) is None

    def test_the_hours_and_the_decision_behind_them(self):
        got = permission_of({
            "status": "present",
            "permission_id": "a1",
            "permission_from": "14:00",
            "permission_to": "16:00",
            "permission_minutes": 120,
            "permission_reason": "Bank",
        })
        assert got == {
            "approval_id": "a1", "from": "14:00", "to": "16:00",
            "minutes": 120, "reason": "Bank",
        }


class TestClashes:
    """The guard that stops one person booking the same day off twice."""

    def held(self, from_date, to_date, status=PENDING, kind=LEAVE_KIND):
        return {"kind": kind, "status": status, "from_date": from_date, "to_date": to_date}

    def test_the_same_day_twice_clashes(self):
        assert _clashes(leave("2026-09-10"), [self.held("2026-09-10", "2026-09-10")])

    def test_an_overlapping_span_clashes(self):
        assert _clashes(leave("2026-09-11", "2026-09-14"), [self.held("2026-09-09", "2026-09-12")])

    def test_a_span_that_only_touches_at_the_edge_clashes(self):
        assert _clashes(leave("2026-09-12", "2026-09-14"), [self.held("2026-09-10", "2026-09-12")])

    def test_neighbouring_days_do_not_clash(self):
        assert _clashes(leave("2026-09-13"), [self.held("2026-09-10", "2026-09-12")]) is None

    def test_a_rejected_leave_is_not_holding_the_day(self):
        assert _clashes(leave("2026-09-10"), [self.held("2026-09-10", "2026-09-10", REJECTED)]) is None

    def test_an_approved_leave_is(self):
        assert _clashes(leave("2026-09-10"), [self.held("2026-09-10", "2026-09-10", APPROVED)])

    def test_permissions_never_clash(self):
        # Two errands on one working day is a person with two errands, not a mistake.
        one = permission(day="2026-09-10", start="10:00", end="11:00")
        assert _clashes(one, [self.held("2026-09-10", "2026-09-10", PENDING, PERMISSION_KIND)]) is None

    def test_a_leave_does_not_clash_with_a_permission(self):
        assert _clashes(leave("2026-09-10"), [self.held("2026-09-10", "2026-09-10", PENDING, PERMISSION_KIND)]) is None

    def test_a_dateless_request_is_stepped_over(self):
        # Advances and expense claims have no dates. They never reach this list, but a
        # blank date must not be read as the first of the epoch either.
        assert _clashes(leave("2026-09-10"), [self.held("", "")]) is None


class TestWhatTheRequesterSees:
    def test_only_a_pending_request_can_be_withdrawn(self):
        assert _public_request({"status": PENDING})["can_withdraw"] is True
        assert _public_request({"status": APPROVED})["can_withdraw"] is False
        assert _public_request({"status": REJECTED})["can_withdraw"] is False

    def test_a_request_with_no_status_reads_as_pending(self):
        assert _public_request({})["status"] == PENDING

    def test_it_says_whether_they_raised_it_themselves(self):
        assert _public_request({"source": SOURCE_SELF})["raised_by_me"] is True
        assert _public_request({"source": SOURCE_HR})["raised_by_me"] is False
        # Rows written before requests had a source were all HR's.
        assert _public_request({})["raised_by_me"] is False
