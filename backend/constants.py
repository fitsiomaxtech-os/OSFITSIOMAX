SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]

V2_LOCATIONS = ["Anna Nagar", "T Nagar", "Parrys", "ECR"]

V3_VERTICALS = [
    "offline_physiotherapy",
    "online_physiotherapy",
    "online_fitness",
    "offline_fitness_gym",
]

V3_STAGES = [
    "New Leads",
    "RNR",
    "Follow Up",
    "Appointment",
]

V3_BRANCH_STAGES = [
    "New Appointment",
    "Portfolio",
    "Follow Up",
    "Appointment Date & Time",
    "Cancelled",
]

# The Branch ("sales") pipeline is one shared list, but its opening stages depend on who
# works the lead first — see lead_control. A sales stage may carry an `applies_to` of
# "pre_sales" or "branch_admin" to appear only for branches under that Lead Control;
# a stage with no `applies_to` (the default, and every stage that shipped before this)
# belongs to both and is what the bulk of the pipeline stays.
#
# A branch on Pre-Sales control opens at "New Appointment" — the lead was already worked
# and qualified by the Pre-Sales desk, so it arrives as a booked appointment. A branch
# running its own leads has done none of that yet: the lead is raw, so it opens at
# "Branch Assign" and gets an RNR stage for the calls that go unanswered, mirroring the
# Pre-Sales desk's own New Leads -> RNR -> Follow Up shape.
BRANCH_ADMIN_ENTRY_STAGE = "Branch Assign"
BRANCH_ADMIN_RNR_STAGE = "RNR"

# Where a branch appointment goes when it is called off. Last in the pipeline and final:
# nothing moves on from it, and reaching it releases the slot the consultation was holding
# (see v3_move_branch_stage).
#
# Named here rather than written as a literal at each site because three of them have to
# agree -- the seed that creates the pill, the stage move that frees the slot, and the
# booking endpoint's own final_stage -- and they were already one rename apart from
# silently doing nothing. Note it is "Cancelled", not the consultation pipeline's "Cancel":
# two pipelines, two stages, and the Branch Leads card shows both.
BRANCH_CANCELLED_STAGE = "Cancelled"

# Branch's own consultation pipeline. "New Appointment" was retired, and the stage that
# replaced it — "Follow Up" — has since been renamed "Consultation Booked" (see
# seed.migrate_consultation_stages). The Head Physio's independent pipeline below still
# has its own New Appointment stage.
#
# The rename is not cosmetic. This is where a lead lands the moment Branch Leads books its
# appointment, and while it was called "Follow Up" it shared a name with the Branch
# ("sales") pipeline's own Follow Up stage — which meant the Consultation tab dropped it
# from its pill bar (one name, one pill, kept on the Branch side; see
# consultationOnlyStages in BranchAdminBoard.jsx). Every freshly booked patient therefore
# sat on a stage that tab had no pill for: in the list, counted in All Stages, and under
# none of the cards above it. A name of its own gives the stage a pill of its own.
V3_CONSULTATION_STAGES = [
    "Consultation Booked",
    "Consultation Visit",
    "Fee Collected",
    "Physio Assign",
    # "Consultation Completed" was here. It is still written to a lead -- it is how a
    # Consultation Only patient is closed out -- but it has no pill of its own any more:
    # the Completed stage takes those patients in beside everybody who finished a course.
    # See retire_consultation_completed_stage in seed.py.
    "Cancel",
]

# Standalone Head Physio consultation pipeline — fully independent from the
# Branch's V3_CONSULTATION_STAGES above (separate lead field, separate stage type).
# Consultation Pack is chosen inline in the lead popup (not a stage move), and Physio
# Assign lives entirely on Branch Admin's own board now (after Treatment Fee).
V3_HEAD_CONSULTATION_STAGES = [
    "New Appointment",
    "Consultation Visit",
]

# Recruitment pipeline for the Human Resource Master View. Candidates (job seekers), not
# patients — they live in their own `candidates` collection and never touch `leads`.
#
# Seeded once by v3_recruitment._ensure_recruitment_stages, then owned by the database:
# nothing reads these literals at runtime, so HR renaming a stage is safe. Candidates
# reference a stage by id, not by name, so a rename needs no migration at all.
V3_RECRUITMENT_STAGES = [
    # (name, colour, is_final)
    ("Applied", "#6366f1", False),
    ("Screening", "#0ea5e9", False),
    ("Interview", "#f59e0b", False),
    ("Selected", "#a855f7", False),
    ("Offer Sent", "#14b8a6", False),
    ("Joined", "#22c55e", True),
    ("Rejected", "#ef4444", True),
]
