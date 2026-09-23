"""Which branch a sheet row asks for, when the row asks for one.

A Lead Source card belongs to one branch, and until now every row it pulled went to that
branch — the branch was a property of the sheet, not of the patient. A form that asks
"Which is your preferred location" is the other case: one form feeding every branch, with
the answer sitting in a column whose values are branch names in whatever spelling the form
offered — "anna_nagar", "ECR", "t_nagar". Those rows have to be split up on the way in, or
the whole form lands on one branch's board and someone re-files it by hand.

Matched on the words, not on the string. A branch is called "Anna Nagar Branch" and the
form says "anna_nagar"; neither of those is the other with the punctuation taken out, so
comparing spellings would match nothing and comparing substrings would match too much
("ecr" is inside "Secretariat"). Tokens, minus the words that describe every branch
equally ("branch", "physiotherapy"), so the only thing left to compare is the part that
names the place.

An answer naming no branch — or naming two, which "nagar" does here — routes nowhere, and
the source's own branch stands. Silence is the safe reading: a lead on the source's branch
is where it would have gone anyway, while a lead guessed onto the wrong branch is a patient
the right branch never calls.

Nothing here is specific to the four locations live today. The table is the branch list, so
a branch opened next month routes the moment its name appears in the sheet.
"""

import re
from typing import Dict, List, Optional, Set


# Words that appear in a branch name (or in the answer the form collected) without helping
# to say which branch it is. Stripped from both sides before comparing, so "Anna Nagar
# Branch", "Anna Nagar Physiotherapy" and "anna_nagar" all come down to {anna, nagar}.
# Mirrors seed._LEAD_SOURCE_NAME_FILLER, misspellings and all — the same names are being
# read, and this is matching rather than spellchecking.
FILLER = {
    "branch", "branches", "physio", "physiotherapy", "physiotherphy", "physiotheraphy",
    "fitness", "online", "offline", "clinic", "clinics", "centre", "center", "location",
}


def tokens(value: object) -> Set[str]:
    """The words of a name that actually name a place.

    Single letters are kept: "T Nagar" is one of the four locations and dropping its "t"
    would leave {nagar}, which "Anna Nagar" also contains — two branches answering to one
    token is exactly the ambiguity the resolver below refuses to guess through.

    An apostrophe is removed rather than split on, because the place is Parry's Corner and
    the branch is "Parrys Branch": split, the answer comes apart into {parry, s} and matches
    neither. Every other punctuation mark is a separator, which is what turns "anna_nagar"
    and "T-Nagar" into words.
    """
    text = str(value or "").lower().replace("'", "").replace("’", "")
    words = re.findall(r"[a-z0-9]+", text)
    return {w for w in words if w not in FILLER}


class BranchRouter:
    """The branch list, ready to be asked "who is this answer naming?".

    Built once per import rather than queried per row: a pull is thousands of rows against
    a handful of branches, and the branch list does not change mid-pull.
    """

    def __init__(self, branches: List[Dict[str, object]]):
        self.by_id = {b["id"]: b for b in branches if b.get("id")}
        self._tokens = {b["id"]: tokens(b.get("branch_name")) for b in branches if b.get("id")}
        # A form that offers branch codes rather than names ("ANN", "ECR") is answered from
        # here. Exact match only — a code is three letters and has no words to compare.
        self._codes: Dict[str, str] = {}
        for b in branches:
            code = str(b.get("code") or "").strip().lower()
            if code and code not in self._codes:
                self._codes[code] = b["id"]

    def resolve(self, value: object) -> Optional[str]:
        """The branch id this answer names, or None where it names none or several."""
        wanted = tokens(value)
        if not wanted:
            return None

        # Same words, in any order or spelling: "anna_nagar" and "Anna Nagar Branch".
        exact = [bid for bid, t in self._tokens.items() if t and t == wanted]
        if len(exact) == 1:
            return exact[0]
        if exact:
            return None

        # One name containing the other: an answer of "ECR Chennai" against "ECR Branch",
        # or "Anna Nagar" against a branch spelled "Anna Nagar East". Only where exactly
        # one branch fits — "nagar" alone fits two of the four and is not an answer.
        overlap = [
            bid for bid, t in self._tokens.items()
            if t and (t <= wanted or wanted <= t)
        ]
        if len(overlap) == 1:
            return overlap[0]
        if overlap:
            return None

        code = str(value or "").strip().lower()
        return self._codes.get(code)

    def name_of(self, branch_id: Optional[str]) -> str:
        return str((self.by_id.get(branch_id) or {}).get("branch_name") or "")


async def load() -> BranchRouter:
    """The branch list, as a router. The one function here that needs a database.

    Imported inside rather than at the top so everything above it — which is all of the
    matching, and all of the reasoning worth testing — can be exercised without a Mongo
    connection. Same arrangement as lead_mapping, and for the same reason.
    """
    from database import v3_col

    branches = await v3_col("branches").find(
        {}, {"_id": 0, "id": 1, "branch_name": 1, "code": 1}
    ).to_list(1000)
    return BranchRouter(branches)


# The mapping key a location column is mapped onto. The column has always been mappable —
# it is "Preferred Branch" in the Edit Mapping dialog, and the answer has always been kept
# against the lead as extra detail. What is new is that the answer is now read: see
# routed_branch_id below, and lead_mapping.LEGACY_EXTRA_FIELDS for where the value itself
# still lands.
BRANCH_FIELD = "preferred_branch"


def routed_branch_id(
    row: Dict[str, object], mapping: Dict[str, str], router: BranchRouter
) -> Optional[str]:
    """The branch this row asks for, read through the source's own column mapping.

    Through the mapping rather than by hunting the row for a likely-looking column, so the
    column a Super Admin picked in Edit Mapping is the column that routes — a sheet whose
    location question is headed something no alias list would guess is fixed by mapping it,
    with no code change.
    """
    column = (mapping or {}).get(BRANCH_FIELD)
    if not column:
        return None
    return router.resolve(row.get(column))
