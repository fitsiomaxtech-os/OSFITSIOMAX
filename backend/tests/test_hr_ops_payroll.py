"""The arithmetic behind Attendance, Payroll and the quote board.

Unit tests, unlike the rest of this directory. Every other file here talks to a running
deployment over HTTP, which is the right shape for testing that an endpoint is wired up
and gated — but the thing most worth pinning down here is not the wiring, it is the rule
that turns a month of attendance marks into a number on somebody's payslip. That rule is
pure, it is the only place in the OS that decides what a day of work is worth, and a
regression in it is a wrong salary rather than a broken screen.

So these call the functions directly. No database, no server, no login.

See backend/routers/v3_hr_ops.py for the reasoning each of these is checking.
"""
import os
import sys

import pytest

# pytest with no __init__.py puts this directory on the path, not the backend root, so an
# `import routers.…` finds nothing when the suite is run as plain `pytest tests/`. Added
# here rather than in a conftest so this file works either way and nothing else in the
# directory changes behaviour.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import HTTPException  # noqa: E402

from routers.v3_hr_ops import (  # noqa: E402
    _compute_slip, _dates_between, _month_span, _pick_for_today, _totals,
    _valid_date, _valid_month,
)
from work_timing import clean_work_timing, late_by  # noqa: E402

# 30 days, ₹30,000 — so a day is worth exactly ₹1,000 and every figure below can be read
# without arithmetic.
EMPLOYEE = {"id": "e1", "full_name": "Test Person", "gross_salary": 30000, "net_salary": 25000}
DAYS = 30


def slip(counts, days=DAYS, bonus=0.0, deduction=0.0, employee=None):
    return _compute_slip(employee or EMPLOYEE, counts, days, bonus, deduction)


class TestMonthSpans:
    def test_leap_february(self):
        assert _month_span("2024-02") == ("2024-02-01", "2024-02-29", 29)

    def test_ordinary_month(self):
        assert _month_span("2026-09") == ("2026-09-01", "2026-09-30", 30)

    def test_range_is_inclusive_at_both_ends(self):
        assert _dates_between("2026-09-01", "2026-09-03") == ["2026-09-01", "2026-09-02", "2026-09-03"]

    def test_one_day_leave_is_one_day(self):
        assert _dates_between("2026-09-05", "2026-09-05") == ["2026-09-05"]


class TestPayrollMath:
    def test_unmarked_days_are_paid(self):
        """A month HR never filled in pays in full, and says how many days that was.

        The alternative — silence read as absence — would dock a salary because nobody
        got round to the register, which is a fact about HR, not about the employee.
        """
        s = slip({})
        assert s["net_payable"] == 30000.0
        assert s["unmarked_days"] == DAYS
        assert s["lop_days"] == 0

    def test_one_absence_costs_one_day(self):
        s = slip({"present": 25, "week_off": 4, "absent": 1})
        assert s["lop_days"] == 1.0
        assert s["payable_days"] == 29
        assert s["earned"] == 29000.0
        assert s["unmarked_days"] == 0

    def test_half_day_costs_half(self):
        s = slip({"present": 29, "half_day": 1})
        assert s["lop_days"] == 0.5
        assert s["earned"] == 29500.0

    def test_late_leave_week_off_and_holidays_cost_nothing(self):
        s = slip({"present": 20, "late": 3, "leave": 3, "week_off": 3, "holiday": 1})
        assert s["lop_days"] == 0
        assert s["net_payable"] == 30000.0

    def test_late_counts_inside_present(self):
        """Somebody who arrived at 09:40 came to work. Punctuality is counted separately;
        it is not a deduction and it is not an absence."""
        s = slip({"present": 20, "late": 3})
        assert s["present_days"] == 23

    def test_pro_rating_is_on_calendar_days(self):
        """A day off costs base ÷ days in month, so the same absence is worth less in a
        31-day month than a 30-day one — which is what keeps a full month's pay equal
        across months of different lengths."""
        assert slip({"absent": 1}, days=31)["earned"] == round(30000 * 30 / 31, 2)
        assert slip({}, days=31)["net_payable"] == 30000.0

    def test_bonus_and_deduction_land_on_the_net(self):
        s = slip({"present": 30}, bonus=2000, deduction=500)
        assert s["earned"] == 30000.0
        assert s["net_payable"] == 31500.0

    def test_net_salary_is_the_fallback_base(self):
        """Most records here carry one salary figure, not both. Falling back keeps a
        payslip from quietly printing zero for somebody who does have a salary."""
        s = slip({}, employee={"id": "e2", "gross_salary": 0, "net_salary": 18000})
        assert s["base"] == 18000.0
        assert s["base_from"] == "net_salary"

    def test_gross_wins_when_both_are_set(self):
        assert slip({})["base_from"] == "gross_salary"

    def test_pay_never_goes_negative_on_absence(self):
        """More absences than days in the month cannot happen from the register, but the
        floor is here so a bad import cannot turn into a negative payslip."""
        s = slip({"absent": 40})
        assert s["payable_days"] == 0
        assert s["earned"] == 0.0

    def test_totals_add_the_lines_up(self):
        a = slip({"absent": 1})
        b = slip({"present": 30}, bonus=1000)
        t = _totals([a, b])
        assert t["employees"] == 2
        assert t["net_payable"] == round(a["net_payable"] + b["net_payable"], 2)
        assert t["bonus"] == 1000
        assert t["lop_days"] == 1.0


class TestQuoteOfTheDay:
    QUOTES = [{"id": "a", "text": "one", "active": True}, {"id": "b", "text": "two", "active": True}]

    def test_the_day_decides(self):
        """Nobody posts the quote — the date picks it, so it changes on its own."""
        assert _pick_for_today(self.QUOTES, "2026-09-04")["id"] != _pick_for_today(self.QUOTES, "2026-09-05")["id"]

    def test_the_same_day_gives_the_same_quote(self):
        """Everyone looking on the same day sees the same one, however often they look."""
        first = _pick_for_today(self.QUOTES, "2026-09-04")["id"]
        assert _pick_for_today(self.QUOTES, "2026-09-04")["id"] == first

    def test_a_pin_beats_the_rotation(self):
        pinned = self.QUOTES + [{"id": "c", "text": "three", "active": True, "pinned": True}]
        assert _pick_for_today(pinned, "2026-09-04")["id"] == "c"

    def test_an_empty_board_has_no_quote(self):
        assert _pick_for_today([], "2026-09-04") is None

    def test_inactive_quotes_are_off_the_board(self):
        assert _pick_for_today([{"id": "a", "text": "x", "active": False}], "2026-09-04") is None

    def test_a_single_quote_shows_every_day(self):
        one = [{"id": "a", "text": "only", "active": True}]
        assert _pick_for_today(one, "2026-09-04")["id"] == "a"
        assert _pick_for_today(one, "2027-01-01")["id"] == "a"


class TestDateValidation:
    @pytest.mark.parametrize("bad", ["31-02-2026", "2026-02-31", "2026-13-01", "", "today", "2026-9-1"])
    def test_a_date_that_does_not_exist_is_refused(self, bad):
        with pytest.raises(HTTPException) as err:
            _valid_date(bad)
        assert err.value.status_code == 400

    def test_a_real_date_passes_through(self):
        assert _valid_date("2026-09-04") == "2026-09-04"

    def test_a_blank_month_means_the_month_we_are_in(self):
        assert len(_valid_month("")) == 7

    def test_a_month_is_checked_too(self):
        with pytest.raises(HTTPException):
            _valid_month("2026-13")
# The other half of the same chain: the roster a register is measured against. The four
# times are set per login in Super Admin -> Credentials and read by attendance, and the
# rules for both live in work_timing.py -- pure, like everything else tested here, so the
# rule that turns "09:00 rostered, 09:14 typed" into "late by 14" is pinned down in the
# same file as the rules payroll reads.
class TestLateness:
    NINE = {"login_time": "09:00"}

    @pytest.mark.parametrize("check_in,expected", [
        ("09:00", 0),    # on the dot is not late
        ("09:10", 10),
        ("09:14", 14),
        ("10:30", 90),
        ("08:50", 0),    # early is not negative-late, it is simply not late
    ])
    def test_minutes_past_the_rostered_login(self, check_in, expected):
        assert late_by(self.NINE, check_in) == expected

    def test_a_night_shift_counts_forward_over_midnight(self):
        """22:00 rostered, 01:00 typed is three hours late, not twenty-one hours early."""
        assert late_by({"login_time": "22:00"}, "01:00") == 180

    def test_arriving_before_a_night_shift_is_not_late(self):
        assert late_by({"login_time": "22:00"}, "21:55") == 0

    @pytest.mark.parametrize("shift,check_in", [
        ({}, "09:45"),                       # nobody has rostered this person
        ({"login_time": ""}, "09:45"),
        ({"login_time": "09:00"}, ""),       # a mark with no clock on it
        ({"login_time": "09:00"}, "half"),   # anything unparseable
    ])
    def test_nothing_to_measure_is_not_a_late_arrival(self, shift, check_in):
        """A missing half of the comparison reads as 0, never as a huge overrun."""
        assert late_by(shift, check_in) == 0


class TestWorkTiming:
    """What Super Admin may store as somebody's hours.

    Only what could not be worked is refused. A half-filled roster is how one gets filled
    in, so it is allowed all the way through.
    """

    def test_a_full_day_is_kept_as_typed(self):
        assert clean_work_timing({
            "login_time": "09:00", "logout_time": "18:00",
            "break_in_time": "13:00", "break_out_time": "13:45",
        }) == {
            "login_time": "09:00", "logout_time": "18:00",
            "break_in_time": "13:00", "break_out_time": "13:45",
        }

    def test_nothing_set_is_four_blanks_rather_than_a_refusal(self):
        assert clean_work_timing({}) == {
            "login_time": "", "logout_time": "", "break_in_time": "", "break_out_time": "",
        }

    def test_a_login_on_its_own_is_enough(self):
        """It is the only one attendance needs — the register measures arrivals against it."""
        assert clean_work_timing({"login_time": "09:00"})["login_time"] == "09:00"

    def test_a_night_shift_and_its_break_are_allowed(self):
        assert clean_work_timing({
            "login_time": "22:00", "logout_time": "06:00",
            "break_in_time": "02:00", "break_out_time": "02:30",
        })["break_in_time"] == "02:00"

    @pytest.mark.parametrize("bad", ["9am", "25:00", "09:60", "0900", "9", "09:00:00"])
    def test_a_time_that_is_not_a_clock_is_refused(self, bad):
        with pytest.raises(HTTPException) as err:
            clean_work_timing({"login_time": bad})
        assert err.value.status_code == 400

    def test_a_shift_cannot_end_where_it_starts(self):
        with pytest.raises(HTTPException):
            clean_work_timing({"login_time": "09:00", "logout_time": "09:00"})

    def test_half_a_break_is_refused(self):
        with pytest.raises(HTTPException):
            clean_work_timing({"login_time": "09:00", "logout_time": "18:00", "break_in_time": "13:00"})

    @pytest.mark.parametrize("brk", [("19:00", "19:30"), ("17:45", "18:30"), ("08:00", "08:30")])
    def test_a_break_outside_the_shift_is_refused(self, brk):
        with pytest.raises(HTTPException):
            clean_work_timing({
                "login_time": "09:00", "logout_time": "18:00",
                "break_in_time": brk[0], "break_out_time": brk[1],
            })
