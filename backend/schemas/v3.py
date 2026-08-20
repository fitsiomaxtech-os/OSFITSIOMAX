from pydantic import BaseModel, ConfigDict, field_validator
from typing import List, Optional, Dict, Literal, Any


class V3UserOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    full_name: str
    email: str
    # Not a Literal — custom roles can be added at runtime via POST /hr/roles
    # (see v3_hr.py), so any string already stored on a user document must
    # deserialize here instead of 500ing every endpoint that returns it.
    role: str
    branch_id: Optional[str] = None
    # A Head Physio can be assigned to more than one branch (branch_id stays the
    # "primary"/first branch for every existing single-branch filter elsewhere);
    # this is the additional set consulted for branch-switching on their own board.
    branch_ids: Optional[List[str]] = None
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


class V3TreatmentTypeCreate(BaseModel):
    name: str


class V3TreatmentTypeOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    created_at: str


# Type of Physios — the kinds of physiotherapy service the clinic offers, kept the same
# shape as a treatment type for the same reason: a name is the whole record, because the
# price and the session count belong to a package in FITSIO STORE.
class V3PhysioTypeCreate(BaseModel):
    name: str


class V3PhysioTypeUpdate(BaseModel):
    name: str


class V3DoctorServiceInput(BaseModel):
    """The service an expert is offered under, by name.

    The name and not the id: a doctors record already carries denormalised text for
    everything a calendar prints, and a picklist entry that is renamed is renamed
    through to the experts holding it, which the rename endpoint does.

    Empty clears it — an expert offered under no particular service is the state every
    one of them starts in.
    """
    service_type: str = ""


class V3PhysioTypeOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    created_at: str


class V3BranchCreate(BaseModel):
    branch_name: str
    address: str
    admin_name: str
    admin_email: str
    admin_password: str
    admin_phone: Optional[str] = ""
    vertical: str = "offline_physiotherapy"
    code: Optional[str] = None  # short unique prefix for Patient Numbers, e.g. "ANN" — auto-derived if omitted
    lead_control: Optional[str] = None  # "pre_sales" | "branch_admin" — see backend/lead_control.py


class V3BranchOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    code: Optional[str] = None
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
    holidays: Optional[List[str]] = None
    # Absent on every branch made before Lead Control existed; the readers default it
    # to "pre_sales" rather than this schema, so an old branch keeps the old behaviour.
    lead_control: Optional[str] = None
    created_at: str


class V3BranchUpdate(BaseModel):
    code: Optional[str] = None
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
    holidays: Optional[List[str]] = None
    lead_control: Optional[str] = None  # "pre_sales" | "branch_admin"
    # Who picks the branch's leads up when lead_control returns to "pre_sales". Not stored
    # on the branch — it names the Pre-Sales rep the leads are handed to, and is recorded
    # against that switch. Ignored when switching the other way, since a branch working its
    # own leads has no Pre-Sales rep on them at all.
    lead_control_assignee_id: Optional[str] = None


class V3DoctorCreate(BaseModel):
    full_name: str
    profile_type: Literal["head_physio", "physio", "doctor", "nutrition_coach"]
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
    # Patients this physio takes in one slot — a treatment floor runs two or three at
    # once. None means the default; a Head Physio is pinned to 1 whatever is stored.
    # See slot_capacity_of() in utils.py.
    slot_capacity: Optional[int] = None
    # The working window this expert is rostered on (MANAGEMENT → TIME MANAGEMENT). The
    # name and both ends are resolved from the shift on read, not stored here, so editing
    # a shift's hours moves everyone on it — see shift_utils.attach_shifts.
    shift_id: Optional[str] = None
    shift_name: Optional[str] = ""
    shift_start: Optional[str] = None
    shift_end: Optional[str] = None
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
    patient_number: Optional[str] = None  # e.g. "ANN-260727-0000" — BRANCHCODE-YYMMDD-SEQUENCE, set once branch_id is known
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
    # Not stored on the lead — GET /leads resolves it from the lead's branch on the way
    # out, so flipping a branch's switch rehomes the leads already in flight. See
    # backend/lead_control.py.
    lead_control: Optional[str] = None
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
    package_payment_details: Optional[dict] = None  # mode-specific fields (UPI txn/UTR, card/account last 4)
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
    # The Rehab course (FITSIO STORE > Rehab) chosen alongside the Rehab referral, kept
    # apart from session_package_* because a patient can be sent away with treatment and
    # rehab both, and one set of fields could only hold one of them. This model ignores
    # extras, so without these the board could never show back what was chosen.
    rehab_package_id: Optional[str] = None
    rehab_package_name: Optional[str] = None
    rehab_package_price: Optional[float] = None
    rehab_package_sessions: Optional[int] = None
    rehab_package_mode: Optional[str] = None
    # The Zumba membership, kept apart from the other two for the same reason they are
    # kept apart from each other: a patient can leave with any combination of them.
    zumba_package_id: Optional[str] = None
    zumba_package_name: Optional[str] = None
    zumba_package_price: Optional[float] = None
    zumba_package_sessions: Optional[int] = None
    zumba_package_mode: Optional[str] = None
    # What was actually taken for the Rehab course, kept apart from the package fields
    # above the way every other fee is: the price is what it costs, this is what is in.
    rehab_fee_paid: Optional[float] = None
    rehab_fee_payment_mode: Optional[str] = None
    rehab_fee_payment_details: Optional[dict] = None
    consultation_decision: Optional[str] = None  # "consultation_only" | "consultation_treatment" — set by Head Physio at Save & Move
    # Whether the Head Physio also referred this patient to a Nutrition Coach. Orthogonal
    # to consultation_decision — see V3ConsultationDecisionInput.
    diet_recommended: Optional[bool] = False
    rehab_referred: Optional[bool] = False
    fitness_recommended: Optional[bool] = False
    zumba_recommended: Optional[bool] = False
    # Who is actually delivering that diet plan, set by branch/assign-diet. This model
    # ignores extras, so without these three the Consultations board could never tell an
    # already-assigned patient from a new one and its Reassign control would never appear.
    diet_coach_id: Optional[str] = None
    diet_coach_name: Optional[str] = None
    diet_assigned_at: Optional[str] = None
    # The booked Diet Consultation slot, "YYYY-MM-DDTHH:MM". Distinct from
    # appointment_date/_time above, which are the Head Physio's consultation.
    diet_appointment_at: Optional[str] = None
    diet_stage: Optional[str] = None  # "Diet Consultation Booked" | "Diet Plan Assigned" | "Diet Completed"
    # The Diet Consultation Fee and the FITSIO STORE Diet Package it was collected for.
    # Kept apart from package_* (the Consultation Fee) and session_package_* (the
    # Treatment Fee) so all three read back independently on the Fee Collected panel.
    diet_package_id: Optional[str] = None
    diet_package_name: Optional[str] = None
    diet_package_price: Optional[float] = None
    diet_package_mode: Optional[str] = None  # "online" | "offline"
    diet_fee_paid: Optional[float] = None
    diet_fee_payment_mode: Optional[str] = None
    diet_fee_payment_details: Optional[dict] = None
    # What the Nutrition Coach concluded at the Diet Consultation — the diet counterpart
    # of physio_diagnosis_report. One current plan, replaced rather than appended to.
    diet_consultation_report: Optional[str] = None
    diet_consultation_report_at: Optional[str] = None
    diet_consultation_report_by: Optional[str] = None
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
    payment_mode: str = "cash"
    # Manual entry — defaults to the assigned package_price if omitted, but Branch
    # Admin can override it (discount, rounding, partial cash collected, etc).
    amount: Optional[float] = None
    # Branch Admin must explicitly tick a confirmation before this is accepted —
    # a deliberate double-check step, not just clicking Collect once.
    confirmed: bool = False
    # UPI
    upi_transaction_id: Optional[str] = None
    upi_utr: Optional[str] = None
    # Card — only the last 4 digits of the account number are ever persisted; the
    # full number is never stored.
    account_number: Optional[str] = None
    account_holder_name: Optional[str] = None
    bank_name: Optional[str] = None
    ifsc_code: Optional[str] = None
    # Account Transfer — reuses the four bank fields above (same last-4 rule) and adds
    # the bank's own reference for the transfer, which is what a dispute is traced by.
    transfer_reference: Optional[str] = None


class V3CollectDietFeeInput(V3CollectPackagePaymentInput):
    """The Diet Consultation Fee.

    Inherits every payment field from the Consultation Fee — it is collected the same way,
    in one go, by the same four modes — and adds only what is particular to diet: which
    Diet Package from FITSIO STORE, and whether it was sold at the online or offline price.
    The Head Physio never picks a diet package the way they pick a treatment one, so it is
    chosen here at the point of collection.
    """
    item_id: str
    mode: Literal["online", "offline"] = "offline"


class V3PartialInstallment(BaseModel):
    amount: float
    due_date: str


class V3CollectRehabFeeInput(V3CollectPackagePaymentInput):
    """The Rehab course fee.

    Inherits every payment field from the Consultation Fee, exactly as the Diet fee does —
    it is collected the same way, in one go, by the same four modes — and adds nothing.
    The course itself is locked in by the Consultant's decision the way the Treatment
    package is, so there is nothing to choose here: Branch Admin collects against what is
    already on the lead.

    Inherited rather than restated so build_payment_details can reach every field it
    validates; a hand-written copy that missed ifsc_code would have thrown on the first
    card payment.
    """


class V3CollectTreatmentFeeInput(BaseModel):
    # The Session/Treatment package itself is locked in by the Head Physio's earlier
    # consultation-decision — Branch Admin can't choose or change item_id/mode/
    # sessions_override here. The amount defaults to the locked session_package_price
    # but can be manually overridden for Cash/UPI/Card (discount, rounding, etc);
    # Cheque and Partial Payment keep using the locked amount as before.
    payment_mode: str
    amount: Optional[float] = None
    # Branch Admin must explicitly tick a confirmation before Cash/UPI/Card is
    # accepted — a deliberate double-check step, not just clicking Collect once.
    confirmed: bool = False
    # UPI
    upi_transaction_id: Optional[str] = None
    upi_utr: Optional[str] = None
    # Card — only the last 4 digits of the account number are ever persisted; the
    # full number is never stored.
    account_number: Optional[str] = None
    account_holder_name: Optional[str] = None
    # Cheque (bank_name is shared with Card)
    bank_name: Optional[str] = None
    cheque_number: Optional[str] = None
    ifsc_code: Optional[str] = None
    # Account Transfer — reuses the four bank fields above (same last-4 rule) and adds
    # the bank's own reference for the transfer, which is what a dispute is traced by.
    transfer_reference: Optional[str] = None
    # Partial Payment — an arbitrary-length installment schedule (some clients want 2
    # payments, others want 5 or 6); every installment needs its own amount and due
    # date, and they must sum to the locked-in session_package_price.
    partial_installments: Optional[List[V3PartialInstallment]] = None
    # Cash/UPI/Card/Cheque can ALSO collect for only some of the package's sessions
    # right now (e.g. 5 of 10) rather than the full package — sessions_now defaults
    # to every session when omitted (today's full-collection behavior, unchanged).
    # balance_due_date is required whenever sessions_now is less than the package's
    # total; the remaining sessions are scheduled as a single balance installment.
    sessions_now: Optional[int] = None
    balance_due_date: Optional[str] = None


class V3MarkInstallmentPaidInput(BaseModel):
    # Optional for backward compatibility: a caller that sends no body (or omits
    # payment_mode) gets the old behavior — just flip `paid` to true, no payment
    # metadata, no activity log entry. Sending payment_mode is how the Partial
    # Payment schedule's own per-row Collect button records a real payment (mode,
    # UTR/cheque number, and an activity-log entry so it surfaces in Session
    # Collections / Accountant Manage), same as every other Treatment Fee mode.
    payment_mode: Optional[Literal["cash", "upi", "card", "cheque", "account_transfer"]] = None
    amount: Optional[float] = None
    upi_transaction_id: Optional[str] = None
    upi_utr: Optional[str] = None
    account_number: Optional[str] = None
    account_holder_name: Optional[str] = None
    bank_name: Optional[str] = None
    ifsc_code: Optional[str] = None
    cheque_number: Optional[str] = None
    transfer_reference: Optional[str] = None


class V3PortalAccountInput(BaseModel):
    # Both optional — email defaults to the lead's own email if it has one; password
    # defaults to a freshly generated one when omitted ("Generate"), or the Branch
    # Admin can supply their own ("Create").
    email: Optional[str] = None
    password: Optional[str] = None


class V3PatientPortalLogin(BaseModel):
    email: str
    password: str


class V3PatientPortalGoogleLogin(BaseModel):
    # The ID token JWT handed back by Google Identity Services' client-side button —
    # verified server-side against GOOGLE_CLIENT_ID before it's trusted for anything.
    credential: str


class V3TestimonialInput(BaseModel):
    youtube_url: str
    title: Optional[str] = None


class V3ConsultationDecisionInput(BaseModel):
    decision: Literal["consultation_only", "consultation_treatment"]
    # Diet is orthogonal to treatment, not another value of it: a patient can be sent to a
    # Nutrition Coach with or without physio. Kept as its own flag so the choices the
    # Head Physio actually picks from stay independent yes/nos underneath — folding them
    # into one enum would multiply the values, and every existing `== "consultation_
    # treatment"` check in the codebase would silently stop matching half the cases it
    # used to.
    diet_recommended: bool = False
    # Sends the patient straight to the Head Physio's Rehab queue instead of picking a
    # Treatment Package here. Its own flag for the same reason diet is: it is a routing
    # choice, not another value of `decision`, and folding it in would break every
    # existing `== "consultation_only"` check.
    rehab_referred: bool = False
    # Same idea as rehab_referred, its own routing flag rather than a value of `decision`.
    fitness_recommended: bool = False
    # And again for Zumba, which the branch sells alongside the clinical verticals.
    zumba_recommended: bool = False
    # Required only when decision == "consultation_treatment" — the Treatment/Session
    # package (FITSIO STORE > Sessions) the Head Physio is choosing on the patient's behalf.
    item_id: Optional[str] = None
    mode: Literal["online", "offline"] = "offline"
    sessions_override: Optional[int] = None
    # The Rehab course, when one is picked alongside rehab_referred. Optional on purpose:
    # referring to Rehab without settling the course is the flow that existed before this
    # field, and the receipt still says "Waiting on a package in Rehab" for it.
    rehab_item_id: Optional[str] = None
    # The Zumba membership, when one is picked alongside it. Optional on the same terms.
    zumba_item_id: Optional[str] = None


class V3AssignPhysioSessionsInput(BaseModel):
    physio_id: str
    # Exactly `session_package_sessions` slot_time strings, picked from the physio's own
    # already-configured calendar (Consultations > Physio Calendar) — booking all of the
    # patient's paid sessions in the same step the physio is assigned.
    slot_times: List[str]


class V3AssignBranchInput(BaseModel):
    branch_id: str


class V3BookAppointmentInput(BaseModel):
    doctor_id: str
    slot_time: str


class V3AppointmentOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    # A consultation booked straight from the Calendar tab can be a walk-in with no lead
    # behind it, and older rows predate created_by_role — neither is worth 500ing the
    # whole appointments list over, so both are optional here.
    lead_id: Optional[str] = None
    lead_name: str
    branch_id: str
    doctor_id: str
    doctor_name: str
    slot_time: str
    status: str
    created_by_role: Optional[str] = None
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
    # A treatment day is written up as treatment notes, rehab notes, or both. Neither is
    # required on its own -- the endpoint rejects only the pair being empty, so a physio
    # with nothing to say about one of them is not made to type into it.
    remarks: Optional[str] = ""
    rehab_remarks: Optional[str] = ""


class V3AbsentSessionInput(BaseModel):
    # Optional: a physio marking a no-show in the moment should not be held up for a
    # sentence about it, and the date and who marked it are recorded either way.
    remarks: Optional[str] = ""


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
