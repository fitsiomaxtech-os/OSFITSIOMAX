"""The rules behind Client Reviews: which weeks are owed stars, how old rows are read, and how the figures are worked out.

Unit tests like test_hr_ops_payroll.py -- they call the functions directly, with no
database, server or login. See backend/routers/v3_client_reviews.py.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import HTTPException  # noqa: E402

from routers.v3_client_reviews import (  # noqa: E402
    course_weeks, pending_weeks, required_comment, required_rating, split_legacy, summarise, week_of,
)


class TestRequiredRating:
    def test_missing_or_out_of_range_is_refused(self):
        for bad in (None, 0, 6, "x"):
            with pytest.raises(HTTPException):
                required_rating(bad)

    def test_keeps_valid(self):
        assert required_rating("4") == 4


def _day(n, week, status="completed", when=None, track="treatment", physio="Priya"):
    return {"id": f"{track}-{n}", "track": track, "session_number": n, "week_number": week, "status": status,
            "completed_at": when or f"2026-09-{16 + n:02d}T10:00:00", "physio_name": physio}


class TestCourseWeeks:
    def test_week_complete_only_when_every_day_is(self):
        days = [_day(n, 1) for n in range(1, 8)] + [_day(8, 2), _day(9, 2, status="upcoming")]
        weeks = course_weeks(days)
        assert [(w["week_number"], w["complete"]) for w in weeks] == [(1, True), (2, False)]
        assert weeks[0]["first_number"] == 1 and weeks[0]["last_number"] == 7 and weeks[0]["finished_at"].startswith("2026-09-23")
        assert weeks[1]["finished_at"] == ""

    def test_opens_on_is_the_last_day_of_the_week(self):
        days = [{**_day(n, 1, status="upcoming"), "slot_time": f"2026-09-{16 + n:02d}T10:00:00"} for n in range(1, 8)]
        assert course_weeks(days)[0]["opens_on"] == "2026-09-23"

    def test_rehab_weeks_are_every_seven_days(self):
        days = [{"id": f"r{n}", "track": "rehab", "day_number": n, "status": "completed",
                 "completed_at": "2026-09-20T10:00:00"} for n in range(1, 9)]
        assert [(w["week_number"], w["days"]) for w in course_weeks(days)] == [(1, 7), (2, 1)]

    def test_week_of_falls_back_to_number(self):
        assert week_of({"session_number": 14}) == 2 and week_of({"session_number": 15}) == 3
        assert week_of({"session_number": 3, "week_number": 5}) == 5


class TestPendingWeeks:
    WEEKS = course_weeks(
        [_day(n, 1) for n in range(1, 8)]
        + [_day(n, 2, when="2026-09-01T10:00:00") for n in range(8, 10)]
        + [_day(n, 3, status="upcoming") for n in range(10, 12)]
        + [_day(1, None, track="rehab")]
    )

    def test_complete_weeks_since_start_owe_both_halves(self):
        out = pending_weeks(self.WEEKS, [], has_consultant=True, since="2026-09-16")
        assert [(w["track"], w["week_number"]) for w in out] == [("rehab", 1), ("treatment", 1)]
        treatment = out[1]
        assert treatment["needs_physio"] and treatment["needs_consultant"]
        assert out[0]["needs_physio"] and not out[0]["needs_consultant"]

    def test_given_halves_drop_out(self):
        rows = [{"source": "week", "kind": "physio", "track": "treatment", "week_number": 1},
                {"source": "week", "kind": "physio", "track": "rehab", "week_number": 1}]
        out = pending_weeks(self.WEEKS, rows, has_consultant=True, since="2026-09-16")
        assert len(out) == 1 and not out[0]["needs_physio"] and out[0]["needs_consultant"]
        assert pending_weeks(self.WEEKS, rows, has_consultant=False, since="2026-09-16") == []


class TestRequiredComment:
    def test_blank_is_refused(self):
        with pytest.raises(HTTPException):
            required_comment("   ", "physio")
        assert required_comment(" good ", "physio") == "good"


class TestSplitLegacy:
    def test_old_row_reads_as_two(self):
        rows = split_legacy({
            "id": "r1", "lead_id": "l1", "consultant_name": "Dr Abdul", "consultant_rating": 4,
            "physio_name": "Priya", "physio_rating": 2, "physio_comment": "slow", "summary": "ok",
            "created_at": "2026-09-01",
        })
        assert [r["kind"] for r in rows] == ["consultant", "physio"]
        assert rows[1]["rating"] == 2 and rows[1]["person_name"] == "Priya" and "slow" in rows[1]["comment"]

    def test_new_row_untouched(self):
        row = {"id": "x", "kind": "physio", "rating": 5}
        assert split_legacy(row) == [row]


class TestSummarise:
    def test_empty(self):
        s = summarise([])
        assert s["total"] == 0 and s["average"] is None and s["people"] == []

    def test_averages_low_and_anytime(self):
        rows = [
            {"person_name": "Dr Abdul", "rating": 5},
            {"person_name": "Dr Abdul", "rating": 2},
            {"person_name": "Dr Meena", "rating": 3},
            {"person_name": "Dr Meena", "rating": 4, "source": "anytime"},
        ]
        s = summarise(rows)
        assert s["total"] == 4 and s["average"] == 3.5 and s["low"] == 1 and s["anytime"] == 1
        assert s["people"][0] == {"name": "Dr Abdul", "count": 2, "average": 3.5}
