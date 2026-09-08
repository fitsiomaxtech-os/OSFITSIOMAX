"""What the clock makes of a day, and what the branch's working week makes of it.

Unit tests, like the two files beside this one and for a sharper version of the same
reason: this module decides whether somebody is paid for a Tuesday. Attendance used to be
HR typing a word onto a row, where a mistake was one person's day; it is derived now, so a
mistake here is every person's month.

The rules that matter most are the two that stop it being brutal -- a mark somebody made
always beats a reading, and an employee with no login is never called absent -- so those
get the most tests.

Nothing here touches a database. See backend/attendance_rules.py for the reasoning.
"""
import os
import sys

import pytest

# Same note as the files beside this one: pytest with no __init__.py puts this directory on
# the path rather than the backend root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from attendance_rules import (  # noqa: E402
    ABSENT, CLOCK_MARK, DEFAULTS, HALF_DAY, LATE, PRESENT, WEEK_OFF,
    clean_rules, day_status, decided_status, is_week_off, parse_hhmm, rules_of,
    working_days,
)

# 2026-09-07 is a Monday, 2026-09-12 a Saturday, 2026-09-13 a Sunday.
MON, TUE, SAT, SUN = "2026-09-07", "2026-09-08", "2026-09-12", "2026-09-13"
TOMORROW = "2026-09-09"
TODAY = "2026-09-08"

RULES = clean_rules({"work_start": "09:00", "work_end": "18:00", "grace_minutes": 15,
                     "half_day_minutes": 240, "week_offs": [6]})


def clocked(in_at="09:00", out_at="18:00"):
    return {"clock_in": in_at, "clock_out": out_at}


def totals(worked):
    return {"worked_minutes": worked}


def status(iso=MON, clock=None, worked=480, mark=None, today=TODAY, has_login=True, rules=RULES):
    return day_status(rules, iso, clock, totals(worked), mark, today, has_login)


class TestRuleValidation:
    def test_defaults_fill_in_what_was_left_out(self):
        assert clean_rules({}) == DEFAULTS

    def test_a_day_that_ends_before_it_starts_is_refused(self):
        with pytest.raises(ValueError):
            clean_rules({"work_start": "18:00", "work_end": "09:00"})

    def test_a_bad_time_is_refused(self):
        with pytest.raises(ValueError):
            clean_rules({"work_start": "9 o'clock"})

    def test_grace_is_bounded(self):
        with pytest.raises(ValueError):
            clean_rules({"grace_minutes": -1})
        with pytest.raises(ValueError):
            clean_rules({"grace_minutes": 10000})

    def test_week_off_days_are_bounded_to_the_week(self):
        with pytest.raises(ValueError):
            clean_rules({"week_offs": [7]})
        with pytest.raises(ValueError):
            clean_rules({"week_offs": [-1]})

    def test_every_day_off_is_refused(self):
        # Not a roster -- a closed branch, and it would pay everybody in full for a month
        # of week_off.
        with pytest.raises(ValueError):
            clean_rules({"week_offs": [0, 1, 2, 3, 4, 5, 6]})

    def test_week_off_days_are_deduplicated_and_sorted(self):
        assert clean_rules({"week_offs": [6, 0, 6]})["week_offs"] == [0, 6]

    def test_a_branch_with_half_written_rules_still_gets_a_working_day(self):
        # This runs on every read of the register. A branch whose stored rules are
        # nonsense must produce a day, not a 500 on a screen listing who came in.
        assert rules_of({"attendance_rules": {"work_start": "nonsense"}}) == DEFAULTS
        assert rules_of({"attendance_rules": None}) == DEFAULTS
        assert rules_of(None) == DEFAULTS

    def test_stored_rules_are_read_back(self):
        got = rules_of({"attendance_rules": {"work_start": "07:00", "week_offs": [1]}})
        assert got["work_start"] == "07:00"
        assert got["week_offs"] == [1]
        # Untouched fields keep the defaults rather than going missing.
        assert got["grace_minutes"] == DEFAULTS["grace_minutes"]


class TestWeekOff:
    def test_the_branch_rest_day_is_off(self):
        assert is_week_off(RULES, SUN) is True

    def test_every_other_day_is_not(self):
        assert is_week_off(RULES, MON) is False
        assert is_week_off(RULES, SAT) is False

    def test_a_branch_that_rests_on_tuesday_rests_on_tuesday(self):
        tuesdays = clean_rules({"week_offs": [1]})
        assert is_week_off(tuesdays, TUE) is True
        # And works Sundays, which is the half people forget.
        assert is_week_off(tuesdays, SUN) is False

    def test_working_days_drops_the_rest_days(self):
        assert working_days(RULES, [SAT, SUN, MON]) == [SAT, MON]

    def test_a_rest_day_needs_no_clock_to_be_a_rest_day(self):
        assert status(iso=SUN, clock=None)["status"] == WEEK_OFF

    def test_a_rest_day_worked_is_still_a_rest_day(self):
        # As far as pay is concerned. The hours are on the row beside it either way, and
        # calling it present would quietly turn a favour into an ordinary day.
        assert status(iso=SUN, clock=clocked())["status"] == WEEK_OFF


class TestDerivedFromTheClock:
    def test_on_time_is_present(self):
        assert status(clock=clocked("09:00"))["status"] == PRESENT

    def test_inside_the_grace_is_still_present(self):
        assert status(clock=clocked("09:15"))["status"] == PRESENT

    def test_past_the_grace_is_late(self):
        assert status(clock=clocked("09:16"))["status"] == LATE

    def test_early_is_present(self):
        assert status(clock=clocked("08:30"))["status"] == PRESENT

    def test_a_short_day_is_a_half_day(self):
        assert status(clock=clocked("09:00", "12:00"), worked=180)["status"] == HALF_DAY

    def test_the_half_day_threshold_itself_is_a_full_day(self):
        assert status(clock=clocked("09:00", "13:00"), worked=240)["status"] == PRESENT

    def test_a_short_day_that_also_started_late_is_a_half_day(self):
        # Half day is the one with pay attached, so it is the one that gets said.
        assert status(clock=clocked("11:00", "13:00"), worked=120)["status"] == HALF_DAY

    def test_a_day_still_running_is_not_judged_on_hours_so_far(self):
        # Ten in the morning would otherwise make the whole floor a half day.
        running = {"clock_in": "09:00", "clock_out": ""}
        assert status(iso=TODAY, clock=running, worked=60, today=TODAY)["status"] == PRESENT

    def test_a_day_still_running_can_still_be_late(self):
        running = {"clock_in": "10:30", "clock_out": ""}
        assert status(iso=TODAY, clock=running, worked=60, today=TODAY)["status"] == LATE

    def test_everything_derived_is_marked_auto(self):
        for out in (status(clock=clocked()), status(iso=SUN), status(clock=None)):
            assert out["auto"] is True


class TestUnclockedDays:
    def test_a_past_working_day_nobody_clocked_is_absent(self):
        assert status(iso=MON, clock=None, today=TODAY)["status"] == ABSENT

    def test_today_is_not_an_absence_yet(self):
        # The day is still going. Nine in the morning is too early to conclude anything.
        assert status(iso=TODAY, clock=None, today=TODAY)["status"] == ""

    def test_a_future_day_is_not_an_absence(self):
        assert status(iso=TOMORROW, clock=None, today=TODAY)["status"] == ""

    def test_somebody_with_no_login_is_never_absent(self):
        # The guard the whole feature rests on. They cannot press a button they were never
        # given, so their silence is not evidence and must not cost them a day's pay.
        assert status(iso=MON, clock=None, today=TODAY, has_login=False)["status"] == ""

    def test_a_rest_day_beats_the_absence_rule(self):
        assert status(iso=SUN, clock=None, today=TODAY, has_login=True)["status"] == WEEK_OFF


class TestDecisionsBeatReadings:
    def test_an_hr_mark_stands_over_the_clock(self):
        mark = {"status": "holiday", "marked_by": "Priya"}
        out = status(clock=clocked("11:00"), mark=mark)
        assert out["status"] == "holiday"
        assert out["auto"] is False

    def test_an_hr_mark_stands_over_a_week_off(self):
        mark = {"status": PRESENT, "marked_by": "Priya"}
        assert status(iso=SUN, mark=mark)["status"] == PRESENT

    def test_an_hr_mark_stands_over_an_absence(self):
        mark = {"status": PRESENT, "marked_by": "Priya"}
        assert status(iso=MON, clock=None, mark=mark)["status"] == PRESENT

    def test_an_approved_leave_stands(self):
        mark = {"status": "leave", "approval_id": "a1"}
        out = status(iso=MON, clock=None, mark=mark)
        assert out["status"] == "leave"
        assert out["auto"] is False

    def test_the_clocks_own_old_stamp_is_not_a_decision(self):
        # Rows the clock wrote before attendance was derived carry `present` for days that
        # may have been late. Treating those as somebody's decision would freeze the whole
        # history at the old guess; they are stepped over and re-read instead.
        stale = {"status": PRESENT, "marked_by": CLOCK_MARK}
        out = status(clock=clocked("11:00"), mark=stale)
        assert out["status"] == LATE
        assert out["auto"] is True

    def test_an_empty_mark_decides_nothing(self):
        assert decided_status({}) == ""
        assert decided_status(None) == ""
        assert decided_status({"status": ""}) == ""


class TestTimeParsing:
    def test_reads_a_time(self):
        assert parse_hhmm("07:30") == 450

    @pytest.mark.parametrize("bad", ["", "7.30", "24:00", "12:60", None, "noon", 930])
    def test_refuses_what_is_not_one(self, bad):
        assert parse_hhmm(bad) is None

    def test_agrees_with_the_shift_parser_it_was_copied_from(self):
        # Two copies exist on purpose (see the note in attendance_rules). They must not
        # drift, so they are held to each other here.
        from shift_utils import parse_hhmm as shift_parse
        for value in ["00:00", "09:15", "23:59", "24:00", "", "bad", "7:5"]:
            assert parse_hhmm(value) == shift_parse(value), value


class TestAgainstTheRegistersVocabulary:
    def test_the_statuses_are_the_registers_statuses(self):
        # This module names them rather than importing them, to avoid an import loop. If
        # the register ever renames one, this is what says so.
        from routers.v3_hr_ops import ABSENT as A, HALF_DAY as H, LATE as L
        from routers.v3_hr_ops import PRESENT as P, WEEK_OFF as W
        assert (PRESENT, LATE, HALF_DAY, ABSENT, WEEK_OFF) == (P, L, H, A, W)

    def test_every_derived_status_costs_what_the_register_says_it_costs(self):
        from routers.v3_hr_ops import LOP_DAYS
        # The four this module can produce on its own, and the pay behind each. Half a day
        # for a half day, a whole one for an absence, nothing for the rest.
        assert LOP_DAYS[PRESENT] == 0.0
        assert LOP_DAYS[LATE] == 0.0
        assert LOP_DAYS[WEEK_OFF] == 0.0
        assert LOP_DAYS[HALF_DAY] == 0.5
        assert LOP_DAYS[ABSENT] == 1.0
