"""The rules behind Client Reviews: which physio days are owed stars, how old rows are read, and how the figures are worked out.

Unit tests like test_hr_ops_payroll.py -- they call the functions directly, with no
database, server or login. See backend/routers/v3_client_reviews.py.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import HTTPException  # noqa: E402

from routers.v3_client_reviews import (  # noqa: E402
    pending_physio_days, required_rating, split_legacy, summarise,
)


class TestRequiredRating:
    def test_missing_or_out_of_range_is_refused(self):
        for bad in (None, 0, 6, "x"):
            with pytest.raises(HTTPException):
                required_rating(bad)

    def test_keeps_valid(self):
        assert required_rating("4") == 4


class TestPendingPhysioDays:
    DAYS = [
        {"id": "a", "status": "completed", "completed_at": "2026-09-20T10:00:00", "session_number": 2, "physio_name": "Priya"},
        {"id": "b", "status": "completed", "completed_at": "2026-09-17T10:00:00", "session_number": 1, "physio_name": "Priya"},
        {"id": "c", "status": "scheduled", "slot_time": "2026-09-21T10:00:00"},
        {"id": "d", "status": "completed", "completed_at": "2026-09-01T10:00:00"},
        {"id": "e", "status": "completed", "completed_at": "2026-09-18T10:00:00", "track": "rehab", "day_number": 1},
    ]

    def test_completed_since_start_not_yet_reviewed_oldest_first(self):
        out = pending_physio_days(self.DAYS, {"e"}, since="2026-09-16")
        assert [p["session_id"] for p in out] == ["b", "a"]

    def test_rehab_day_number_is_its_number(self):
        out = pending_physio_days(self.DAYS, set(), since="2026-09-16")
        rehab = next(p for p in out if p["session_id"] == "e")
        assert rehab["track"] == "rehab" and rehab["session_number"] == 1


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
