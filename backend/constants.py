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

# Branch's own consultation pipeline. "New Appointment" was retired — consultations
# now begin at Follow Up (see seed.migrate_consultation_stages). The Head Physio's
# independent pipeline below still has its own New Appointment stage.
V3_CONSULTATION_STAGES = [
    "Follow Up",
    "Consultation Visit",
    "Fee Collected",
    "Physio Assign",
    "Consultation Completed",
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
