"""Packages module — Super Admin creates packages; Branch Admin sells them."""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import v3_col
from deps import v3_require_roles
from schemas.v3 import (
    V3UserOut, V3LeadOut, V3DiagnosisInput, V3SellStoreItemInput,
    V3CollectPackagePaymentInput, V3CollectTreatmentFeeInput, V3CollectDietFeeInput,
    V3CollectDietChartFeeInput,
    V3CollectRehabFeeInput,
    V3PhysioDiagnosisInput, V3TreatmentSummaryInput,
)
from utils import generate_transaction_id

router = APIRouter(prefix="/api/v3", tags=["packages"])


def _now():
    return datetime.now(timezone.utc).isoformat()


class PackageIn(BaseModel):
    name: str
    weeks: int = Field(ge=1, le=104)
    sessions_per_week: int = Field(ge=1, le=14, default=2)
    price: float = Field(ge=0)
    description: Optional[str] = ""
    services: List[str] = []
    active: bool = True


class PackageOut(PackageIn):
    id: str
    total_sessions: int
    created_at: str
    updated_at: str


@router.get("/packages", response_model=List[PackageOut])
async def list_packages(active_only: bool = False, _: V3UserOut = Depends(v3_require_roles("super_admin", "branch_admin", "head_physio", "pre_sales"))):
    q = {"active": True} if active_only else {}
    docs = await v3_col("packages").find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


@router.post("/packages", response_model=PackageOut)
async def create_package(payload: PackageIn, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    doc = payload.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["total_sessions"] = payload.weeks * payload.sessions_per_week
    doc["created_at"] = _now()
    doc["updated_at"] = _now()
    await v3_col("packages").insert_one(doc)
    return doc


@router.put("/packages/{package_id}", response_model=PackageOut)
async def update_package(package_id: str, payload: PackageIn, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    update = payload.model_dump()
    update["total_sessions"] = payload.weeks * payload.sessions_per_week
    update["updated_at"] = _now()
    res = await v3_col("packages").update_one({"id": package_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Package not found")
    doc = await v3_col("packages").find_one({"id": package_id}, {"_id": 0})
    return doc


@router.delete("/packages/{package_id}")
async def delete_package(package_id: str, _: V3UserOut = Depends(v3_require_roles("super_admin"))):
    res = await v3_col("packages").delete_one({"id": package_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Package not found")
    return {"message": "Package deleted"}


class SellPackageInput(BaseModel):
    package_id: str
    paid_amount: Optional[float] = None
    notes: Optional[str] = ""


@router.post("/leads/{lead_id}/sell-package", response_model=dict)
async def sell_package(lead_id: str, payload: SellPackageInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin", "head_physio"))):
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    pkg = await v3_col("packages").find_one({"id": payload.package_id}, {"_id": 0})
    if not pkg:
        raise HTTPException(status_code=404, detail="Package not found")
    paid = payload.paid_amount if payload.paid_amount is not None else pkg.get("price", 0)
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "package_id": pkg["id"],
        "package_name": pkg["name"],
        "package_weeks": pkg["weeks"],
        "package_price": pkg["price"],
        "package_paid": paid,
        "consultation_stage": "Treatment Fee",
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "package_sold",
        "details": f"Sold package: {pkg['name']} · {pkg['weeks']}w · ₹{paid}" + (f" · {payload.notes}" if payload.notes else ""),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    return {"message": "Package sold", "lead_id": lead_id, "package": pkg, "paid": paid}


@router.post("/leads/{lead_id}/diagnosis", response_model=V3LeadOut)
async def save_diagnosis(lead_id: str, payload: V3DiagnosisInput, user: V3UserOut = Depends(v3_require_roles("head_physio", "branch_admin", "super_admin"))):
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {"diagnosis": payload.diagnosis, "updated_at": _now()}})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "diagnosis_recorded",
        "details": f"Diagnosis recorded by {user.full_name}: {payload.diagnosis}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


@router.post("/leads/{lead_id}/sell-store-item", response_model=dict)
async def sell_store_item(lead_id: str, payload: V3SellStoreItemInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Branch admin sells + collects payment for a consultation item, in one step."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    item = await v3_col("store_items").find_one({"id": payload.item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Store item not found")
    if item.get("item_type", "consultation") == "session":
        raise HTTPException(status_code=400, detail="Session packages are assigned by the consultant, then collected separately — use assign-package / collect-package-payment")

    price = item.get("price_online") if payload.mode == "online" else item.get("price_offline")
    paid = payload.paid_amount if payload.paid_amount is not None else price

    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "consultation_fee": paid,
        "consultation_item_name": item["name"],
        "consultation_mode": payload.mode,
        "consultation_payment_mode": payload.payment_mode,
        "consultation_stage": "Consultation Visit",
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "consultation_paid",
        "details": f"Consultation '{item['name']}' ({payload.mode}) paid: Rs.{paid} via {payload.payment_mode}" + (f" · {payload.notes}" if payload.notes else ""),
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Sold", "lead_id": lead_id, "item": item, "mode": payload.mode, "paid": paid, "lead": V3LeadOut(**updated).model_dump()}


CONSULTATION_FEE_PAYMENT_MODES = {"cash", "upi", "card", "account_transfer"}
TREATMENT_FEE_PAYMENT_MODES = {"cash", "upi", "card", "cheque", "partial", "account_transfer"}

# The modes where money lands in full, there and then: the amount is editable, a
# discount is tracked against it, and an explicit confirmation is required
# before it's accepted. Cheque and Partial Payment are promises of money rather than
# money, so they're deliberately outside this set.
SETTLED_NOW_MODES = ("cash", "upi", "card", "account_transfer")
# The above plus Cheque — every mode that can cover only part of a session package now
# and leave the rest as a scheduled balance. Partial Payment can't: it *is* the schedule.
PART_SESSION_MODES = ("cash", "upi", "card", "cheque", "account_transfer")

# The notes a branch desk takes, and the only ones a cash count may be entered in. Kept in
# step with DENOMINATIONS in frontend/src/components/ConsultationsBoard.jsx.
#
# Anything not listed here is dropped rather than guessed at, so a count in a note this
# desk does not hold cannot quietly become part of a total. A payment recorded before this
# keeps whatever it was counted in — the list governs what may be entered, not what has
# already happened.
DENOMINATIONS = (500, 200, 100, 50, 20, 10)


def settle_fee_money(
    *,
    list_price,
    amount,
    discount_in,
    balance_due_date,
    total_price=None,
    allow_discount=True,
    over_label="above listed fee",
    existing_installments=None,
):
    """The three facts one collection has to keep apart: the discount that was agreed,
    the money that came in, and whatever is still owed.

    Every fee in this file used to work the gap between the price and the amount out as a
    discount. That reads a part payment as a write-off: a desk taking Rs.750 of a Rs.1000
    fee cancelled the Rs.250 the patient was coming back with, and nothing was left on the
    record to collect. A discount is only ever `discount_in` — a figure somebody typed —
    and whatever the amount falls short of the price is a balance, returned here as an
    unpaid installment for the caller to store on the fee's own payment_details. That is
    the same shape a Partial Payment schedule uses, so Payment Schedules, Outstanding
    Amount and the client's own panel read it for free, and it can be collected later
    under any payment mode.

    Shared by all five collect endpoints rather than restated in each, because restating
    it in each is how the same mistake came to be in all five.

    `list_price` is what the discount comes off. `total_price` is the whole bill the
    balance is measured against, and defaults to `list_price` — they differ only for the
    Treatment Fee, where a collection can cover some of a package's sessions: the discount
    is measured against those sessions, the balance against the package.

    `allow_discount` is False for the modes that cannot negotiate one (Cheque and Partial
    Payment keep their locked price), which also stops a discount arriving on a payload
    that has no box to type it in.
    """
    discount = round(discount_in or 0, 2) if allow_discount else 0
    if discount < 0:
        raise HTTPException(status_code=400, detail="Discount cannot be negative")
    if discount > list_price:
        raise HTTPException(status_code=400, detail=f"Discount cannot be more than the Rs.{list_price:g} being collected for")
    net_payable = round(list_price - discount, 2)

    reason = None
    suffix = ""
    if discount > 0:
        reason = "Discount"
        suffix = f" · Actual Price Rs.{list_price}, Discount Rs.{discount}"
    elif allow_discount and amount > net_payable + 0.01:
        # Over the fee is recorded rather than refused — it is usually a rounding-up the
        # patient insisted on — and keeps the negative-discount convention the reports
        # already read, so nothing downstream has to learn a new sign.
        discount = -round(amount - net_payable, 2)
        reason = "Additional amount collected"
        suffix = f" · Actual Price Rs.{net_payable}, Rs.{abs(discount)} {over_label}"

    bill = list_price if total_price is None else total_price
    balance = round(bill - discount - amount, 2)
    installments = None
    carry = None
    balance_suffix = ""
    if balance > 0.009:
        if not balance_due_date:
            raise HTTPException(status_code=400, detail="A due date is required for the balance amount")
        installments = [
            {"amount": amount, "due_date": _now()[:10], "paid": True},
            {"amount": balance, "due_date": balance_due_date, "paid": False},
        ]
        balance_suffix = f" · balance Rs.{balance} due {balance_due_date}"
    elif existing_installments and all(i.get("paid") for i in existing_installments):
        # Nothing new is owed, but this fee has been collected in pieces before and every
        # piece is in. Those rows are the record of how the money actually arrived, and a
        # correction to the mode or the amount is no reason to erase it — dropping them
        # would take the earlier payments out of every schedule and outstanding figure
        # that reads them. Carried only when they are all settled: an unpaid row left over
        # from a balance this collection has now cleared would be a debt nobody owes.
        carry = existing_installments

    return {
        "discount": discount,
        "reason": reason,
        "suffix": suffix,
        "net_payable": net_payable,
        "balance": balance,
        "installments": installments,
        "carry": carry,
        "balance_suffix": balance_suffix,
    }


def _denomination_total(raw) -> tuple:
    """What a counted pile of notes comes to, and the tidied count behind it.

    Anything that is not a note this desk holds, or not a positive whole number of them, is
    dropped: a "3.5 x 500" is a typo, and reading it as 1750 would put a figure in the
    drawer nobody counted.

    Returns (0.0, {}) for a payment that was never counted, which is the same answer as one
    counted to nothing — the caller tells them apart by the empty dict, and only ever
    stores a count that has something in it.
    """
    if not isinstance(raw, dict):
        return 0.0, {}
    clean: dict = {}
    total = 0.0
    for note in DENOMINATIONS:
        for key in (str(note), note):
            if key in raw:
                try:
                    count = int(raw[key])
                except (TypeError, ValueError):
                    count = 0
                if count > 0:
                    clean[str(note)] = count
                    total += note * count
                break
    return round(total, 2), clean


def _settle_cash_count(raw, amount: float, where: str = "") -> dict:
    """The count to store against a cash payment of `amount`, or {} if none was taken.

    Counting is optional — a busy desk records the figure alone, as it always could. But a
    count that was taken has to agree with the money: notes short of the amount, or over
    it, mean one of the two numbers is wrong, and banking either would bank a figure nobody
    checked. So this refuses rather than choosing between them.
    """
    counted, clean = _denomination_total(raw)
    if not clean:
        return {}
    if abs(counted - float(amount)) > 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"The notes counted{where} come to Rs.{counted:g}, but the cash being collected is Rs.{float(amount):g}",
        )
    return clean


def _notes_label(clean: dict) -> str:
    """A stored count written out for an activity line: "2xRs.500 + 1xRs.200"."""
    return " + ".join(f"{clean[str(d)]}xRs.{d}" for d in DENOMINATIONS if clean.get(str(d)))


def build_payment_details(payload) -> tuple:
    """(details, human suffix) for whichever mode this payment used.

    The same validation the Consultation Fee and Treatment Fee already do inline. Written
    once here for the Diet Consultation Fee rather than copied a third time; the two older
    endpoints still carry their own copies and can adopt this when they are next touched —
    changing a working money path is not something to do as a side effect.

    Cash needs nothing, so it falls through to an empty dict. Card and Account Transfer
    persist only the last four digits of the account number; the full number is never
    stored, and that rule lives here so no future caller can forget it.
    """
    mode = payload.payment_mode
    if mode == "upi":
        # Transaction id alone: none of the Collect popups ask for a UTR any more, and a
        # field the form cannot supply would reject every UPI collection. A caller that
        # still sends one has it recorded.
        if not (payload.upi_transaction_id or "").strip():
            raise HTTPException(status_code=400, detail="UPI Transaction ID is required")
        txn = payload.upi_transaction_id.strip()
        utr = (payload.upi_utr or "").strip()
        if utr:
            return {"upi_transaction_id": txn, "upi_utr": utr}, f" · UPI txn {txn}, UTR {utr}"
        return {"upi_transaction_id": txn}, f" · UPI txn {txn}"

    if mode in ("card", "account_transfer"):
        required = [payload.account_number, payload.account_holder_name, payload.bank_name, payload.ifsc_code]
        if not all((f or "").strip() for f in required):
            raise HTTPException(status_code=400, detail="Account Number, Account Holder Name, Bank Name and IFSC Code are required")
        if mode == "account_transfer" and not (payload.transfer_reference or "").strip():
            raise HTTPException(status_code=400, detail="Reference/UTR No. is required for an Account Transfer")
        last4 = "".join(ch for ch in payload.account_number if ch.isdigit())[-4:]
        holder = payload.account_holder_name.strip()
        bank = payload.bank_name.strip()
        ifsc = payload.ifsc_code.strip().upper()
        details = {"account_last4": last4, "account_holder_name": holder, "bank_name": bank, "ifsc_code": ifsc}
        suffix = f" · A/C ****{last4}, {holder}, {bank} ({ifsc})"
        if mode == "account_transfer":
            details["transfer_reference"] = payload.transfer_reference.strip()
            suffix += f" · Ref {details['transfer_reference']}"
        return details, suffix

    return {}, ""


# Which shelves a diet fee may be collected against.
#
# Both, not one. The catalogue has two places a diet product can sit — "diet", the timed
# bookable item under Consultations, and "diet_package", the flat-priced one under the Diet
# Package tab — and branches have priced their Diet Consultation and Diet Chart on either.
# Pinning collection to a single item_type meant the Collect Diet Fee button telling a
# branch to go and add a package they had already added, on the other shelf.
#
# What the money is for is decided by which ENDPOINT takes it, not by which shelf the item
# came off: collect_diet_fee writes the Diet Consultation Fee fields and
# collect_diet_chart_fee the Diet Chart ones, whatever the item's type. The shelf is where
# the branch keeps a price; it was never the thing that said which product was sold.
DIET_ITEM_TYPES = ("diet", "diet_package")

DIET_FEE_PAYMENT_MODES = {"cash", "upi", "card", "account_transfer"}
# The same four. A rehab course is taken in one payment like a diet consultation, so
# it has no use for Cheque's clearing dance or Partial Payment's schedule.
REHAB_FEE_PAYMENT_MODES = DIET_FEE_PAYMENT_MODES


@router.post("/leads/{lead_id}/collect-diet-fee", response_model=dict)
async def collect_diet_fee(lead_id: str, payload: V3CollectDietFeeInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Branch admin collects the Diet Consultation Fee.

    Collected in one go like the Consultation Fee, not in installments like the Treatment
    Fee: a diet consultation is a single visit at a single price, so there is no schedule
    to spread and no per-session rate to divide by.

    The Diet Package is chosen HERE rather than upstream. The Head Physio picks a treatment
    package during their decision, but they never pick a diet one — diet is optional and
    often decided after the treatment is under way — so the item is named at the point the
    money is taken.

    Deliberately does not touch consultation_stage. Diet is a parallel vertical: taking
    this fee is not progress through the physio pipeline, and moving that stage as a side
    effect of a diet payment would misreport where the patient actually is.
    """
    if payload.payment_mode not in DIET_FEE_PAYMENT_MODES:
        raise HTTPException(status_code=400, detail=f"Diet Consultation Fee only accepts: {sorted(DIET_FEE_PAYMENT_MODES)}")
    if not payload.confirmed:
        raise HTTPException(status_code=400, detail="Please confirm the payment before submitting")

    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    # The Consultation Fee is the only prerequisite. Not the Treatment Fee: a patient can
    # come for a diet consultation and nothing else, and gating on treatment would shut
    # that door.
    if lead.get("package_paid") is None:
        raise HTTPException(status_code=400, detail="Collect the Consultation Fee first")

    item = await v3_col("store_items").find_one(
        {"id": payload.item_id, "item_type": {"$in": list(DIET_ITEM_TYPES)}}, {"_id": 0}
    )
    if not item:
        raise HTTPException(status_code=404, detail="Diet Package not found. Add one in FITSIO STORE > Diet Package.")

    original_price = item.get("price_online") if payload.mode == "online" else item.get("price_offline")
    if original_price is None:
        raise HTTPException(status_code=400, detail=f"This Diet Package has no {payload.mode} price set")
    net_payable = round(original_price - round(payload.discount_amount or 0, 2), 2)
    amount = payload.amount if payload.amount is not None else net_payable
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    # Same rule as the Consultation Fee, and every other fee: only a typed discount comes
    # off the listed price, and money short of what is then payable is a balance recorded
    # against this fee rather than quietly forgiven.
    settled = settle_fee_money(
        list_price=original_price,
        amount=amount,
        discount_in=payload.discount_amount,
        balance_due_date=payload.balance_due_date,
        existing_installments=(lead.get("diet_fee_payment_details") or {}).get("installments"),
    )
    discount_amount = settled["discount"]
    discount_reason = settled["reason"]
    discount_suffix = settled["suffix"]
    balance_suffix = settled["balance_suffix"]

    payment_details, detail_suffix = build_payment_details(payload)
    is_update = lead.get("diet_fee_paid") is not None
    transaction_id = await generate_transaction_id(lead.get("branch_id"))
    payment_details["transaction_id"] = transaction_id
    if discount_amount > 0:
        payment_details["discount_amount"] = discount_amount
    # The new balance if this collection left one, otherwise whatever schedule the fee
    # already had — see settle_fee_money: a correction must not erase how the money came in.
    if settled["installments"] or settled["carry"]:
        payment_details["installments"] = settled["installments"] or settled["carry"]

    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "diet_package_id": item["id"],
        "diet_package_name": item["name"],
        "diet_package_price": original_price,
        "diet_package_mode": payload.mode,
        "diet_fee_paid": amount,
        "diet_fee_payment_mode": payload.payment_mode,
        "diet_fee_payment_details": payment_details,
        # The fee IS the referral when nobody recommended one — same reasoning as
        # book_diet_appointment, so a paying patient reaches the coach's queue either way.
        "diet_recommended": True,
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "transaction_id": transaction_id,
        "lead_id": lead_id,
        "action": "diet_fee_collected",
        "details": f"{'Updated' if is_update else 'Collected'} Diet Consultation Fee Rs.{amount} for '{item['name']}' ({payload.mode}) via {payload.payment_mode}{detail_suffix}{discount_suffix}{balance_suffix} · Txn {transaction_id}",
        "original_amount": original_price,
        "collected_amount": amount,
        "discount_amount": discount_amount if discount_amount != 0 else None,
        "discount_reason": discount_reason,
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Payment collected", "transaction_id": transaction_id, "lead": V3LeadOut(**updated).model_dump()}


@router.post("/leads/{lead_id}/collect-diet-chart-fee", response_model=dict)
async def collect_diet_chart_fee(lead_id: str, payload: V3CollectDietChartFeeInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Branch admin collects the Diet Chart Fee.

    The second of the two things sold under the word "diet", and the one that gates what
    the patient can see. A Diet Consultation buys time with a Nutrition Coach; a Diet Chart
    buys the written plan itself, and the Client Portal will not show that plan until this
    fee is in — see v3_patient_portal._build_portal_payload.

    Its own fields on the lead rather than a second write to diet_fee_paid, because a
    patient can be sold both on one visit. Sharing one pair of fields would make whichever
    fee was collected second erase the first, and the branch would have no way to say which
    of the two products the money on file was actually for.

    Collected in one go, by the same four modes, for the same reason the Diet Consultation
    Fee is: a chart is one plan at one price, so there is nothing to spread over a schedule.

    Still two products on two shelves, and still not gated on the Diet Consultation Fee
    having been paid. What it now requires is that a chart has been CALLED FOR: the
    Nutritionist recommends one at the consultation, having seen the patient, and until they
    do there is nothing here to price. The Consultant used to answer that question at their
    own consultation, before the patient had met a coach at all, which let this desk collect
    for a chart nobody had decided was needed.

    Does not touch consultation_stage, for the same reason collect_diet_fee does not: diet
    is a parallel vertical, and moving the physio pipeline as a side effect of a diet
    payment would misreport where the patient actually is.
    """
    if payload.payment_mode not in DIET_FEE_PAYMENT_MODES:
        raise HTTPException(status_code=400, detail=f"Diet Chart Fee only accepts: {sorted(DIET_FEE_PAYMENT_MODES)}")
    if not payload.confirmed:
        raise HTTPException(status_code=400, detail="Please confirm the payment before submitting")

    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("package_paid") is None:
        raise HTTPException(status_code=400, detail="Collect the Consultation Fee first")
    # A chart has to have been called for before it can be sold, and the Nutritionist is who
    # calls for one -- see recommend_diet_chart. The branch's own panel already holds the
    # button behind this flag; this is the half that holds whatever reaches the route
    # another way, the same as every other gate in this file.
    #
    # Leads carrying diet_chart from before this pass, when the Consultant ticked it, are
    # unaffected: the flag they were given is the flag being read here.
    if not lead.get("diet_chart"):
        raise HTTPException(
            status_code=400,
            detail="The Nutritionist has not recommended a Diet Chart for this patient yet",
        )

    item = await v3_col("store_items").find_one(
        {"id": payload.item_id, "item_type": {"$in": list(DIET_ITEM_TYPES)}}, {"_id": 0}
    )
    if not item:
        raise HTTPException(status_code=404, detail="Diet Package not found. Add one in FITSIO STORE > Diet Package.")

    original_price = item.get("price_online") if payload.mode == "online" else item.get("price_offline")
    if original_price is None:
        raise HTTPException(status_code=400, detail=f"This Diet Package has no {payload.mode} price set")
    net_payable = round(original_price - round(payload.discount_amount or 0, 2), 2)
    amount = payload.amount if payload.amount is not None else net_payable
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    settled = settle_fee_money(
        list_price=original_price,
        amount=amount,
        discount_in=payload.discount_amount,
        balance_due_date=payload.balance_due_date,
        existing_installments=(lead.get("diet_chart_fee_payment_details") or {}).get("installments"),
    )
    discount_amount = settled["discount"]
    discount_reason = settled["reason"]
    discount_suffix = settled["suffix"]
    balance_suffix = settled["balance_suffix"]

    payment_details, detail_suffix = build_payment_details(payload)
    is_update = lead.get("diet_chart_fee_paid") is not None
    transaction_id = await generate_transaction_id(lead.get("branch_id"))
    payment_details["transaction_id"] = transaction_id
    if discount_amount > 0:
        payment_details["discount_amount"] = discount_amount
    # The new balance if this collection left one, otherwise whatever schedule the fee
    # already had — see settle_fee_money: a correction must not erase how the money came in.
    if settled["installments"] or settled["carry"]:
        payment_details["installments"] = settled["installments"] or settled["carry"]

    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "diet_chart_package_id": item["id"],
        "diet_chart_package_name": item["name"],
        "diet_chart_package_price": original_price,
        "diet_chart_package_mode": payload.mode,
        "diet_chart_fee_paid": amount,
        "diet_chart_fee_payment_mode": payload.payment_mode,
        "diet_chart_fee_payment_details": payment_details,
        # Paying for a chart IS the referral for one, exactly as the Diet Consultation Fee
        # is its own — both flags, because /diet/consultations reads diet_recommended to
        # decide who is in the vertical at all and the coach's chart queue reads
        # diet_chart to decide who is owed a chart. Without these a patient could pay for a
        # chart nobody was ever asked to write.
        "diet_recommended": True,
        "diet_chart": True,
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "transaction_id": transaction_id,
        "lead_id": lead_id,
        "action": "diet_chart_fee_collected",
        "details": f"{'Updated' if is_update else 'Collected'} Diet Chart Fee Rs.{amount} for '{item['name']}' ({payload.mode}) via {payload.payment_mode}{detail_suffix}{discount_suffix}{balance_suffix} · Txn {transaction_id}",
        "original_amount": original_price,
        "collected_amount": amount,
        "discount_amount": discount_amount if discount_amount != 0 else None,
        "discount_reason": discount_reason,
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Payment collected", "transaction_id": transaction_id, "lead": V3LeadOut(**updated).model_dump()}


@router.post("/leads/{lead_id}/collect-package-payment", response_model=dict)
async def collect_package_payment(lead_id: str, payload: V3CollectPackagePaymentInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Branch admin collects the Consultation Fee for the package the consultant
    already assigned — Cash/UPI/Card. The amount defaults to package_price but Branch
    Admin can manually override it (discount, rounding, partial cash collected).
    Every mode requires an explicit `confirmed` acknowledgement before it's accepted —
    a deliberate double-check, not a single click. Callable while the lead is at
    'Consultation Visit' (first collection) or already at 'Fee Collected' (correcting/
    updating a payment already on file)."""
    lines = payload.payment_lines or []
    if not lines and payload.payment_mode not in CONSULTATION_FEE_PAYMENT_MODES:
        raise HTTPException(status_code=400, detail=f"Consultation Fee only accepts: {sorted(CONSULTATION_FEE_PAYMENT_MODES)}")
    for line in lines:
        if line.mode not in CONSULTATION_FEE_PAYMENT_MODES:
            raise HTTPException(status_code=400, detail=f"Consultation Fee only accepts: {sorted(CONSULTATION_FEE_PAYMENT_MODES)}")
        if line.amount is None or line.amount <= 0:
            raise HTTPException(status_code=400, detail="Every payment in a split must be more than zero")
    if not payload.confirmed:
        raise HTTPException(status_code=400, detail="Please confirm the payment before submitting")
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("consultation_stage") not in ("Consultation Visit", "Fee Collected"):
        raise HTTPException(status_code=400, detail="Consultation Fee can only be collected once the CONSULTANT has completed the consultation")
    if not lead.get("package_id") or lead.get("package_price") is None:
        raise HTTPException(status_code=400, detail="No consultation package assigned yet")

    original_price = lead["package_price"]
    # What is payable once the typed discount is off the price. The amount falls back to
    # it rather than to the price, and anything below it is a balance, not a write-off —
    # settle_fee_money below is where both of those are worked out.
    net_payable = round(original_price - round(payload.discount_amount or 0, 2), 2)
    if lines:
        # Summed from the tenders rather than taken alongside them. Two numbers for one
        # sum is one number too many: the total and its parts can only ever disagree,
        # and the parts are what was actually handed over.
        amount = round(sum(line.amount for line in lines), 2)
        # Still checked against what the screen said, so a total that drifted from the
        # fee being collected is refused rather than quietly banked.
        if payload.amount is not None and abs(payload.amount - amount) > 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"The payments add up to Rs.{amount:g}, but the fee being collected is Rs.{payload.amount:g}",
            )
    else:
        amount = payload.amount if payload.amount is not None else net_payable
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    # A discount Branch Admin negotiated on the spot (Rs.800 assigned, Rs.750 agreed) is
    # typed into the Discount box and logged with its reason, so Transaction History says
    # why and not just how much. What it is NOT is any amount that happens to come in
    # under the price: a client paying Rs.750 of Rs.800 today and the rest on Friday owes
    # Rs.50, and that is scheduled as a balance rather than forgiven.
    settled = settle_fee_money(
        list_price=original_price,
        amount=amount,
        discount_in=payload.discount_amount,
        balance_due_date=payload.balance_due_date,
        over_label="above assigned fee",
        existing_installments=(lead.get("package_payment_details") or {}).get("installments"),
    )
    discount_amount = settled["discount"]
    discount_reason = settled["reason"]
    discount_suffix = settled["suffix"]
    balance_suffix = settled["balance_suffix"]

    payment_details = {}
    detail_suffix = ""
    if lines:
        # Each cash tender counted against its own amount, not the whole fee: the cash
        # half of a Rs.600 cash + Rs.600 UPI split is Rs.600, and checking those notes
        # against Rs.1200 would reject a correct count every time.
        line_notes = [
            _settle_cash_count(ln.denominations, ln.amount, f" for the Rs.{ln.amount:g} cash payment") if ln.mode == "cash" else {}
            for ln in lines
        ]
        # Each tender kept whole, in the order it was entered, so a receipt or a query
        # months later can say which half came in which way — and, for cash, what it was
        # counted out in.
        payment_details = {"payment_lines": [
            {
                "mode": ln.mode,
                "amount": ln.amount,
                "reference": (ln.reference or "").strip(),
                "denominations": counted,
            }
            for ln, counted in zip(lines, line_notes)
        ]}
        detail_suffix = " · Split: " + ", ".join(
            f"Rs.{ln.amount:g} {ln.mode}"
            + (f" ({ln.reference.strip()})" if (ln.reference or "").strip() else "")
            + (f" [{_notes_label(counted)}]" if counted else "")
            for ln, counted in zip(lines, line_notes)
        )
    elif payload.payment_mode == "cash":
        # The only branch cash has ever needed here. Left empty when nobody counted, so
        # the record says "not counted" rather than "counted, and it came to nothing".
        counted = _settle_cash_count(payload.denominations, amount)
        if counted:
            payment_details = {"denominations": counted}
            detail_suffix = f" · Counted {_notes_label(counted)}"
    elif payload.payment_mode == "upi":
        # Transaction id alone -- see the note in collect_treatment_fee below. The popup
        # that posts here stopped asking for a UTR, so requiring one would 400 every UPI
        # collection; it is still stored whenever a caller sends one.
        if not payload.upi_transaction_id or not payload.upi_transaction_id.strip():
            raise HTTPException(status_code=400, detail="UPI Transaction ID is required")
        txn = payload.upi_transaction_id.strip()
        utr = (payload.upi_utr or "").strip()
        payment_details = {"upi_transaction_id": txn}
        detail_suffix = f" · UPI txn {txn}"
        if utr:
            payment_details["upi_utr"] = utr
            detail_suffix += f", UTR {utr}"
    elif payload.payment_mode == "card":
        if not all([payload.account_number and payload.account_number.strip(), payload.account_holder_name and payload.account_holder_name.strip(),
                    payload.bank_name and payload.bank_name.strip(), payload.ifsc_code and payload.ifsc_code.strip()]):
            raise HTTPException(status_code=400, detail="Account Number, Account Holder Name, Bank Name and IFSC Code are required")
        last4 = "".join(ch for ch in payload.account_number if ch.isdigit())[-4:]
        payment_details = {
            "account_last4": last4,
            "account_holder_name": payload.account_holder_name.strip(),
            "bank_name": payload.bank_name.strip(),
            "ifsc_code": payload.ifsc_code.strip().upper(),
        }
        detail_suffix = f" · A/C ****{last4}, {payload.account_holder_name.strip()}, {payload.bank_name.strip()} ({payload.ifsc_code.strip().upper()})"
    elif payload.payment_mode == "account_transfer":
        if not all([payload.account_number and payload.account_number.strip(), payload.account_holder_name and payload.account_holder_name.strip(),
                    payload.bank_name and payload.bank_name.strip(), payload.ifsc_code and payload.ifsc_code.strip(),
                    payload.transfer_reference and payload.transfer_reference.strip()]):
            raise HTTPException(status_code=400, detail="Account Number, Account Holder Name, Bank Name, IFSC Code and Reference/UTR No. are required")
        last4 = "".join(ch for ch in payload.account_number if ch.isdigit())[-4:]
        payment_details = {
            "account_last4": last4,
            "account_holder_name": payload.account_holder_name.strip(),
            "bank_name": payload.bank_name.strip(),
            "ifsc_code": payload.ifsc_code.strip().upper(),
            "transfer_reference": payload.transfer_reference.strip(),
        }
        detail_suffix = f" · A/C ****{last4}, {payload.account_holder_name.strip()}, {payload.bank_name.strip()} ({payload.ifsc_code.strip().upper()}) · Ref {payload.transfer_reference.strip()}"

    is_update = lead.get("package_paid") is not None
    # One id per collection, cash included. A correction re-collects and is a fresh
    # transaction, so it gets its own id rather than overwriting the original's.
    transaction_id = await generate_transaction_id(lead.get("branch_id"))
    payment_details["transaction_id"] = transaction_id
    # "split" rather than one of the four, for the same reason the lines exist: naming
    # either half would make the record say something that is only half true. Finance
    # reads the breakdown off payment_details and off the activity line below.
    settled_mode = "split" if lines else payload.payment_mode
    # Both go on the record, not only into the activity line: the discount so reopening
    # the popup reloads what was agreed instead of starting at zero, and the balance so
    # every panel that reads a schedule can show it and collect it later.
    if discount_amount > 0:
        payment_details["discount_amount"] = discount_amount
    # The new balance if this collection left one, otherwise whatever schedule the fee
    # already had — see settle_fee_money: a correction must not erase how the money came in.
    if settled["installments"] or settled["carry"]:
        payment_details["installments"] = settled["installments"] or settled["carry"]
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "package_paid": amount,
        "package_payment_mode": settled_mode,
        "package_payment_details": payment_details,
        "consultation_stage": "Fee Collected",
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "transaction_id": transaction_id,
        "lead_id": lead_id,
        "action": "package_payment_collected",
        "details": f"{'Updated' if is_update else 'Collected'} Consultation Fee Rs.{amount} for package '{lead.get('package_name')}' via {settled_mode}{detail_suffix}{discount_suffix}{balance_suffix} · Txn {transaction_id}",
        "original_amount": original_price,
        "collected_amount": amount,
        "discount_amount": discount_amount if discount_amount != 0 else None,
        "discount_reason": discount_reason,
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Payment collected", "transaction_id": transaction_id, "lead": V3LeadOut(**updated).model_dump()}


@router.post("/leads/{lead_id}/collect-rehab-fee", response_model=dict)
async def collect_rehab_fee(lead_id: str, payload: V3CollectRehabFeeInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Branch admin collects the Rehab course fee.

    The course was chosen by the Consultant at the consultation decision, so it is read
    off the lead rather than picked again here — the same way the Treatment Fee reads
    session_package_id. Collected in one go, like the Diet Consultation Fee.

    Deliberately does not touch consultation_stage. Rehab is a parallel programme, and
    moving the physio pipeline as a side effect of a rehab payment would misreport
    where the patient actually is — the same reasoning collect_diet_fee gives.
    """
    if payload.payment_mode not in REHAB_FEE_PAYMENT_MODES:
        raise HTTPException(status_code=400, detail=f"Rehab Fee only accepts: {sorted(REHAB_FEE_PAYMENT_MODES)}")
    if not payload.confirmed:
        raise HTTPException(status_code=400, detail="Please confirm the payment before submitting")

    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    # The Consultation Fee is the only prerequisite, as it is for diet: a patient can be
    # sent to rehab without ever buying a treatment package.
    if lead.get("package_paid") is None:
        raise HTTPException(status_code=400, detail="Collect the Consultation Fee first")
    if not lead.get("rehab_package_id") or lead.get("rehab_package_price") is None:
        raise HTTPException(status_code=400, detail="No Rehab course was chosen at the consultation yet")

    original_price = lead["rehab_package_price"]
    net_payable = round(original_price - round(payload.discount_amount or 0, 2), 2)
    amount = payload.amount if payload.amount is not None else net_payable
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    # Same rule every fee is settled by: a discount is the figure that was typed, and
    # money short of what that leaves payable is a balance still owed, not a write-off.
    settled = settle_fee_money(
        list_price=original_price,
        amount=amount,
        discount_in=payload.discount_amount,
        balance_due_date=payload.balance_due_date,
        existing_installments=(lead.get("rehab_fee_payment_details") or {}).get("installments"),
    )
    discount_amount = settled["discount"]
    discount_reason = settled["reason"]
    discount_suffix = settled["suffix"]
    balance_suffix = settled["balance_suffix"]

    payment_details, detail_suffix = build_payment_details(payload)
    is_update = lead.get("rehab_fee_paid") is not None
    transaction_id = await generate_transaction_id(lead.get("branch_id"))
    payment_details["transaction_id"] = transaction_id
    if discount_amount > 0:
        payment_details["discount_amount"] = discount_amount
    # The new balance if this collection left one, otherwise whatever schedule the fee
    # already had — see settle_fee_money: a correction must not erase how the money came in.
    if settled["installments"] or settled["carry"]:
        payment_details["installments"] = settled["installments"] or settled["carry"]

    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "rehab_fee_paid": amount,
        "rehab_fee_payment_mode": payload.payment_mode,
        "rehab_fee_payment_details": payment_details,
        # The fee is the referral when nobody ticked one — same reasoning collect_diet_fee
        # gives, so a paying patient is on the rehab list either way.
        "rehab_referred": True,
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "transaction_id": transaction_id,
        "lead_id": lead_id,
        "action": "rehab_fee_collected",
        "details": f"{'Updated' if is_update else 'Collected'} Rehab Fee Rs.{amount} for '{lead.get('rehab_package_name', 'Rehab')}' ({lead.get('rehab_package_mode') or 'offline'}) via {payload.payment_mode}{detail_suffix}{discount_suffix}{balance_suffix} · Txn {transaction_id}",
        "original_amount": original_price,
        "collected_amount": amount,
        "discount_amount": discount_amount if discount_amount != 0 else None,
        "discount_reason": discount_reason,
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Payment collected", "transaction_id": transaction_id, "lead": V3LeadOut(**updated).model_dump()}


@router.post("/leads/{lead_id}/collect-treatment-fee", response_model=dict)
async def collect_treatment_fee(lead_id: str, payload: V3CollectTreatmentFeeInput, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Branch admin collects the Treatment Fee for the Session package the Head
    Physio already chose during the consultation decision (Consultation + Treatment).
    The package itself is locked in from session_package_id — Cash/UPI/Card/Account
    Transfer can manually override the amount and require an explicit confirmation;
    Cheque/Partial Payment keep the locked session_package_price as before. What comes
    off the bill is only `discount_amount`, which somebody has to type; an amount below
    what is then payable is a part payment, and the rest is scheduled as an unpaid
    balance installment to be collected later under any payment mode. Both Consultation Fee and Treatment Fee are
    collected while the lead rests in the 'Fee Collected' stage; it stays there
    after this call — moving on to Physio Assign is a separate, explicit action
    (assign-consultation-physio), not an automatic side effect of payment."""
    if payload.payment_mode not in TREATMENT_FEE_PAYMENT_MODES:
        raise HTTPException(status_code=400, detail=f"Treatment Fee only accepts: {sorted(TREATMENT_FEE_PAYMENT_MODES)}")
    # A fee that arrived in more than one piece -- see V3PaymentLineInput. Every tender
    # has to be money that settles today: a cheque clears when it clears, and Partial
    # Payment is a plan for later, so neither can be half of what was taken now.
    lines = payload.payment_lines or []
    if lines:
        if payload.payment_mode not in SETTLED_NOW_MODES:
            raise HTTPException(status_code=400, detail="A split settles now — Cheque and Partial Payment go in as a single payment")
        for line in lines:
            if line.mode not in SETTLED_NOW_MODES:
                raise HTTPException(status_code=400, detail=f"A split payment accepts: {sorted(SETTLED_NOW_MODES)}")
            if line.amount is None or line.amount <= 0:
                raise HTTPException(status_code=400, detail="Every payment in a split must be more than zero")
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("consultation_decision") != "consultation_treatment":
        raise HTTPException(status_code=400, detail="This patient's consultation was marked 'Consultation Only' — no Treatment Fee to collect")
    if lead.get("consultation_stage") not in ("Fee Collected", "Physio Assign"):
        raise HTTPException(status_code=400, detail="Treatment Fee can only be collected after the Consultation Fee has been collected")
    if not lead.get("session_package_id") or lead.get("session_package_price") is None:
        raise HTTPException(status_code=400, detail="No treatment package was selected by the CONSULTANT yet")

    # Cash/UPI/Card can be manually adjusted (discount, rounding, partial cash
    # collected); Cheque and Partial Payment keep the locked session_package_price.
    original_price = lead["session_package_price"]
    total_sessions = lead.get("session_package_sessions") or 0
    per_session_rate = (original_price / total_sessions) if total_sessions else 0

    # Cash/UPI/Card/Cheque can ALSO collect for only some of the package's sessions
    # right now (e.g. 5 of 10) — sessions_now defaults to every session (today's
    # full-collection behavior) when the caller doesn't specify it.
    sessions_now = total_sessions
    is_partial_sessions = False
    if payload.payment_mode in PART_SESSION_MODES and payload.sessions_now is not None:
        sessions_now = payload.sessions_now
        if total_sessions and (sessions_now <= 0 or sessions_now > total_sessions):
            raise HTTPException(status_code=400, detail="Sessions Covered Now must be between 1 and the package's total sessions")
        is_partial_sessions = total_sessions > 0 and sessions_now < total_sessions

    computed_amount = round(sessions_now * per_session_rate, 2) if total_sessions else original_price

    # Only a typed discount comes off the bill, and only the modes that settle now can
    # negotiate one — see settle_fee_money, which every fee in this file is settled by.
    # Worked out here, ahead of the amount, because the amount defaults to what it leaves
    # payable; the balance it leaves is settled once the amount is known, further down.
    can_discount = payload.payment_mode in SETTLED_NOW_MODES
    net_payable = round(computed_amount - (round(payload.discount_amount or 0, 2) if can_discount else 0), 2)

    if payload.payment_mode in SETTLED_NOW_MODES:
        if lines:
            # Summed from the tenders rather than taken alongside them. Two numbers for
            # one sum is one too many: they can only ever disagree, and the parts are
            # what was actually handed over.
            amount = round(sum(line.amount for line in lines), 2)
            # Still checked against what the screen was collecting, so a total that
            # drifted from the fee on display is refused rather than quietly banked --
            # and the discount worked out against that fee stays honest with it.
            if payload.amount is not None and abs(payload.amount - amount) > 0.01:
                raise HTTPException(
                    status_code=400,
                    detail=f"The payments add up to Rs.{amount:g}, but the fee being collected is Rs.{payload.amount:g}",
                )
        else:
            amount = payload.amount if payload.amount is not None else net_payable
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    elif payload.payment_mode == "cheque":
        amount = computed_amount
    else:
        amount = original_price

    if payload.payment_mode in SETTLED_NOW_MODES and not payload.confirmed:
        raise HTTPException(status_code=400, detail="Please confirm the payment before submitting")

    # The discount that was agreed, and whatever of the package is still owed once this
    # money is in — one rule, shared with every other fee. The discount is measured
    # against the sessions being collected for; the balance against the whole package,
    # so collecting for fewer sessions leaves the rest owing rather than discounted.
    settled = settle_fee_money(
        list_price=computed_amount,
        total_price=original_price,
        amount=amount,
        discount_in=payload.discount_amount,
        balance_due_date=payload.balance_due_date,
        allow_discount=can_discount,
        over_label="above assigned fee",
        existing_installments=(lead.get("treatment_fee_payment_details") or {}).get("installments"),
    )
    discount_amount = settled["discount"]
    discount_reason = settled["reason"]
    discount_suffix = settled["suffix"]

    # Mode-specific required fields + a structured payment_details record for the
    # receipt/activity log. Account number is never persisted beyond its last 4 digits.
    payment_details = {}
    detail_suffix = ""
    installments = []
    if lines:
        # Each cash tender counted against its own amount, not the whole fee -- the same
        # rule the Consultation Fee's split is settled under, for the same reason: the
        # cash half of a Rs.4000 cash + Rs.4000 UPI split is Rs.4000, and checking those
        # notes against Rs.8000 would reject a correct count every time.
        line_notes = [
            _settle_cash_count(ln.denominations, ln.amount, f" for the Rs.{ln.amount:g} cash payment") if ln.mode == "cash" else {}
            for ln in lines
        ]
        # Each tender kept whole, in the order it was entered, so a receipt or a query
        # months later can still say which part of the fee came in which way -- and, for
        # cash, what it was counted out in.
        payment_details = {"payment_lines": [
            {
                "mode": ln.mode,
                "amount": ln.amount,
                "reference": (ln.reference or "").strip(),
                "denominations": counted,
            }
            for ln, counted in zip(lines, line_notes)
        ]}
        detail_suffix = " · Split: " + ", ".join(
            f"Rs.{ln.amount:g} {ln.mode}"
            + (f" ({ln.reference.strip()})" if (ln.reference or "").strip() else "")
            + (f" [{_notes_label(counted)}]" if counted else "")
            for ln, counted in zip(lines, line_notes)
        )
    elif payload.payment_mode == "cash":
        # Cash had no branch here at all until now -- it needed no fields. It has one
        # thing to record: what the notes were, when somebody counted them. Left empty
        # when nobody did, so the record says "not counted" rather than "counted, and it
        # came to nothing".
        counted = _settle_cash_count(payload.denominations, amount)
        if counted:
            payment_details = {"denominations": counted}
            detail_suffix = f" · Counted {_notes_label(counted)}"
    elif payload.payment_mode == "upi":
        # Transaction id alone. The Treatment Fee's UPI popup stopped asking for a UTR,
        # and a required field the form can no longer supply is a 400 on every UPI
        # collection -- the one mode of payment the desk uses most. Still recorded when a
        # caller sends one, so the collections taken while the field existed keep theirs
        # and the older endpoints above are free to go on requiring it.
        if not payload.upi_transaction_id or not payload.upi_transaction_id.strip():
            raise HTTPException(status_code=400, detail="UPI Transaction ID is required")
        txn = payload.upi_transaction_id.strip()
        utr = (payload.upi_utr or "").strip()
        payment_details = {"upi_transaction_id": txn}
        detail_suffix = f" · UPI txn {txn}"
        if utr:
            payment_details["upi_utr"] = utr
            detail_suffix += f", UTR {utr}"
    elif payload.payment_mode == "card":
        if not all([payload.account_number and payload.account_number.strip(), payload.account_holder_name and payload.account_holder_name.strip(),
                    payload.bank_name and payload.bank_name.strip(), payload.ifsc_code and payload.ifsc_code.strip()]):
            raise HTTPException(status_code=400, detail="Account Number, Account Holder Name, Bank Name and IFSC Code are required")
        last4 = "".join(ch for ch in payload.account_number if ch.isdigit())[-4:]
        payment_details = {
            "account_last4": last4,
            "account_holder_name": payload.account_holder_name.strip(),
            "bank_name": payload.bank_name.strip(),
            "ifsc_code": payload.ifsc_code.strip().upper(),
        }
        detail_suffix = f" · A/C ****{last4}, {payload.account_holder_name.strip()}, {payload.bank_name.strip()} ({payload.ifsc_code.strip().upper()})"
    elif payload.payment_mode == "cheque":
        if not payload.bank_name or not payload.bank_name.strip() or not payload.cheque_number or not payload.cheque_number.strip():
            raise HTTPException(status_code=400, detail="Bank Name and Cheque Number are required")
        payment_details = {
            "bank_name": payload.bank_name.strip(),
            "cheque_number": payload.cheque_number.strip(),
            "amount": amount,
        }
        detail_suffix = f" · Cheque #{payload.cheque_number.strip()}, {payload.bank_name.strip()}"
    elif payload.payment_mode == "account_transfer":
        if not all([payload.account_number and payload.account_number.strip(), payload.account_holder_name and payload.account_holder_name.strip(),
                    payload.bank_name and payload.bank_name.strip(), payload.ifsc_code and payload.ifsc_code.strip(),
                    payload.transfer_reference and payload.transfer_reference.strip()]):
            raise HTTPException(status_code=400, detail="Account Number, Account Holder Name, Bank Name, IFSC Code and Reference/UTR No. are required")
        last4 = "".join(ch for ch in payload.account_number if ch.isdigit())[-4:]
        payment_details = {
            "account_last4": last4,
            "account_holder_name": payload.account_holder_name.strip(),
            "bank_name": payload.bank_name.strip(),
            "ifsc_code": payload.ifsc_code.strip().upper(),
            "transfer_reference": payload.transfer_reference.strip(),
        }
        detail_suffix = f" · A/C ****{last4}, {payload.account_holder_name.strip()}, {payload.bank_name.strip()} ({payload.ifsc_code.strip().upper()}) · Ref {payload.transfer_reference.strip()}"
    elif payload.payment_mode == "partial":
        installments = payload.partial_installments or []
        if len(installments) < 2:
            raise HTTPException(status_code=400, detail="At least two installments are required for Partial Payment")
        if any(inst.amount <= 0 or not inst.due_date for inst in installments):
            raise HTTPException(status_code=400, detail="Every installment needs an amount and a due date")
        installments_total = round(sum(inst.amount for inst in installments), 2)
        if installments_total != round(amount, 2):
            raise HTTPException(status_code=400, detail="Installment amounts must add up to the Treatment Fee")
        payment_details = {
            # This call only schedules the plan — every installment starts unpaid.
            # Collecting one (including one due today) is a separate, explicit action
            # (mark_installment_paid), not an automatic side effect of scheduling.
            "installments": [{"amount": inst.amount, "due_date": inst.due_date, "paid": False} for inst in installments],
        }
        ordinals = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"]
        parts = [
            f"{ordinals[i] if i < len(ordinals) else f'#{i + 1}'} Rs.{inst.amount} due {inst.due_date}"
            for i, inst in enumerate(installments)
        ]
        detail_suffix = f" · {', '.join(parts)}"

    # The discount goes on the record, not only into the activity line, so reopening the
    # popup to correct a payment mode reloads the discount that was agreed instead of
    # starting at zero and turning the difference back into a balance nobody owes.
    if discount_amount > 0:
        payment_details["discount_amount"] = discount_amount

    # The balance the helper worked out, stored on the record with the sessions each half
    # covers — the one thing a treatment schedule carries that the other fees' don't,
    # since theirs are a single price paid once.
    balance_suffix = settled["balance_suffix"]
    if payload.payment_mode in PART_SESSION_MODES and settled["installments"]:
        remaining_sessions = total_sessions - sessions_now
        paid_now, owing = settled["installments"]
        payment_details["installments"] = [
            {**paid_now, "sessions": sessions_now},
            {**owing, "sessions": remaining_sessions},
        ]
        covered = f" · covers {sessions_now} of {total_sessions} sessions" if is_partial_sessions else ""
        sessions_label = f" ({remaining_sessions} sessions)" if remaining_sessions > 0 else ""
        balance_suffix = f"{covered} · balance Rs.{settled['balance']}{sessions_label} due {payload.balance_due_date}"
    elif settled["carry"] and not payment_details.get("installments"):
        # Nothing new owed, and no Partial Payment plan written just now — keep the
        # schedule the fee already had, for the reason settle_fee_money gives.
        payment_details["installments"] = settled["carry"]

    # Partial Payment only schedules a plan here -- no money moves, so it gets no
    # transaction id. Each installment is collected separately and earns its own.
    transaction_id = None
    if payload.payment_mode != "partial":
        transaction_id = await generate_transaction_id(lead.get("branch_id"))
        payment_details["transaction_id"] = transaction_id

    is_update = lead.get("treatment_fee_paid") is not None
    # "split" rather than one of the four, for the same reason the lines exist: naming
    # any one of them would make the record say something only part true. The breakdown
    # is in payment_details and spelled out on the activity line below.
    settled_mode = "split" if lines else payload.payment_mode
    # Rests at 'Fee Collected' on first collection — Physio Assign only happens via
    # the separate assign-consultation-physio action. If this is just a payment-mode
    # correction on a lead that's already past that (physio already assigned), leave
    # its stage where it is rather than moving it backward.
    stage_after = "Physio Assign" if lead.get("consultation_stage") == "Physio Assign" else "Fee Collected"
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "treatment_fee_paid": amount,
        "treatment_fee_payment_mode": settled_mode,
        "treatment_fee_payment_details": payment_details or None,
        "consultation_stage": stage_after,
        "updated_at": _now(),
    }})
    # Partial Payment schedules nothing as collected yet — the log should say a
    # schedule was created, not that money came in, since collecting any one
    # installment (including one due today) is now its own separate action.
    if payload.payment_mode == "partial":
        details = f"{'Updated' if is_update else 'Created'} Payment Schedule for session package '{lead.get('session_package_name')}' ({lead.get('session_package_sessions')} sessions) · Rs.{amount} across {len(installments)} installments{detail_suffix}"
    else:
        details = f"{'Updated' if is_update else 'Collected'} Treatment Fee for session package '{lead.get('session_package_name')}' ({lead.get('session_package_sessions')} sessions) · Rs.{amount} via {settled_mode}{detail_suffix}{discount_suffix}{balance_suffix} · Txn {transaction_id}"
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "transaction_id": transaction_id,
        "lead_id": lead_id,
        "action": "treatment_fee_collected",
        "details": details,
        "original_amount": computed_amount if payload.payment_mode in SETTLED_NOW_MODES else None,
        "collected_amount": amount if payload.payment_mode in SETTLED_NOW_MODES else None,
        "discount_amount": discount_amount if discount_amount != 0 else None,
        "discount_reason": discount_reason,
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Payment collected", "transaction_id": transaction_id, "lead": V3LeadOut(**updated).model_dump()}


@router.post("/leads/{lead_id}/mark-consultation-completed", response_model=dict)
async def mark_consultation_completed(lead_id: str, user: V3UserOut = Depends(v3_require_roles("branch_admin", "super_admin"))):
    """Branch Admin closes out a 'Consultation Only' patient once the Consultation
    Fee has been collected — no Treatment Fee is ever collected on this path."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("consultation_decision") != "consultation_only":
        raise HTTPException(status_code=400, detail="Only a 'Consultation Only' patient can be marked completed here")
    if lead.get("consultation_stage") not in ("Fee Collected", "Consultation Completed"):
        raise HTTPException(status_code=400, detail="Consultation Fee must be collected before marking the consultation completed")

    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "consultation_stage": "Consultation Completed",
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "consultation_completed",
        "details": "Consultation marked completed (Consultation Only — no treatment sessions)",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return {"message": "Consultation completed", "lead": V3LeadOut(**updated).model_dump()}


@router.post("/leads/{lead_id}/physio-diagnosis", response_model=V3LeadOut)
async def save_physio_diagnosis(lead_id: str, payload: V3PhysioDiagnosisInput, user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin"))):
    """Head Physio's own diagnosis report — separate from Pre-Sales' basic
    `diagnosis` field, which stays read-only reference material here."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("physio_diagnosis_locked"):
        raise HTTPException(status_code=400, detail="Diagnosis report is locked — unlock it first to edit")
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "physio_diagnosis_report": payload.report,
        "physio_diagnosis_locked": payload.locked,
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "physio_diagnosis_saved",
        "details": f"Diagnosis report {'saved & locked' if payload.locked else 'saved'} by {user.full_name}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


@router.put("/leads/{lead_id}/physio-diagnosis/unlock", response_model=V3LeadOut)
async def unlock_physio_diagnosis(lead_id: str, user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin"))):
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {"physio_diagnosis_locked": False, "updated_at": _now()}})
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not updated:
        raise HTTPException(status_code=404, detail="Lead not found")
    return V3LeadOut(**updated)


@router.post("/leads/{lead_id}/treatment-summary", response_model=V3LeadOut)
async def save_treatment_summary(lead_id: str, payload: V3TreatmentSummaryInput, user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin"))):
    """Head Physio's treatment plan summary — what treatment to give the patient."""
    lead = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.get("treatment_summary_locked"):
        raise HTTPException(status_code=400, detail="Treatment summary is locked — unlock it first to edit")
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {
        "treatment_summary": payload.summary,
        "treatment_summary_locked": payload.locked,
        "updated_at": _now(),
    }})
    await v3_col("lead_activity").insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "action": "treatment_summary_saved",
        "details": f"Treatment summary {'saved & locked' if payload.locked else 'saved'} by {user.full_name}",
        "created_by": user.full_name,
        "created_by_role": user.role,
        "created_at": _now(),
    })
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    return V3LeadOut(**updated)


@router.put("/leads/{lead_id}/treatment-summary/unlock", response_model=V3LeadOut)
async def unlock_treatment_summary(lead_id: str, user: V3UserOut = Depends(v3_require_roles("head_physio", "super_admin"))):
    await v3_col("leads").update_one({"id": lead_id}, {"$set": {"treatment_summary_locked": False, "updated_at": _now()}})
    updated = await v3_col("leads").find_one({"id": lead_id}, {"_id": 0})
    if not updated:
        raise HTTPException(status_code=404, detail="Lead not found")
    return V3LeadOut(**updated)
