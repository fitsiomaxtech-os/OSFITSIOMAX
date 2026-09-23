"""Which branch a sheet row is read as asking for.

Unit tests, like test_attendance_rules.py beside this one and for the same reason: this
module decides which branch a patient's enquiry lands on. Get it wrong in the generous
direction and a lead is filed to a branch that never expected it, while the branch the
patient actually asked for never calls them back — and nothing on any board says the
enquiry was misread, because a lead on a branch board looks the same however it got there.

So the tests that matter most are the ones about refusing to guess: an answer naming no
branch, and an answer naming two, must both route nowhere and leave the source's own branch
standing. Those get as much space here as the happy path.

The four locations used throughout are the ones the live "Which is your preferred location"
column actually offers. Nothing here touches a database — see backend/branch_routing.py.
"""
import os
import sys

import pytest

# Same note as the files beside this one: pytest with no __init__.py puts this directory on
# the path rather than the backend root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from branch_routing import (  # noqa: E402
    BRANCH_FIELD, BranchRouter, routed_branch_id, tokens,
)


BRANCHES = [
    {"id": "b-anna", "branch_name": "Anna Nagar Branch", "code": "ANN"},
    {"id": "b-ecr", "branch_name": "ECR Branch", "code": "ECR"},
    {"id": "b-parrys", "branch_name": "Parrys Branch", "code": "PAR"},
    {"id": "b-tnagar", "branch_name": "T Nagar Branch", "code": "TNA"},
]


@pytest.fixture
def router():
    return BranchRouter(BRANCHES)


# --------------------------------------------------------------- the four live answers

@pytest.mark.parametrize("answer,branch_id", [
    ("anna_nagar", "b-anna"),
    ("ecr", "b-ecr"),
    ("parrys", "b-parrys"),
    ("t_nagar", "b-tnagar"),
])
def test_the_four_values_the_sheet_holds(router, answer, branch_id):
    """The column's own vocabulary, exactly as the form writes it."""
    assert router.resolve(answer) == branch_id


@pytest.mark.parametrize("answer,branch_id", [
    ("Anna Nagar", "b-anna"),
    ("ANNA_NAGAR", "b-anna"),
    ("anna-nagar", "b-anna"),
    ("  ecr  ", "b-ecr"),
    ("T Nagar", "b-tnagar"),
    ("T-Nagar Branch", "b-tnagar"),
    ("Parry's", "b-parrys"),
])
def test_spellings_of_the_same_answer(router, answer, branch_id):
    """A form names its own options, and the branch list was typed by someone else.

    Case, underscores, hyphens, padding and the apostrophe in Parry's are all the same
    answer — which is the whole reason this matches on words rather than on strings.
    """
    assert router.resolve(answer) == branch_id


@pytest.mark.parametrize("answer,branch_id", [
    ("Anna Nagar Physiotherapy", "b-anna"),
    ("ECR Branch, Chennai", "b-ecr"),
    ("Parrys Clinic", "b-parrys"),
])
def test_an_answer_that_says_more_than_the_branch_name(router, answer, branch_id):
    """Words that describe every branch equally are not what tells them apart."""
    assert router.resolve(answer) == branch_id


def test_branch_codes_answer_too(router):
    """A form offering codes rather than names still routes."""
    assert router.resolve("ANN") == "b-anna"
    assert router.resolve("tna") == "b-tnagar"


# ------------------------------------------------------------------- refusing to guess

@pytest.mark.parametrize("answer", ["", "   ", None, "-"])
def test_no_answer_routes_nowhere(router, answer):
    assert router.resolve(answer) is None


def test_an_unknown_place_routes_nowhere(router):
    """A location the clinic has no branch at is not an invitation to pick the closest
    spelling. The source's own branch stands instead — see routed_branch_id's callers."""
    assert router.resolve("Velachery") is None
    assert router.resolve("Bangalore") is None


def test_an_ambiguous_answer_routes_nowhere(router):
    """"nagar" is in two of the four branch names, so it names neither.

    This is the test that keeps the matcher honest: the moment this starts returning a
    branch, every half-typed answer starts landing on whichever branch sorted first.
    """
    assert router.resolve("nagar") is None


def test_filler_alone_routes_nowhere(router):
    """Words every branch shares carry no answer, even spelled as a whole one."""
    for answer in ("branch", "Physiotherapy", "online", "location"):
        assert router.resolve(answer) is None, answer


def test_a_yes_no_answer_routes_nowhere(router):
    """The column is sometimes not the column somebody mapped. A sheet whose mapped
    "location" question turns out to hold "Yes"/"No" imports as it always did rather
    than scattering leads."""
    assert router.resolve("Yes") is None
    assert router.resolve("No") is None


def test_tokens_drops_filler_but_keeps_single_letters():
    """T Nagar is a real location and its "T" is the only thing distinguishing it from
    Anna Nagar. Dropping short words — which the lead-source name matcher does — would
    collapse the two into one ambiguous {nagar}."""
    assert tokens("T Nagar Branch") == {"t", "nagar"}
    assert tokens("Anna Nagar Branch") == {"anna", "nagar"}


# ------------------------------------------------------- reading it through the mapping

def test_routes_through_the_sources_own_column_mapping(router):
    """The column a Super Admin picked in Edit Mapping is the column that routes."""
    mapping = {"phone": "Phone", BRANCH_FIELD: "Which is your preferred location"}
    row = {"Phone": "9876543210", "Which is your preferred location": "t_nagar"}
    assert routed_branch_id(row, mapping, router) == "b-tnagar"


def test_a_sheet_with_no_location_column_routes_nowhere(router):
    """A branch's own sheet has no such question, and its pull must behave exactly as it
    did before any of this existed."""
    row = {"Phone": "9876543210", "City": "Chennai"}
    assert routed_branch_id(row, {"phone": "Phone"}, router) is None
    assert routed_branch_id(row, {}, router) is None
    assert routed_branch_id(row, None, router) is None


def test_a_mapped_column_missing_from_the_row_routes_nowhere(router):
    """A mapping can outlive the column it names — the form question was renamed, or the
    tab is not the tab the mapping was saved against."""
    mapping = {BRANCH_FIELD: "Preferred Location"}
    assert routed_branch_id({"Phone": "9876543210"}, mapping, router) is None


def test_blank_answer_in_a_mapped_column_routes_nowhere(router):
    """An optional question the patient skipped."""
    mapping = {BRANCH_FIELD: "Preferred Location"}
    assert routed_branch_id({"Preferred Location": ""}, mapping, router) is None


def test_name_of_is_for_reporting_only(router):
    assert router.name_of("b-ecr") == "ECR Branch"
    assert router.name_of(None) == ""
    assert router.name_of("b-nonexistent") == ""


def test_an_empty_branch_list_routes_nothing():
    """A database with no branches yet must not throw on every imported row."""
    empty = BranchRouter([])
    assert empty.resolve("anna_nagar") is None
    assert empty.name_of("b-anna") == ""


def test_a_branch_added_later_routes_without_a_code_change():
    """The table is the branch list, not a list of the four locations live today."""
    later = BranchRouter(BRANCHES + [
        {"id": "b-velachery", "branch_name": "Velachery Branch", "code": "VEL"},
    ])
    assert later.resolve("velachery") == "b-velachery"
    assert later.resolve("anna_nagar") == "b-anna"
