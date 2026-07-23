from pydantic import BaseModel, ConfigDict, field_validator
from typing import List, Optional, Dict, Literal, Any


class V3UserOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    full_name: str
    email: str
    # "pre_sales" is discontinued (no longer assignable — see v3_hr.DEFAULT_ROLES / v3_require_roles
    # call sites) but stays in this read-model's Literal so any pre-existing account with that role
    # still deserializes instead of 500ing every list/detail endpoint that returns it.
    role: Literal["super_admin", "business_dev", "pre_sales", "branch_admin", "head_physio", "physio", "marketing_head", "accountant"]
    branch_id: Optional[str] = None
    created_at: str

    @field_validator("role", mode="before")
    @classmethod
    def _normalize_role(cls, v):
        # "consultant" is a legacy/UI alias for "physio" — same permissions, different label.
        return "physio" if v == "consultant" else v


class V3LoginRequest(BaseModel):
    email: str
    password: str


class V3LoginResponse(BaseModel):
    token: str
    user: V3UserOut


class V3VerticalCreate(BaseModel):
    name: str
    active: bool = True


class V3VerticalOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    active: bool
    created_at: str


class V3BranchCreate(BaseModel):
    branch_name: str
    address: str
    admin_name: str
    admin_email: str
    admin_password: str
    admin_phone: Optional[str] = ""
    vertical: str = "offline_physiotherapy"


class V3BranchOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    branch_name: str
    address: str
    admin_user_id: str
    admin_name: str
    admin_email: str
    admin_phone: Optional[str] = ""
    vertical: str
    opened_date: Optional[str] = ""
    opening_hours: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    map_location: Optional[str] = ""
    weekly_hours: Optional[Dict[str, Any]] = None
    created_at: str


class V3BranchUpdate(BaseModel):
    branch_name: Optional[str] = None
    address: Optional[str] = None
    admin_name: Optional[str] = None
    admin_email: Optional[str] = None
    admin_phone: Optional[str] = None
    vertical: Optional[str] = None
    opened_date: Optional[str] = None
    opening_hours: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    map_location: Optional[str] = None
    weekly_hours: Optional[Dict[str, Any]] = None


class V3DoctorCreate(BaseModel):
    full_name: str
    profile_type: Literal["head_physio", "physio", "doctor"]
    branch_id: Optional[str] = None
    specialization: Optional[str] = ""
    employee_id: Optional[str] = None
    joining_date: Optional[str] = None


class V3DoctorSlotsInput(BaseModel):
    slots: List[str]


class V3DoctorOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    full_name: str
    profile_type: str
    branch_id: Optional[str] = None  # a head_physio user can exist before being assigned a branch
    specialization: Optional[str] = ""
    employee_id: Optional[str] = None
    joining_date: Optional[str] = None
    slots: List[str] = []
    created_at: str


class V3LeadCreate(BaseModel):
    name: str
    phone: str
    email: Optional[str] = ""
    vertical: str = "offline_physiotherapy"
    source_tab: Optional[str] = None
    source_type: Literal["manual", "google_sheet"] = "manual"
    branch_id: Optional[str] = None
    notes: Optional[str] = ""
    extra_fields: Optional[Dict[str, Any]] = None
    alternative_phone: Optional[str] = ""
    address: Optional[str] = ""
    city: Optional[str] = ""
    state: Optional[str] = ""
    location: Optional[str] = ""
    department: Optional[str] = ""
    condition: Optional[str] = ""
    months_of_pain: Optional[int] = None
    age: Optional[int] = None
    gender: Optional[str] = ""
    occupation: Optional[str] = ""
    expected_consultation_date: Optional[str] = ""


class V3LeadUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    vertical: Optional[str] = None
    source_tab: Optional[str] = None
    notes: Optional[str] = None
    stage: Optional[str] = None
    branch_id: Optional[str] = None
    extra_fields: Optional[Dict[str, Any]] = None
    location: Optional[str] = None
    expected_consultation_date: Optional[str] = None
    months_of_pain: Optional[int] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    occupation: Optional[str] = None
    department: Optional[str] = None
    alternative_phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    condition: Optional[str] = None
    assigned_user_id: Optional[str] = None
    assigned_user_name: Optional[str] = None


class V3LeadOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    phone: str
    email: Optional[str] = ""
    vertical: str
    source_tab: Optional[str] = None
    source_type: str
    stage: str
    branch_stage: Optional[str] = None
    consultation_stage: Optional[str] = None
    head_consultation_stage: Optional[str] = None  # Head Physio's own pipeline, independent from consultation_stage
    branch_id: Optional[str] = None
    notes: Optional[str] = ""
    extra_fields: Dict[str, Any]
    consultation_fee: Optional[float] = None
    consultation_item_name: Optional[str] = None
    consultation_mode: Optional[str] = None
    package_amount: Optional[float] = None
    package_weeks: Optional[int] = None
    package_id: Optional[str] = None
    package_name: Optional[str] = None
    package_price: Optional[float] = None
    package_paid: Optional[float] = None  # the Consultation Fee payment — Cash/UPI/Card only
    package_payment_mode: Optional[str] = None  # "cash" | "upi" | "card"
    treatment_fee_paid: Optional[float] = None  # the Treatment Fee payment — any payment method
    treatment_fee_payment_mode: Optional[str] = None  # "cash" | "upi" | "card" | "cheque" | "partial"
    treatment_fee_payment_details: Optional[dict] = None  # mode-specific fields (card last 4, cheque no., Partial schedule)
    package_sessions: Optional[int] = None
    package_duration_minutes: Optional[int] = None  # consultation-type packages only — no session count
    package_mode: Optional[str] = None
    # The Session package (FITSIO STORE > Sessions) chosen separately at the Treatment
    # Fee stage — distinct from package_* above, which is the Consultation package Head
    # Physio chooses inline during Consultation Visit.
    session_package_id: Optional[str] = None
    session_package_name: Optional[str] = None
    session_package_price: Optional[float] = None
    session_package_sessions: Optional[int] = None
    session_package_mode: Optional[str] = None
    consultation_decision: Optional[str] = None  # "consultation_only" | "consultation_treatment" — set by Head Physio at Save & Move
    diagnosis: Optional[str] = None  # Pre-Sales' basic diagnosis — read-only reference for the Head Physio
    physio_diagnosis_report: Optional[str] = None  # Head Physio's own diagnosis report
    physio_diagnosis_locked: Optional[bool] = False
    treatment_summary: Optional[str] = None  # Head Physio's treatment plan
    treatment_summary_locked: Optional[bool] = False
    consultation_payment_mode: Optional[str] = None  # "cash" | "upi" | "card" | ...
    assigned_physio_id: Optional[str] = None
    assigned_physio_name: Optional[str] = None
    physio_assigned_at: Optional[str] = None
    physio_stage: Optional[str] = None  # None = "Assigned" (active), "Complete" = physio's consultation review finished
    location: Optional[str] = None
    expected_consultation_date: Optional[str] = None
    months_of_pain: Optional[int] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    occupation: Optional[str] = None
    department: Optional[str] = None
    alternative_phone: Optional[str] = ""
    address: Optional[str] = ""
    city: Optional[str] = ""
    state: Optional[str] = ""
    condition: Optional[str] = ""
    assigned_user_id: Optional[str] = None
    assigned_user_name: Optional[str] = None
    rnr_attempts: Optional[int] = 0
    rnr_last_attempt_at: Optional[str] = None
    follow_ups: Optional[List[Dict[str, Any]]] = []
    next_follow_up_at: Optional[str] = None
    consultation_follow_ups: Optional[List[Dict[str, Any]]] = []
    next_consultation_follow_up_at: Optional[str] = None
    appointment_mode: Optional[str] = None  # "offline" | "online"
    appointment_department: Optional[str] = None  # "physio" | "fitness" — chosen when scheduling the appointment
    appointment_date: Optional[str] = None
    appointment_time: Optional[str] = None
    appointment_datetime: Optional[str] = None
    portfolio_date: Optional[str] = None
    portfolio_time: Optional[str] = None
    portfolio_datetime: Optional[str] = None
    created_at: str
    updated_at: str


class V3DiagnosisInput(BaseModel):
    diagnosis: str


class V3PhysioDiagnosisInput(BaseModel):
    report: str
    locked: bool = False


class V3TreatmentSummaryInput(BaseModel):
    summary: str
    locked: bool = False


class V3SellStoreItemInput(BaseModel):
    item_id: str
    mode: Literal["online", "offline"]
    paid_amount: Optional[float] = None
    payment_mode: str = "cash"
    notes: Optional[str] = ""


class V3CollectPackagePaymentInput(BaseModel):
    # The fee amount is never client-supplied — it's always the already-assigned
    # package_price, read straight off the lead. Branch Admin can only pick the mode.
    payment_mode: str = "cash"


class V3PartialInstallment(BaseModel):
    amount: float
    due_date: str


class V3CollectTreatmentFeeInput(BaseModel):
    # The Session/Treatment package and its price are locked in by the Head Physio's
    # earlier consultation-decision — Branch Admin can't choose or change either one
    # here, so neither item_id/mode/sessions_override nor paid_amount are accepted.
    payment_mode: str
    # Card — only the last 4 digits are ever persisted; the full number is never stored.
    card_number: Optional[str] = None
    card_holder_name: Optional[str] = None
    # Cheque
    bank_name: Optional[str] = None
    cheque_number: Optional[str] = None
    # Partial Payment — an arbitrary-length installment schedule (some clients want 2
    # payments, others want 5 or 6); every installment needs its own amount and due
    # date, and they must sum to the locked-in session_package_price.
    partial_installments: Optional[List[V3PartialInstallment]] = None


class V3ConsultationDecisionInput(BaseModel):
    decision: Literal["consultation_only", "consultation_treatment"]
    # Required only when decision == "consultation_treatment" — the Treatment/Session
    # package (FITSIO STORE > Sessions) the Head Physio is choosing on the patient's behalf.
    item_id: Optional[str] = None
    mode: Literal["online", "offline"] = "offline"
    sessions_override: Optional[int] = None


class V3AssignBranchInput(BaseModel):
    branch_id: str


class V3BookAppointmentInput(BaseModel):
    doctor_id: str
    slot_time: str


class V3AppointmentOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    lead_id: str
    lead_name: str
    branch_id: str
    doctor_id: str
    doctor_name: str
    slot_time: str
    status: str
    created_by_role: str
    created_at: str


class V3TeamMemberCreate(BaseModel):
    full_name: str
    email: str
    team_type: Literal["pre_sales", "sales"]


class V3TeamMemberOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    full_name: str
    email: str
    team_type: str
    created_at: str


class V3SheetConnectionCreate(BaseModel):
    connection_name: str
    spreadsheet_id: str
    sync_interval_minutes: int = 30


class V3SheetMappingInput(BaseModel):
    field_map: Dict[str, str]
    create_new_fields: bool = True


class V3SheetTabRows(BaseModel):
    tab_name: str
    rows: List[Dict[str, str]]


class V3SheetSyncInput(BaseModel):
    tabs: List[V3SheetTabRows]


class V3RemarkCreate(BaseModel):
    text: str


class V3FollowUpCreate(BaseModel):
    note: str
    scheduled_date: str


class V3MoveStageInput(BaseModel):
    stage: str


class V3BranchStageInput(BaseModel):
    branch_stage: str


class V3PortfolioScheduleInput(BaseModel):
    portfolio_date: str  # YYYY-MM-DD
    portfolio_time: str  # HH:MM (24h)


class V3ConsultationStageInput(BaseModel):
    consultation_stage: str


class V3HeadConsultationStageInput(BaseModel):
    head_consultation_stage: str


class V3CollectFeeInput(BaseModel):
    fee_type: Literal["consultation", "package"]
    amount: float
    package_weeks: Optional[int] = None


class V3AssignPhysioInput(BaseModel):
    physio_id: str


class V3SlotDetail(BaseModel):
    slot_time: str
    duration: int = 30
    consultation_type: str = "initial"


class V3CalendarSlotsInput(BaseModel):
    slots: List[V3SlotDetail]


class V3RemoveSlotsInput(BaseModel):
    slot_times: List[str]



class V3PackageRecommendInput(BaseModel):
    lead_id: str
    recommended_weeks: int
    sessions_per_week: int
    notes: Optional[str] = ""


class V3AssignSessionsInput(BaseModel):
    lead_id: str
    physio_id: str
    slot_times: List[str]


class V3CompleteSessionInput(BaseModel):
    remarks: str


class V3JrPhysioWeeklyInput(BaseModel):
    jr_physio_notes: str


class V3HeadPhysioReviewInput(BaseModel):
    head_physio_notes: str
    head_physio_suggestions: str


class V3CreateJrPhysioInput(BaseModel):
    full_name: str
    email: str
    password: str
    specialization: Optional[str] = ""
