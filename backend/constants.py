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

V3_CONSULTATION_STAGES = [
    "New Appointment",
    "RNR",
    "Follow Up",
    "Consultation Visit",
    "Consultation Pack",
    "Physio Assign",
    "Consultation Fee",
    "Treatment Fee",
    "Cancel",
]

# Standalone Head Physio consultation pipeline — fully independent from the
# Branch's V3_CONSULTATION_STAGES above (separate lead field, separate stage type).
V3_HEAD_CONSULTATION_STAGES = [
    "New Appointment",
    "Consultation Visit",
    "Consultation Pack",
    "Physio Assign",
]
