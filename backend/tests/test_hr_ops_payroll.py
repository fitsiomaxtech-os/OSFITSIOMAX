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

from datetime import datetime  # noqa: E402

from fastapi import HTTPException  # noqa: E402

from utils import CLINIC_UTC_OFFSET  # noqa: E402

from routers.v3_hr_ops import (  # noqa: E402
    _board_status, _compute_slip, _dates_between, _month_span, _period_span,
    _pick_for_today, _totals, _valid_date, _valid_month,
)
from routers.v3_clock import (  # noqa: E402
    ACTIONS, DONE, ON_BREAK, OUT, WORKING, _break_minutes, _minutes_between, _public, _state,
    day_totals,
)

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
# The clock in the header -- routers/v3_clock.py. Pure, like everything else here: what a
# day's document means, and what may be pressed next, is worked out from the timestamps on
# it rather than stored, so it can be checked without a database or a session.
#
# It is tested in this file because the register reads what the clock writes. A day that
# reads as "working" when somebody has gone home is an In with no Out on HR's screen and a
# worked figure that grows overnight.

DAY = "2026-09-04"


def _at(hhmm):
    """A UTC stamp for a clinic-clock time, so a fixture reads as the hour it means.

    Through CLINIC_UTC_OFFSET rather than by hand: the borrow at half past is exactly the
    kind of arithmetic a fixture gets wrong quietly, and then tests the wrong minutes.
    """
    local = datetime.fromisoformat(f"{DAY}T{hhmm}:00+00:00")
    return (local - CLINIC_UTC_OFFSET).isoformat()


def _day(clock_in=None, clock_out=None, breaks=()):
    doc = {"date": DAY, "breaks": [dict(b) for b in breaks]}
    if clock_in:
        doc.update(clock_in=clock_in, clock_in_at=_at(clock_in))
    if clock_out:
        doc.update(clock_out=clock_out, clock_out_at=_at(clock_out))
    return doc


def _brk(out, reason="Lunch", back=None):
    entry = {"out": out, "out_at": _at(out), "reason": reason, "in": "", "in_at": ""}
    if back:
        entry.update({"in": back, "in_at": _at(back)})
    return entry


class TestClockState:
    """The four states, read off the document rather than stored beside it."""

    def test_a_day_nobody_has_touched_is_out(self):
        assert _state(None) == OUT
        assert _state({}) == OUT

    def test_clocked_in_is_working(self):
        assert _state(_day(clock_in="09:00")) == WORKING

    def test_an_unclosed_break_is_on_break(self):
        assert _state(_day(clock_in="09:00", breaks=[_brk("13:00")])) == ON_BREAK

    def test_a_closed_break_is_back_to_working(self):
        assert _state(_day(clock_in="09:00", breaks=[_brk("13:00", back="13:40")])) == WORKING

    def test_clocked_out_is_done(self):
        assert _state(_day(clock_in="09:00", clock_out="18:00")) == DONE

    def test_only_the_last_break_can_be_open(self):
        """Two taken and one still running -- the state is about the one with no end."""
        day = _day(clock_in="09:00", breaks=[_brk("11:00", "Tea break", back="11:15"), _brk("13:00")])
        assert _state(day) == ON_BREAK

    def test_every_state_offers_something_to_press_except_the_finished_one(self):
        assert ACTIONS[OUT] == ["clock_in"]
        assert ACTIONS[ON_BREAK] == ["break_in"]      # not clock_out -- the break must close first
        assert "break_out" in ACTIONS[WORKING] and "clock_out" in ACTIONS[WORKING]
        assert ACTIONS[DONE] == []


class TestClockArithmetic:
    """Worked time is the day minus the breaks, and a running break still counts."""

    def test_a_finished_day_is_measured_to_the_clock_out(self):
        out = _public(_day(clock_in="09:00", clock_out="18:00"), DAY)
        assert out["worked_minutes"] == 9 * 60
        assert out["break_minutes"] == 0

    def test_breaks_come_off_the_worked_total(self):
        day = _day(clock_in="09:00", clock_out="18:00", breaks=[_brk("13:00", back="13:45")])
        out = _public(day, DAY)
        assert out["break_minutes"] == 45
        assert out["worked_minutes"] == 9 * 60 - 45

    def test_a_break_still_running_is_counted_and_flagged(self):
        out = _public(_day(clock_in="09:00", breaks=[_brk("13:00", "Lunch")]), DAY)
        assert out["breaks"][0]["running"] is True
        assert out["on_break_since"] == "13:00"
        assert out["break_reason"] == "Lunch"

    def test_the_reason_is_carried_through_to_whoever_reads_the_day(self):
        out = _public(_day(clock_in="09:00", breaks=[_brk("11:00", "Prayer", back="11:10")]), DAY)
        assert [(b["out"], b["in"], b["reason"]) for b in out["breaks"]] == [("11:00", "11:10", "Prayer")]

    def test_an_untouched_day_is_an_empty_day_rather_than_nothing(self):
        """The header has to draw something before the first press of the morning."""
        out = _public(None, DAY)
        assert out["state"] == OUT and out["clock_in"] == "" and out["worked_minutes"] == 0
        assert out["date"] == DAY

    def test_a_break_across_midnight_is_the_minutes_it_took(self):
        """A night shift crosses one every time, so the stamps are subtracted, not the faces."""
        assert _minutes_between("2026-09-04T23:50:00+00:00", "2026-09-05T00:20:00+00:00") == 30

    def test_a_missing_or_unreadable_stamp_is_no_minutes_at_all(self):
        assert _minutes_between(None, "2026-09-04T09:00:00+00:00") == 0
        assert _minutes_between("half past nine", "2026-09-04T09:00:00+00:00") == 0

    def test_break_minutes_count_an_open_break_up_to_the_moment_asked(self):
        day = _day(clock_in="09:00", breaks=[_brk("13:00")])
        assert _break_minutes(day, _at("13:30")) == 30


# The attendance board -- routers/v3_hr_ops.py. Three pure pieces decide what it shows: how
# long a day was (day_totals, shared with the header widget), which of the clock and HR's
# mark speaks for a day, and how far each span reaches.


class TestDayTotals:
    """What one clocked day adds up to. The header and the board both read this, so a
    disagreement here is two screens contradicting each other about the same person."""

    def test_a_finished_day_is_measured_to_the_clock_out(self):
        t = day_totals(_day(clock_in="09:00", clock_out="18:00"), _at("20:00"))
        assert (t["login_minutes"], t["worked_minutes"]) == (540, 540)
        assert t["state"] == DONE

    def test_a_running_day_is_measured_up_to_now(self):
        """This is what makes the figures move through the morning — the screens say
        "so far" rather than pretending the day is done."""
        t = day_totals(_day(clock_in="10:07"), _at("17:19"))
        assert t["login_minutes"] == 432
        assert t["state"] == WORKING

    def test_a_break_comes_off_worked_but_not_off_login(self):
        """The two columns answer different questions: how long somebody was on the clock,
        and how much of that they were actually at it."""
        t = day_totals(_day(clock_in="09:00", clock_out="18:00", breaks=[_brk("13:00", back="13:45")]), _at("20:00"))
        assert t["login_minutes"] == 540
        assert t["worked_minutes"] == 495
        assert (t["break_minutes"], t["break_count"]) == (45, 1)

    def test_a_break_still_running_counts_up_to_now(self):
        t = day_totals(_day(clock_in="10:00", breaks=[_brk("13:00")]), _at("13:50"))
        assert t["break_minutes"] == 50
        assert t["state"] == ON_BREAK

    def test_several_breaks_add_up(self):
        day = _day(clock_in="09:00", clock_out="18:00", breaks=[_brk("11:00", "Tea break", back="11:15"), _brk("13:00", back="13:45")])
        t = day_totals(day, _at("20:00"))
        assert (t["break_minutes"], t["break_count"]) == (60, 2)
        assert t["worked_minutes"] == 480

    def test_nobody_clocked_in_has_no_day(self):
        """Zeros rather than a guess from a roster: not having pressed the button is
        exactly what the board needs to see."""
        t = day_totals(None, _at("12:00"))
        assert t == {"state": OUT, "login_minutes": 0, "worked_minutes": 0,
                     "break_minutes": 0, "break_count": 0}

    def test_worked_never_goes_negative(self):
        """A break left running past a clock-out would otherwise subtract more than the
        day contained."""
        day = _day(clock_in="09:00", clock_out="18:00", breaks=[_brk("09:30", back="23:00")])
        assert day_totals(day, _at("20:00"))["worked_minutes"] == 0

    def test_the_widget_and_the_board_agree(self):
        """_public is the header's shape and day_totals the board's. Same day, same
        numbers — that is the whole reason the arithmetic lives in one function."""
        day = _day(clock_in="09:00", clock_out="18:00", breaks=[_brk("13:00", back="13:45")])
        pub = _public(day, "2026-09-04")
        tot = day_totals(day, _at("18:00"))
        assert pub["worked_minutes"] == tot["worked_minutes"]
        assert pub["break_minutes"] == tot["break_minutes"]
        assert pub["login_minutes"] == tot["login_minutes"]


class TestBoardStatus:
    """Which of the two sources speaks for a day."""

    def test_the_clock_beats_a_stale_mark(self):
        """Somebody at their desk right now is Working whatever a mark says — the board
        reports what is happening, not what was expected."""
        assert _board_status(WORKING, "absent") == "working"

    def test_on_break_is_still_at_work(self):
        assert _board_status(ON_BREAK, "") == "on_break"

    def test_a_mark_speaks_when_the_clock_is_silent(self):
        """Leave and absent are decisions, and a clock cannot make them."""
        assert _board_status(OUT, "leave") == "leave"
        assert _board_status(OUT, "absent") == "absent"

    def test_neither_means_yet_to_login(self):
        """Not "absent": absent has pay attached, and nine in the morning is too early to
        have decided it."""
        assert _board_status(OUT, "") == "yet_to_login"

    def test_a_finished_day_stands_on_its_own(self):
        assert _board_status(DONE, "") == "done"


class TestPeriodSpans:
    def test_a_day_is_itself(self):
        assert _period_span("day", "2026-09-04", None, None, None, None) == (
            "2026-09-04", "2026-09-04", "04 Sep 2026")

    def test_a_month_spans_its_own_length(self):
        assert _period_span("month", None, None, None, "2026-02", None)[:2] == (
            "2026-02-01", "2026-02-28")

    def test_a_leap_february_reaches_the_29th(self):
        assert _period_span("month", None, None, None, "2024-02", None)[1] == "2024-02-29"

    def test_a_year_is_the_whole_year(self):
        assert _period_span("year", None, None, None, None, "2026")[:2] == (
            "2026-01-01", "2026-12-31")

    def test_a_range_keeps_both_ends(self):
        assert _period_span("range", None, "2026-09-01", "2026-09-05", None, None)[:2] == (
            "2026-09-01", "2026-09-05")

    def test_a_range_with_no_end_is_one_day(self):
        """The common case is looking at a single day through the range control, so the
        second date is optional rather than an error to correct."""
        assert _period_span("range", None, "2026-09-01", None, None, None)[:2] == (
            "2026-09-01", "2026-09-01")

    def test_a_backwards_range_is_refused(self):
        with pytest.raises(HTTPException) as err:
            _period_span("range", None, "2026-09-05", "2026-09-01", None, None)
        assert err.value.status_code == 400

    @pytest.mark.parametrize("bad", ["26", "twenty", "20266", ""])
    def test_a_year_that_is_not_four_digits_is_refused(self, bad):
        # "" falls back to the current year rather than failing, so it is the one case
        # that must NOT raise.
        if bad == "":
            assert len(_period_span("year", None, None, None, None, bad)[2]) == 4
            return
        with pytest.raises(HTTPException):
            _period_span("year", None, None, None, None, bad)

    def test_a_span_is_inclusive_at_both_ends(self):
        assert len(_dates_between("2026-09-01", "2026-09-05")) == 5

    def test_a_leap_year_has_366_days(self):
        assert len(_dates_between("2024-01-01", "2024-12-31")) == 366
