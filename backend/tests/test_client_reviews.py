"""The rules behind Client Reviews: what a save keeps, and how the figures are worked out.

Unit tests like test_hr_ops_payroll.py -- they call the functions directly, with no
database, server or login. See backend/routers/v3_client_reviews.py.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import HTTPException  # noqa: E402

from routers.v3_client_reviews import ClientReviewIn, build_review, summarise  # noqa: E402

TEAM = {"consultant": {"id": "d1", "name": "Dr Abdul"}, "physio": {"id": "p1", "name": "Priya"}}


class TestBuildReview:
    def test_needs_at_least_one_rating(self):
        with pytest.raises(HTTPException) as err:
            build_review(ClientReviewIn(summary="lovely"), TEAM)
        assert err.value.status_code == 400

    def test_keeps_both_ratings_and_words(self):
        row = build_review(ClientReviewIn(
            consultant_rating=5, consultant_comment=" clear ", physio_rating=3, physio_comment="ok", summary="good",
        ), TEAM)
        assert row["consultant_rating"] == 5 and row["consultant_comment"] == "clear"
        assert row["physio_rating"] == 3 and row["physio_name"] == "Priya"
        assert row["summary"] == "good"

    def test_out_of_range_stars_are_dropped_not_clamped(self):
        with pytest.raises(HTTPException):
            build_review(ClientReviewIn(consultant_rating=9, physio_rating=0), TEAM)

    def test_no_physio_means_no_physio_rating(self):
        team = {**TEAM, "physio": {"id": "", "name": ""}}
        row = build_review(ClientReviewIn(consultant_rating=4, physio_rating=1, physio_comment="x"), team)
        assert row["physio_rating"] is None and row["physio_comment"] == ""

    def test_comment_without_its_rating_is_not_kept(self):
        row = build_review(ClientReviewIn(physio_rating=4, consultant_comment="orphan"), TEAM)
        assert row["consultant_rating"] is None and row["consultant_comment"] == ""


class TestSummarise:
    def test_empty(self):
        s = summarise([])
        assert s["total"] == 0 and s["consultant_average"] is None and s["consultants"] == []

    def test_averages_counts_and_low(self):
        rows = [
            {"consultant_name": "Dr Abdul", "consultant_rating": 5, "physio_name": "Priya", "physio_rating": 2},
            {"consultant_name": "Dr Abdul", "consultant_rating": 4, "physio_name": "Priya", "physio_rating": None},
            {"consultant_name": "Dr Meena", "consultant_rating": 3, "physio_name": "", "physio_rating": None},
        ]
        s = summarise(rows)
        assert s["total"] == 3
        assert s["consultant_average"] == 4.0 and s["consultant_count"] == 3
        assert s["physio_average"] == 2.0 and s["physio_count"] == 1
        assert s["low"] == 1
        assert s["consultants"][0] == {"name": "Dr Abdul", "count": 2, "average": 4.5}
        assert s["physios"] == [{"name": "Priya", "count": 1, "average": 2.0}]
