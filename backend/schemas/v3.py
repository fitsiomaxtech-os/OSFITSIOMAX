from pydantic import BaseModel, ConfigDict
from typing import List, Optional, Dict, Literal, Any


class V3UserOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    full_name: str
    email: str
    role: Literal["super_admin", "business_dev", "pre_sales", "branch_admin", "head_physio", "physio"]
    branch_id: Optional[str] = None
    created_at: str


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
    profile_type: Literal["head_physio", "physio"]
    branch_id: Optional[str] = None
    specialization: Optional[str] = ""


class V3DoctorSlotsInput(BaseModel):
    slots: List[str]


class V3DoctorOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    full_name: str
    profile_type: str
    branch_id: str
    specialization: Optional[str] = ""
    slots: List[str]
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
    branch_id: Optional[str] = None
    notes: Optional[str] = ""
    extra_fields: Dict[str, Any]
    consultation_fee: Optional[float] = None
    package_amount: Optional[float] = None
    package_weeks: Optional[int] = None
    assigned_physio_id: Optional[str] = None
    assigned_physio_name: Optional[str] = None
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
    appointment_mode: Optional[str] = None  # "offline" | "online"
    appointment_date: Optional[str] = None
    appointment_time: Optional[str] = None
    appointment_datetime: Optional[str] = None
    created_at: str
    updated_at: str


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


class V3CollectFeeInput(BaseModel):
    fee_type: Literal["consultation", "package"]
    amount: float
    package_weeks: Optional[int] = None


class V3AssignPhysioInput(BaseModel):
    physio_id: str


class V3CreateHeadPhysioInput(BaseModel):
    full_name: str
    email: str
    password: str
    specialization: Optional[str] = ""


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
