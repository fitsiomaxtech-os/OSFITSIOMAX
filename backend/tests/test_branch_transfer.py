"""Branch Transfer — the two eligibility windows, and the money that must not follow.

Unit tests against a stubbed collection layer rather than a live server, unlike the
iteration suites beside them. Both things under test here are decisions taken in pure
Python off a lead document, and both fail silently when they are wrong: a window that is a
stage too wide moves a patient off a slot somebody is expecting them at, and a revenue
split that is a rupee out changes a P&L nobody is going to re-check.
"""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import branch_transfer as bt


# ---------------------------------------------------------------- stubbed collections


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return list(self._rows)


class _FakeCollection:
    def __init__(self, rows):
        self._rows = rows

    def find(self, query=None, _projection=None):
        query = query or {}
        return _FakeCursor([r for r in self._rows if all(r.get(k) == v for k, v in query.items())])

    async def find_one(self, query=None, _projection=None, **_kwargs):
        return next(iter(self.find(query)._rows), None)


CONSULTATION_STAGES = [
    {"name": "Follow Up", "type": "consultation", "order": 0},
    {"name": "Consultation Visit", "type": "consultation", "order": 1},
    {"name": "Fee Collected", "type": "consultation", "order": 2},
    {"name": "Physio Assign", "type": "consultation", "order": 3},
    {"name": "Cancel", "type": "consultation", "order": 4},
]

# A Pre-Sales-fed branch opens at New Appointment; one running its own leads opens at
# Branch Assign. Both are in the one `sales` list, told apart by applies_to — see
# backend/constants.py.
SALES_STAGES = [
    {"name": "Branch Assign", "type": "sales", "order": 0, "applies_to": "branch_admin"},
    {"name": "RNR", "type": "sales", "order": 1, "applies_to": "branch_admin"},
    {"name": "New Appointment", "type": "sales", "order": 2, "applies_to": "pre_sales"},
    {"name": "Follow Up", "type": "sales", "order": 3},
    {"name": "Appointment Date & Time", "type": "sales", "order": 4},
    {"name": "Cancelled", "type": "sales", "order": 5},
]

BRANCHES = [
    {"id": "anna", "branch_name": "Anna Nagar", "lead_control": "pre_sales"},
    {"id": "tnagar", "branch_name": "T Nagar", "lead_control": "branch_admin"},
]


@pytest.fixture(autouse=True)
def stub_db(monkeypatch):
    """Point every v3_col(...) this module reaches through at an in-memory list.

    Patched on the three modules that resolved the name at import time — branch_transfer
    itself and the two helpers it calls into — because `from database import v3_col` binds
    a reference, so patching `database.v3_col` alone would leave those three untouched.
    """
    collections = {
        "pipeline_stages": _FakeCollection(CONSULTATION_STAGES + SALES_STAGES),
        "branches": _FakeCollection(BRANCHES),
    }

    def fake_v3_col(name):
        return collections.setdefault(name, _FakeCollection([]))

    import lead_control
    import stage_utils
    for module in (bt, stage_utils, lead_control):
        monkeypatch.setattr(module, "v3_col", fake_v3_col)
    return collections


def window(lead):
    return asyncio.run(bt.transfer_window(lead))


# ---------------------------------------------------------------- the two open windows


def test_untouched_lead_at_a_presales_branch_is_in_the_lead_window():
    got, why = window({"id": "l1", "branch_id": "anna", "branch_stage": "New Appointment"})
    assert got == bt.WINDOW_LEAD, why


def test_untouched_lead_at_a_branch_admin_branch_is_in_the_lead_window():
    """The entry stage is not one global name — a branch running its own leads opens at
    Branch Assign, and hardcoding the other mode's stage would refuse every one of them."""
    got, why = window({"id": "l2", "branch_id": "tnagar", "branch_stage": "Branch Assign"})
    assert got == bt.WINDOW_LEAD, why


def test_lead_with_no_branch_stage_at_all_is_in_the_lead_window():
    got, _ = window({"id": "l3", "branch_id": "anna", "branch_stage": None})
    assert got == bt.WINDOW_LEAD


def test_patient_at_physio_assign_is_in_the_treatment_window():
    got, why = window({
        "id": "l4", "branch_id": "anna", "branch_stage": "Appointment Date & Time",
        "consultation_stage": "Physio Assign",
    })
    assert got == bt.WINDOW_TREATMENT, why


# ---------------------------------------------------------------- and the closed gap


@pytest.mark.parametrize("branch_stage", ["Follow Up", "Appointment Date & Time", "Cancelled", "RNR"])
def test_worked_lead_before_the_consultation_is_refused(branch_stage):
    got, why = window({"id": "l5", "branch_id": "anna", "branch_stage": branch_stage})
    assert got is None
    assert branch_stage in why  # the refusal names the stage that is in the way


@pytest.mark.parametrize("stage", ["Follow Up", "Consultation Visit", "Fee Collected"])
def test_consultation_in_flight_is_refused(stage):
    got, why = window({
        "id": "l6", "branch_id": "anna", "branch_stage": "Appointment Date & Time",
        "consultation_stage": stage,
    })
    assert got is None
    assert stage in why


def test_cancel_is_a_side_exit_not_a_later_stage():
    """Cancel sorts after Physio Assign, so an index comparison alone would read a called-off
    consultation as 'past' the window and let it through."""
    got, _ = window({"id": "l7", "branch_id": "anna", "consultation_stage": "Cancel"})
    assert got is None


def test_retired_stage_is_refused_rather_than_crashing():
    """Consultation Completed is still written to leads but has no pill — .index() on it
    would raise, and a ValueError out of an eligibility check is a 500 on a board."""
    got, why = window({"id": "l8", "branch_id": "anna", "consultation_stage": "Consultation Completed"})
    assert got is None
    assert "Consultation Completed" in why


def test_lead_with_no_branch_cannot_be_transferred():
    got, why = window({"id": "l9", "branch_id": None, "branch_stage": None})
    assert got is None
    assert "not at a branch" in why


# ---------------------------------------------------------------- the money


def test_a_transfer_leaves_the_paying_branch_its_own_revenue():
    lead = {"branch_id": "anna", "consultation_fee": 1000, "treatment_fee_paid": 20000}
    delta = bt._freeze_delta(lead)
    assert delta == {"consultation_fee": 1000.0, "treatment_fee_paid": 20000.0}


def test_two_transfers_split_three_ways_without_double_counting():
    """A -> B -> C. Each branch keeps what it took while it held the patient, and the three
    shares still add up to what the patient has actually paid."""
    lead = {"branch_id": "A", "consultation_fee": 1000, "treatment_fee_paid": 20000}
    first = bt._freeze_delta(lead)

    lead = {**lead, "branch_id": "B", "revenue_frozen": [{"branch_id": "A", **first}]}
    lead["treatment_fee_paid"] = 25000            # B collected another 5,000
    second = bt._freeze_delta(lead)
    assert second == {"treatment_fee_paid": 5000.0}

    lead = {**lead, "branch_id": "C",
            "revenue_frozen": lead["revenue_frozen"] + [{"branch_id": "B", **second}]}
    lead["treatment_fee_paid"] = 30000            # and C another 5,000

    assert bt.branch_share(lead, "treatment_fee_paid", "A") == 20000
    assert bt.branch_share(lead, "treatment_fee_paid", "B") == 5000
    assert bt.branch_share(lead, "treatment_fee_paid", "C") == 5000
    # The consultation fee was taken once, at A, and stays there.
    assert bt.branch_share(lead, "consultation_fee", "A") == 1000
    assert bt.branch_share(lead, "consultation_fee", "C") == 0
    # Unscoped, every rupee is counted exactly once.
    assert bt.branch_share(lead, "treatment_fee_paid", None) == 30000

    splits = bt.branch_splits(lead)
    assert sum(v["treatment_fee_paid"] for v in splits.values()) == 30000
    assert sum(v["consultation_fee"] for v in splits.values()) == 1000


def test_a_branch_the_patient_never_visited_gets_nothing():
    lead = {"branch_id": "A", "consultation_fee": 1000}
    assert bt.branch_share(lead, "consultation_fee", "Z") == 0.0


def test_a_refund_below_an_earlier_branchs_take_is_not_a_debt():
    """A running total revised down past what a previous branch banked leaves the current
    branch at zero, never negative — a branch cannot owe revenue to the one before it."""
    lead = {"branch_id": "B", "treatment_fee_paid": 15000,
            "revenue_frozen": [{"branch_id": "A", "treatment_fee_paid": 20000}]}
    assert bt.branch_share(lead, "treatment_fee_paid", "B") == 0.0
    assert bt._freeze_delta(lead) == {}


def test_a_payment_row_is_attributed_to_the_till_it_went_through():
    lead = {"branch_id": "C"}
    assert bt.activity_branch({"branch_id": "A"}, lead) == "A"   # stamped at transfer time
    assert bt.activity_branch({}, lead) == "C"                   # collected since, so it is C's


def test_the_finance_lead_query_keeps_transferred_away_patients_on_the_book():
    q = bt.finance_lead_query("A")
    assert q == {"$or": [{"branch_id": "A"}, {"revenue_frozen.branch_id": "A"}]}
    assert bt.finance_lead_query(None) == {}
