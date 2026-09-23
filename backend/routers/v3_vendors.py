"""FITSIOMAX STORE > Vendor — who the stock comes from, and which of it they supply.

One collection, `vendors`, sitting beside the three in v3_inventory.py. It is org-wide for
the same reason the item catalogue is: a vendor supplying two branches is one vendor, and
two branches spelling the same supplier differently is how a spend figure stops being a
spend figure. Stock itself stays per branch — nothing here holds a count.

Stock reaches a vendor two ways, and they answer different questions.

`stock_ids` points into `vendor_stock`, the Stock Detail book this module owns: what the
organisation buys, typed by hand, with the rate quoted for it. It is what the Vendor form
links and what the bill on a vendor is made of. Nothing in it is a branch's stock — see
StockIn for why it is not an inventory_items row.

`item_ids` points into the sales catalogue and is written by nobody: booking a delivery
against a vendor in Add Stock adds the item and its shelf on its own. That list is the
delivery ledger's account of what has actually arrived from them, which is why the form
cannot edit it and why the Shelves column on the tab means something.

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
    VALID_CATEGORIES,
    VALID_PAYMENT_MODES,
    VALID_UNITS,
    _escape_regex,
)
from schemas.v3 import V3UserOut
from utils import now_iso

router = APIRouter(prefix="/api/v3/vendors", tags=["vendors"])

# Who the Vendor tab is for: the branch that buys the stock and knows its suppliers, Super
# Admin who oversees every branch's, and Business Development beside them. All three reach
# it in the UI — Branch Admin through FITSIOMAX STORE on their own board, the other two
# through Services and Products.
#
# Spelled out here rather than reusing v3_inventory's READ_ROLES, which is the same three
# plus head_physio. A head physio reads stock counts because running the floor means
# knowing what is on the shelf; who the branch buys from, on what terms and for how much is
# a purchasing question and no screen of theirs asks it. Writing is the same three — there
# is no desk that may add a vendor but not read one.
VENDOR_ROLES = ("super_admin", "business_dev", "branch_admin")


def _err(status: int, msg: str):
    return HTTPException(status_code=status, detail=msg)


async def ensure_vendor_indexes():
    """Called from the app's startup hook; create_index is a no-op once it exists.

    The vendor_id index is what keeps the per-vendor totals below from scanning the whole
    movement ledger every time the tab is opened.
    """
    await v3_col("vendors").create_index([("name", 1)], name="vendor_name")
    await v3_col("vendor_stock").create_index([("name", 1)], name="vendor_stock_name")
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


async def _stock_map(stock_ids: List[str]) -> dict:
    """The Stock Detail rows a page of vendors links to, by id.

    Missing ones are simply absent rather than an error, unlike _stock_rows: a row deleted
    from the book leaves the vendors that pointed at it readable, and the next save of one
    drops the dead id on its own.
    """
    ids = [i for i in {*stock_ids} if i]
    if not ids:
        return {}
    rows = await v3_col("vendor_stock").find({"id": {"$in": ids}}, {"_id": 0}).to_list(1000)
    return {r["id"]: r for r in rows}


async def _item_names(item_ids: List[str]) -> dict:
    ids = [i for i in {*item_ids} if i]
    if not ids:
        return {}
    rows = await v3_col("inventory_items").find(
        {"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1, "category": 1, "unit": 1}
    ).to_list(1000)
    return {r["id"]: r for r in rows}


class StockIn(BaseModel):
    """A line of the Stock Detail book — one thing the organisation buys, typed by hand.

    Deliberately not an inventory_items row. The catalogue behind the Tablet, Supplementary
    and Equipment tabs is what a branch sells over the counter, and every row in it needs a
    shelf, a sale price and a low-stock level before it can exist. What gets bought from a
    vendor is wider than that and known earlier: a water can, a box of gloves, an AC
    service, priced before anybody has decided whether it is ever sold on. Asking a
    purchase to become a sellable catalogue row first is what made this a dropdown nobody
    could add to.

    The two are not rivals. Stock that does get sold over the counter is still added on its
    own shelf and still arrives through Add Stock, which is where a branch's count and its
    ledger come from; this book is what was ordered and at what rate.
    """
    name: str
    # The branch's own word for how it arrives — individual, loose, per box. No list,
    # because there isn't one anywhere else in the OS to agree with.
    stock_type: Optional[str] = ""
    count: int = 0
    unit: Optional[str] = ""
    unit_price: float = 0


def _clean_stock(payload: StockIn) -> dict:
    name = " ".join((payload.name or "").split())
    if not name:
        raise _err(400, "A stock name is required")
    unit = (payload.unit or "").strip()
    if unit and unit not in VALID_UNITS:
        raise _err(400, f"unit must be one of {', '.join(sorted(VALID_UNITS))}")
    count = int(payload.count or 0)
    price = float(payload.unit_price or 0)
    if count < 0 or price < 0:
        raise _err(400, "A count and a price cannot be negative")
    return {
        "name": name[:120],
        "stock_type": " ".join((payload.stock_type or "").split())[:40],
        "count": count,
        "unit": unit,
        "unit_price": round(price, 2),
        # Stored rather than worked out on the way to the screen: it is what the rate was
        # agreed at, and a figure read back months later shouldn't depend on today's code.
        "total": round(count * price, 2),
    }


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
    # What this vendor supplies, as ids into the Stock Detail book above. A vendor with
    # none is one nobody has said anything about yet — the water supplier added before the
    # water can was written down still has to be saveable.
    stock_ids: List[str] = []
    # The bill and what has gone against it. `amount` opens on the total of the linked
    # stock and can be typed over, because a bill carries delivery, discount and tax that
    # no rate on a line knows about. The balance is not stored — it is amount minus paid
    # and storing a third number is storing a disagreement.
    amount: float = 0
    paid_amount: float = 0
    payment_mode: Optional[str] = ""
    payment_date: Optional[str] = ""
    # Kept rather than deleted once there is history against them — see delete_vendor.
    active: bool = True


def _clean(payload: VendorIn) -> dict:
    name = (payload.name or "").strip()
    if not name:
        raise _err(400, "Vendor name is required")
    gst = (payload.gst_number or "").strip().upper()
    if gst and len(gst) != 15:
        raise _err(400, "A GST number is 15 characters")
    email = (payload.email or "").strip()
    if email and "@" not in email:
        raise _err(400, "That email address doesn't look right")
    mode = (payload.payment_mode or "").strip().lower()
    if mode and mode not in VALID_PAYMENT_MODES:
        raise _err(400, f"payment_mode must be one of {', '.join(sorted(VALID_PAYMENT_MODES))}")
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
        "amount": round(max(float(payload.amount or 0), 0), 2),
        "paid_amount": round(max(float(payload.paid_amount or 0), 0), 2),
        "payment_mode": mode,
        # A plain YYYY-MM-DD off a date input. Not parsed — an empty one means the payment
        # hasn't been dated, which is different from dating it today on the vendor's behalf.
        "payment_date": (payload.payment_date or "").strip()[:10],
        "active": bool(payload.active),
    }


async def _stock_rows(ids: List[str]) -> List[dict]:
    """The Stock Detail rows behind a list of ids, in the order they were picked."""
    wanted = list(dict.fromkeys([(i or "").strip() for i in ids if (i or "").strip()]))
    if not wanted:
        return []
    found = await v3_col("vendor_stock").find({"id": {"$in": wanted}}, {"_id": 0}).to_list(500)
    by_id = {r["id"]: r for r in found}
    missing = [i for i in wanted if i not in by_id]
    if missing:
        raise _err(400, "One of the picked stock rows no longer exists")
    return [by_id[i] for i in wanted]


def _decorate(doc: dict, stats: dict, items: dict, stock: dict = None) -> dict:
    supplied = [items[i] for i in doc.get("item_ids", []) if i in items]
    linked = [(stock or {})[i] for i in doc.get("stock_ids", []) if i in (stock or {})]
    s = stats.get(doc["id"], {})
    amount = float(doc.get("amount") or 0)
    paid = float(doc.get("paid_amount") or 0)
    return {
        # Vendors added before any of this existed carry none of it; the tab reads an
        # absent list and an empty one the same way, so none of it is worth a migration.
        "amount": 0,
        "paid_amount": 0,
        "payment_mode": "",
        "payment_date": "",
        "stock_ids": [],
        **doc,
        "stock": linked,
        "stock_count": len(linked),
        # Worked out here rather than stored — see the note on VendorIn.
        "balance": round(amount - paid, 2),
        "items": [{"id": i["id"], "name": i["name"], "category": i.get("category", ""), "unit": i.get("unit", "")} for i in supplied],
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
    user: V3UserOut = Depends(v3_require_roles(*VENDOR_ROLES)),
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
    stock = await _stock_map([i for d in docs for i in d.get("stock_ids", [])])
    return [_decorate(d, stats, items, stock) for d in docs]


@router.get("/stock")
async def list_vendor_stock(
    search: Optional[str] = None,
    _: V3UserOut = Depends(v3_require_roles(*VENDOR_ROLES)),
):
    """The Stock Detail book, org-wide, each row carrying who supplies it.

    The vendors come back with the stock rather than being looked up per row, because the
    tab leads with this list: a stock name whose row cannot say whether anyone supplies it
    is a name with the one useful thing about it missing.
    """
    q = {}
    if search and search.strip():
        q["name"] = {"$regex": _escape_regex(search.strip()), "$options": "i"}
    rows = await v3_col("vendor_stock").find(q, {"_id": 0}).sort("name", 1).to_list(500)
    used = await v3_col("vendors").aggregate([
        {"$unwind": "$stock_ids"},
        {"$sort": {"name": 1}},
        {"$group": {
            "_id": "$stock_ids",
            "vendors": {"$push": {"id": "$id", "name": "$name", "active": "$active"}},
        }},
    ]).to_list(1000)
    by_stock = {r["_id"]: r["vendors"] for r in used}
    return [
        {**r, "vendors": by_stock.get(r["id"], []), "vendor_count": len(by_stock.get(r["id"], []))}
        for r in rows
    ]


@router.post("/stock")
async def create_vendor_stock(payload: List[StockIn], user: V3UserOut = Depends(v3_require_roles(*VENDOR_ROLES))):
    """Several at once, because the form adds them a row at a time before saving."""
    if not payload:
        raise _err(400, "Nothing to add")
    docs = []
    for one in payload:
        doc = _clean_stock(one)
        clash = await v3_col("vendor_stock").find_one(
            {"name": {"$regex": f"^{_escape_regex(doc['name'])}$", "$options": "i"}}, {"_id": 0, "id": 1}
        )
        if clash:
            raise _err(409, f"{doc['name']} is already in the stock list")
        doc.update({
            "id": str(uuid.uuid4()),
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "created_by": user.id,
            "created_by_name": user.full_name,
        })
        docs.append(doc)
    # Two rows of the same name in one save would each pass the check above and both land.
    names = [d["name"].lower() for d in docs]
    dupe = next((n for n in names if names.count(n) > 1), None)
    if dupe:
        raise _err(400, "The same stock name is on two rows")
    await v3_col("vendor_stock").insert_many([d.copy() for d in docs])
    return {"message": f"{len(docs)} stock row{'' if len(docs) == 1 else 's'} added", "stock": docs}


@router.put("/stock/{stock_id}")
async def update_vendor_stock(stock_id: str, payload: StockIn, _: V3UserOut = Depends(v3_require_roles(*VENDOR_ROLES))):
    existing = await v3_col("vendor_stock").find_one({"id": stock_id}, {"_id": 0, "id": 1})
    if not existing:
        raise _err(404, "That stock row no longer exists")
    doc = _clean_stock(payload)
    clash = await v3_col("vendor_stock").find_one(
        {"id": {"$ne": stock_id}, "name": {"$regex": f"^{_escape_regex(doc['name'])}$", "$options": "i"}},
        {"_id": 0, "id": 1},
    )
    if clash:
        raise _err(409, f"{doc['name']} is already in the stock list")
    doc["updated_at"] = now_iso()
    await v3_col("vendor_stock").update_one({"id": stock_id}, {"$set": doc})
    return {"message": "Stock updated"}


@router.delete("/stock/{stock_id}")
async def delete_vendor_stock(stock_id: str, _: V3UserOut = Depends(v3_require_roles(*VENDOR_ROLES))):
    """Removed along with every vendor's link to it.

    Unlike a vendor, nothing in the ledger points here — a delivery records the branch's
    own catalogue item, not this book — so there is nothing left dangling by deleting one.
    """
    stock = await v3_col("vendor_stock").find_one({"id": stock_id}, {"_id": 0, "name": 1})
    if not stock:
        raise _err(404, "That stock row no longer exists")
    await v3_col("vendors").update_many({"stock_ids": stock_id}, {"$pull": {"stock_ids": stock_id}})
    await v3_col("vendor_stock").delete_one({"id": stock_id})
    return {"message": f"{stock['name']} removed from the stock list"}


@router.get("/summary")
async def vendor_summary(
    branch_id: Optional[str] = None,
    user: V3UserOut = Depends(v3_require_roles(*VENDOR_ROLES)),
):
    """The four figures above the table."""
    docs = await v3_col("vendors").find(
        {}, {"_id": 0, "id": 1, "active": 1, "stock_ids": 1, "amount": 1, "paid_amount": 1}
    ).to_list(500)
    stats = await _delivery_stats([d["id"] for d in docs], _stats_branch(user, branch_id))
    return {
        "vendors": len(docs),
        "active": len([d for d in docs if d.get("active", True)]),
        "linked_items": len({i for d in docs for i in d.get("stock_ids", [])}),
        # What is still owed across every vendor. Floored at nought per vendor rather than
        # in total, so one overpaid bill cannot quietly cancel out another's arrears.
        "outstanding": round(sum(
            max(float(d.get("amount") or 0) - float(d.get("paid_amount") or 0), 0) for d in docs
        ), 2),
        "deliveries": sum(s.get("deliveries", 0) for s in stats.values()),
        "spend": round(sum(s.get("spend", 0) for s in stats.values()), 2),
    }


@router.get("/{vendor_id}/deliveries")
async def vendor_deliveries(
    vendor_id: str,
    branch_id: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    user: V3UserOut = Depends(v3_require_roles(*VENDOR_ROLES)),
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
async def create_vendor(payload: VendorIn, user: V3UserOut = Depends(v3_require_roles(*VENDOR_ROLES))):
    doc = _clean(payload)
    clash = await v3_col("vendors").find_one(
        {"name": {"$regex": f"^{_escape_regex(doc['name'])}$", "$options": "i"}}, {"_id": 0, "id": 1}
    )
    if clash:
        raise _err(409, f"{doc['name']} is already a vendor")
    linked = await _stock_rows(payload.stock_ids)
    doc["stock_ids"] = [r["id"] for r in linked]
    # Only ever set here. From now on these two are the delivery ledger's account of what
    # has actually arrived from this vendor, written by link_vendor_to_item and by nothing
    # on the form — a vendor's shelves are where their stock landed, not where they said
    # it would.
    doc["item_ids"] = []
    doc["categories"] = []

    doc.update({
        "id": str(uuid.uuid4()),
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "created_by": user.id,
        "created_by_name": user.full_name,
    })
    await v3_col("vendors").insert_one(doc.copy())
    return _decorate(doc, {}, {}, {r["id"]: r for r in linked})


@router.put("/{vendor_id}")
async def update_vendor(vendor_id: str, payload: VendorIn, branch_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_roles(*VENDOR_ROLES))):
    await _require_vendor(vendor_id)
    doc = _clean(payload)
    clash = await v3_col("vendors").find_one(
        {"id": {"$ne": vendor_id}, "name": {"$regex": f"^{_escape_regex(doc['name'])}$", "$options": "i"}},
        {"_id": 0, "id": 1},
    )
    if clash:
        raise _err(409, f"{doc['name']} is already a vendor")
    linked = await _stock_rows(payload.stock_ids)
    doc["stock_ids"] = [r["id"] for r in linked]

    doc["updated_at"] = now_iso()
    await v3_col("vendors").update_one({"id": vendor_id}, {"$set": doc})
    fresh = await v3_col("vendors").find_one({"id": vendor_id}, {"_id": 0})
    stats = await _delivery_stats([vendor_id], _stats_branch(user, branch_id))
    items = await _item_names(fresh.get("item_ids", []))
    return _decorate(fresh, stats, items, await _stock_map(fresh.get("stock_ids", [])))


@router.delete("/{vendor_id}")
async def delete_vendor(vendor_id: str, _: V3UserOut = Depends(v3_require_roles(*VENDOR_ROLES))):
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
