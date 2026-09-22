"""FITSIOMAX STORE > Vendor — who the stock comes from, and which of it they supply.

One collection, `vendors`, sitting beside the three in v3_inventory.py. It is org-wide for
the same reason the item catalogue is: a vendor supplying two branches is one vendor, and
two branches spelling the same supplier differently is how a spend figure stops being a
spend figure. Stock itself stays per branch — nothing here holds a count.

The link to stock is `item_ids`, the catalogue rows this vendor supplies. It is kept on
the vendor rather than on the item because that is the direction both screens read it: the
Vendor tab lists a vendor and what they supply, and Add Stock asks which vendors supply
one item — a single-key lookup either way. Booking a delivery against a vendor adds that
item to the list if it isn't there already, so the link is maintained by using it rather
than by remembering to tick a box.

Deliveries are not stored here. They are the `kind="add"` rows in inventory_movements,
which now carry vendor_id and a vendor_name snapshot; this module reads them for the
per-vendor totals and never writes them.
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import v3_col
from deps import v3_require_roles, is_branch_admin_role
from routers.v3_inventory import (
    READ_ROLES,
    VALID_CATEGORIES,
    WRITE_ROLES,
    _escape_regex,
)
from schemas.v3 import V3UserOut
from utils import now_iso

router = APIRouter(prefix="/api/v3/vendors", tags=["vendors"])


def _err(status: int, msg: str):
    return HTTPException(status_code=status, detail=msg)


async def ensure_vendor_indexes():
    """Called from the app's startup hook; create_index is a no-op once it exists.

    The vendor_id index is what keeps the per-vendor totals below from scanning the whole
    movement ledger every time the tab is opened.
    """
    await v3_col("vendors").create_index([("name", 1)], name="vendor_name")
    await v3_col("inventory_movements").create_index(
        [("vendor_id", 1), ("created_at", -1)], name="vendor_recent"
    )


async def _require_vendor(vendor_id: str) -> dict:
    doc = await v3_col("vendors").find_one({"id": vendor_id}, {"_id": 0})
    if not doc:
        raise _err(404, "Vendor not found")
    return doc


def _stats_branch(user: V3UserOut, branch_id: Optional[str]) -> Optional[str]:
    """Whose deliveries the totals count.

    A Branch Admin sees their own branch's, whatever they send — the same pinning every
    stock endpoint does. A Super Admin sees every branch's unless they name one, because
    an org-wide spend per vendor is the thing that desk is looking at.
    """
    if is_branch_admin_role(user.role):
        if not user.branch_id:
            raise _err(400, "Your login is not attached to a branch")
        return user.branch_id
    return branch_id or None


async def _delivery_stats(vendor_ids: List[str], branch: Optional[str]) -> dict:
    """Deliveries, units, spend and the last date, per vendor."""
    if not vendor_ids:
        return {}
    match = {"kind": "add", "vendor_id": {"$in": vendor_ids}}
    if branch:
        match["branch_id"] = branch
    rows = await v3_col("inventory_movements").aggregate([
        {"$match": match},
        {"$group": {
            "_id": "$vendor_id",
            "deliveries": {"$sum": 1},
            "units": {"$sum": "$qty"},
            "spend": {"$sum": "$amount"},
            # created_at is an ISO string, so the newest one is also the largest one.
            "last_supplied_at": {"$max": "$created_at"},
        }},
    ]).to_list(500)
    return {
        r["_id"]: {
            "deliveries": int(r.get("deliveries") or 0),
            "units": int(r.get("units") or 0),
            "spend": round(float(r.get("spend") or 0), 2),
            "last_supplied_at": r.get("last_supplied_at"),
        }
        for r in rows
    }


async def _item_names(item_ids: List[str]) -> dict:
    ids = [i for i in {*item_ids} if i]
    if not ids:
        return {}
    rows = await v3_col("inventory_items").find(
        {"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1, "category": 1}
    ).to_list(1000)
    return {r["id"]: r for r in rows}


class VendorIn(BaseModel):
    name: str
    contact_person: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    gst_number: Optional[str] = ""
    address: Optional[str] = ""
    city: Optional[str] = ""
    payment_terms: Optional[str] = ""
    notes: Optional[str] = ""
    # Which shelves this vendor supplies — the Store tabs in VALID_CATEGORIES. Empty means
    # "not said yet", not "none": a vendor added from the tab before anything is bought
    # from them still has to be saveable.
    categories: List[str] = []
    # The catalogue rows they supply. Validated against inventory_items so a typo can't
    # create a link to nothing.
    item_ids: List[str] = []
    # Kept rather than deleted once there is history against them — see delete_vendor.
    active: bool = True


def _clean(payload: VendorIn) -> dict:
    name = (payload.name or "").strip()
    if not name:
        raise _err(400, "Vendor name is required")
    bad = [c for c in payload.categories if c not in VALID_CATEGORIES]
    if bad:
        raise _err(400, f"Unknown shelf: {', '.join(bad)}")
    gst = (payload.gst_number or "").strip().upper()
    if gst and len(gst) != 15:
        raise _err(400, "A GST number is 15 characters")
    email = (payload.email or "").strip()
    if email and "@" not in email:
        raise _err(400, "That email address doesn't look right")
    return {
        "name": name,
        "contact_person": (payload.contact_person or "").strip(),
        "phone": (payload.phone or "").strip(),
        "email": email,
        "gst_number": gst,
        "address": (payload.address or "").strip(),
        "city": (payload.city or "").strip(),
        "payment_terms": (payload.payment_terms or "").strip(),
        "notes": (payload.notes or "").strip(),
        "categories": sorted(set(payload.categories) & VALID_CATEGORIES),
        "item_ids": list(dict.fromkeys([i for i in payload.item_ids if i])),
        "active": bool(payload.active),
    }


async def _validate_items(item_ids: List[str]) -> List[str]:
    if not item_ids:
        return []
    known = await _item_names(item_ids)
    missing = [i for i in item_ids if i not in known]
    if missing:
        raise _err(400, "One of the picked items is no longer in the catalogue")
    return item_ids


def _decorate(doc: dict, stats: dict, items: dict) -> dict:
    supplied = [items[i] for i in doc.get("item_ids", []) if i in items]
    s = stats.get(doc["id"], {})
    return {
        **doc,
        "items": [{"id": i["id"], "name": i["name"], "category": i.get("category", "")} for i in supplied],
        "items_count": len(supplied),
        "deliveries": s.get("deliveries", 0),
        "units_supplied": s.get("units", 0),
        "spend": s.get("spend", 0),
        "last_supplied_at": s.get("last_supplied_at"),
    }


@router.get("")
async def list_vendors(
    category: Optional[str] = None,
    item_id: Optional[str] = None,
    search: Optional[str] = None,
    active_only: bool = False,
    branch_id: Optional[str] = None,
    user: V3UserOut = Depends(v3_require_roles(*READ_ROLES)),
):
    """The vendor list, each row carrying what it supplies and what has come in from it.

    `item_id` is the Add Stock picker's question — who supplies this one thing — answered
    from the same endpoint rather than a second one that could disagree with it.
    """
    q = {}
    if category:
        if category not in VALID_CATEGORIES:
            raise _err(400, f"category must be one of {', '.join(sorted(VALID_CATEGORIES))}")
        # A vendor with no shelves marked is one nobody has said anything about yet, not
        # one that supplies nothing — leaving them out here is what would make the Add
        # Stock picker unable to show a vendor added five minutes ago, which is the only
        # way the shelves ever get marked in the first place.
        q["$and"] = [{"$or": [{"categories": category}, {"categories": {"$in": [None, []]}}]}]
    if item_id:
        q["item_ids"] = item_id
    if active_only:
        q["active"] = {"$ne": False}
    if search and search.strip():
        rx = {"$regex": _escape_regex(search.strip()), "$options": "i"}
        q["$or"] = [{"name": rx}, {"contact_person": rx}, {"phone": rx}, {"city": rx}]

    docs = await v3_col("vendors").find(q, {"_id": 0}).sort("name", 1).to_list(500)
    stats = await _delivery_stats([d["id"] for d in docs], _stats_branch(user, branch_id))
    items = await _item_names([i for d in docs for i in d.get("item_ids", [])])
    return [_decorate(d, stats, items) for d in docs]


@router.get("/catalogue")
async def vendor_catalogue(
    category: Optional[str] = None,
    _: V3UserOut = Depends(v3_require_roles(*READ_ROLES)),
):
    """The stock catalogue as a picker — what a vendor can be said to supply.

    Deliberately not /inventory/items: that one answers "what does this branch hold", so
    it needs a branch and a Super Admin has none. A vendor's supply list is about the
    org-wide catalogue and nothing else, so this returns the rows with no counts attached.
    """
    q = {}
    if category:
        if category not in VALID_CATEGORIES:
            raise _err(400, f"category must be one of {', '.join(sorted(VALID_CATEGORIES))}")
        q["category"] = category
    rows = await v3_col("inventory_items").find(
        q, {"_id": 0, "id": 1, "name": 1, "brand": 1, "category": 1, "unit": 1}
    ).sort("name", 1).to_list(500)
    return rows


@router.get("/summary")
async def vendor_summary(
    branch_id: Optional[str] = None,
    user: V3UserOut = Depends(v3_require_roles(*READ_ROLES)),
):
    """The four figures above the table."""
    docs = await v3_col("vendors").find({}, {"_id": 0, "id": 1, "active": 1, "item_ids": 1}).to_list(500)
    stats = await _delivery_stats([d["id"] for d in docs], _stats_branch(user, branch_id))
    return {
        "vendors": len(docs),
        "active": len([d for d in docs if d.get("active", True)]),
        "linked_items": len({i for d in docs for i in d.get("item_ids", [])}),
        "deliveries": sum(s.get("deliveries", 0) for s in stats.values()),
        "spend": round(sum(s.get("spend", 0) for s in stats.values()), 2),
    }


@router.get("/{vendor_id}/deliveries")
async def vendor_deliveries(
    vendor_id: str,
    branch_id: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    user: V3UserOut = Depends(v3_require_roles(*READ_ROLES)),
):
    """What has actually arrived from this vendor — the add rows of the stock ledger."""
    await _require_vendor(vendor_id)
    q = {"kind": "add", "vendor_id": vendor_id}
    branch = _stats_branch(user, branch_id)
    if branch:
        q["branch_id"] = branch
    rows = await v3_col("inventory_movements").find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return {"deliveries": rows}


@router.post("")
async def create_vendor(payload: VendorIn, user: V3UserOut = Depends(v3_require_roles(*WRITE_ROLES))):
    doc = _clean(payload)
    clash = await v3_col("vendors").find_one(
        {"name": {"$regex": f"^{_escape_regex(doc['name'])}$", "$options": "i"}}, {"_id": 0, "id": 1}
    )
    if clash:
        raise _err(409, f"{doc['name']} is already a vendor")
    await _validate_items(doc["item_ids"])

    doc.update({
        "id": str(uuid.uuid4()),
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "created_by": user.id,
        "created_by_name": user.full_name,
    })
    await v3_col("vendors").insert_one(doc.copy())
    items = await _item_names(doc["item_ids"])
    return _decorate(doc, {}, items)


@router.put("/{vendor_id}")
async def update_vendor(vendor_id: str, payload: VendorIn, branch_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_roles(*WRITE_ROLES))):
    await _require_vendor(vendor_id)
    doc = _clean(payload)
    clash = await v3_col("vendors").find_one(
        {"id": {"$ne": vendor_id}, "name": {"$regex": f"^{_escape_regex(doc['name'])}$", "$options": "i"}},
        {"_id": 0, "id": 1},
    )
    if clash:
        raise _err(409, f"{doc['name']} is already a vendor")
    await _validate_items(doc["item_ids"])

    doc["updated_at"] = now_iso()
    await v3_col("vendors").update_one({"id": vendor_id}, {"$set": doc})
    fresh = await v3_col("vendors").find_one({"id": vendor_id}, {"_id": 0})
    stats = await _delivery_stats([vendor_id], _stats_branch(user, branch_id))
    items = await _item_names(fresh.get("item_ids", []))
    return _decorate(fresh, stats, items)


@router.delete("/{vendor_id}")
async def delete_vendor(vendor_id: str, _: V3UserOut = Depends(v3_require_roles(*WRITE_ROLES))):
    """Removed only while nothing has been bought from them.

    Once a delivery is booked against a vendor, that vendor is part of the stock ledger's
    account of where the stock came from, and deleting the row would leave those movements
    pointing at nothing. A vendor no longer used is switched off instead — `active: false`
    keeps the history readable and takes them out of the Add Stock picker.
    """
    vendor = await _require_vendor(vendor_id)
    count = await v3_col("inventory_movements").count_documents({"kind": "add", "vendor_id": vendor_id})
    if count:
        raise _err(400, f"{count} deliveries are recorded against {vendor['name']} — switch the vendor off instead of deleting it")
    await v3_col("vendors").delete_one({"id": vendor_id})
    return {"message": "Vendor removed"}


async def link_vendor_to_item(vendor_id: str, item_id: str, category: Optional[str] = None):
    """Called by the stock add: a delivery is the strongest statement that this vendor
    supplies this item, so both the item and its shelf are recorded without anyone having
    to tick a box."""
    add = {"item_ids": item_id}
    if category in VALID_CATEGORIES:
        add["categories"] = category
    await v3_col("vendors").update_one(
        {"id": vendor_id}, {"$addToSet": add, "$set": {"updated_at": now_iso()}}
    )


async def vendor_for_stock(vendor_id: str) -> dict:
    """The vendor a delivery is being booked against, or a 400 naming why not.

    Lives here rather than in v3_inventory so the rules about a vendor stay in one file;
    v3_inventory imports it inside the request to avoid a circular import at module load.
    """
    vendor = await v3_col("vendors").find_one({"id": vendor_id}, {"_id": 0, "id": 1, "name": 1, "active": 1})
    if not vendor:
        raise _err(400, "That vendor no longer exists")
    if vendor.get("active") is False:
        raise _err(400, f"{vendor['name']} is switched off — turn the vendor back on to book stock against it")
    return vendor
