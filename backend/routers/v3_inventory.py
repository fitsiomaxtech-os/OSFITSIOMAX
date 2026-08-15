"""FITSIOMAX STORE > Tablet — what a branch holds, what it sells over the counter, and
what it sends to another branch.

Three collections, because the three questions asked of stock are different questions:

  inventory_items      the catalogue — a tablet's name, unit and price. Org-wide: one
                       branch inventing its own spelling of the same tablet is how two
                       branches stop being able to transfer it to each other.
  inventory_stock      one row per (item, branch) holding a count. The count is the
                       answer to "can I sell this right now", and it is read on every
                       screen, so it is stored rather than summed out of the ledger.
  inventory_movements  every add, sale and transfer, append-only. The count says where
                       stock is; this says how it got there, and it is the only thing
                       that can answer a disagreement about either.

`category` is carried on items and movements so Supplementary and Equipment — the tabs
either side of Tablet, same shape of problem — reuse this rather than growing a second
copy of it.
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from database import v3_col
from deps import v3_require_roles, is_branch_admin_role
from schemas.v3 import V3UserOut
from utils import generate_transaction_id, now_iso

router = APIRouter(prefix="/api/v3/inventory", tags=["inventory"])

# The Store tabs this serves. Tablet is the one built out; the other two are accepted so
# their panels can be switched on without a migration.
VALID_CATEGORIES = {"tablet", "supplementary", "equipment"}

# What a unit of stock is. A "strip of 10" sold as one thing is one unit — the OS counts
# packages the branch hands over, not the tablets inside them. Set and Pair are here for
# Equipment, which is bought as a pair of dumbbells or a set of bands rather than singly.
# The panel offers each category a subset of these; anything added there must be added
# here too, or the save is refused.
VALID_UNITS = {"Strip", "Bottle", "Tube", "Sachet", "Pack", "Piece", "Box", "Set", "Pair"}

VALID_PAYMENT_MODES = {"cash", "upi", "card", "account_transfer"}

# Anyone who can be standing at the counter when a patient asks for a tablet.
WRITE_ROLES = ("super_admin", "branch_admin")
READ_ROLES = ("super_admin", "branch_admin", "head_physio")


def _err(status: int, msg: str):
    return HTTPException(status_code=status, detail=msg)


def _escape_regex(s: str) -> str:
    """A typed name is a search term, not a pattern — a stray '(' in one shouldn't 500."""
    return "".join("\\" + c if c in ".^$*+?()[]{}|\\" else c for c in s)


async def _scope_branch(user: V3UserOut, branch_id: Optional[str]) -> str:
    """Which branch this call is about.

    A Branch Admin is pinned to their own branch whatever they send — the branch id is a
    query parameter, and stock is the kind of thing worth being strict about. Super Admin
    has no branch of their own, so they name one.
    """
    if is_branch_admin_role(user.role):
        if not user.branch_id:
            raise _err(400, "Your login is not attached to a branch")
        if branch_id and branch_id != user.branch_id:
            raise _err(403, "You can only manage your own branch's stock")
        return user.branch_id
    resolved = branch_id or user.branch_id
    if not resolved:
        raise _err(400, "branch_id is required")
    return resolved


async def _branch_names(branch_ids: List[str]) -> dict:
    ids = [b for b in {*branch_ids} if b]
    if not ids:
        return {}
    rows = await v3_col("branches").find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "branch_name": 1, "name": 1}).to_list(500)
    return {r["id"]: r.get("branch_name") or r.get("name") or "" for r in rows}


async def _stock_of(item_id: str, branch_id: str) -> int:
    row = await v3_col("inventory_stock").find_one({"item_id": item_id, "branch_id": branch_id}, {"_id": 0, "qty": 1})
    return int((row or {}).get("qty") or 0)


async def _require_item(item_id: str) -> dict:
    item = await v3_col("inventory_items").find_one({"id": item_id}, {"_id": 0})
    if not item:
        raise _err(404, "Item not found")
    return item


async def _log_movement(**fields) -> dict:
    doc = {"id": str(uuid.uuid4()), "created_at": now_iso(), **fields}
    await v3_col("inventory_movements").insert_one(doc.copy())
    return doc


async def ensure_inventory_indexes():
    """One stock row per item per branch, enforced by the database rather than by hope.

    Two deliveries booked into the same tablet at the same moment both upsert, and without
    this both insert: the branch's count silently splits across two rows and every screen
    reads whichever one it finds first. With it the loser gets a duplicate key and is
    retried into the winner's row.

    Called from the app's startup hook. create_index is idempotent — an index that already
    exists with the same spec is a no-op, so this costs nothing on later boots.
    """
    await v3_col("inventory_stock").create_index(
        [("item_id", 1), ("branch_id", 1)], unique=True, name="uniq_item_branch"
    )
    await v3_col("inventory_movements").create_index(
        [("branch_id", 1), ("category", 1), ("created_at", -1)], name="branch_category_recent"
    )


async def _add_to_stock(item_id: str, branch_id: str, qty: int) -> int:
    """Raise a branch's count, creating the row the first time that branch holds the item."""
    query = {"item_id": item_id, "branch_id": branch_id}
    update = {"$inc": {"qty": qty}, "$set": {"updated_at": now_iso()}}
    try:
        row = await v3_col("inventory_stock").find_one_and_update(
            query,
            {**update, "$setOnInsert": {"id": str(uuid.uuid4())}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        # Lost the race to create the row; the winner's row exists now, so add into it.
        row = await v3_col("inventory_stock").find_one_and_update(
            query, update, return_document=ReturnDocument.AFTER
        )
    return int((row or {}).get("qty") or 0)


async def _take_from_stock(item_id: str, branch_id: str, qty: int, item_name: str) -> int:
    """Lower a branch's count, or refuse.

    The `qty >= n` is part of the filter rather than a read followed by a write: two
    people selling the last strip at the same moment both pass a check-then-write and the
    count goes negative. Here the second one matches nothing and is told why.
    """
    row = await v3_col("inventory_stock").find_one_and_update(
        {"item_id": item_id, "branch_id": branch_id, "qty": {"$gte": qty}},
        {"$inc": {"qty": -qty}, "$set": {"updated_at": now_iso()}},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        held = await _stock_of(item_id, branch_id)
        raise _err(400, f"Only {held} in stock for {item_name}")
    return int(row.get("qty") or 0)


# ------------------------------------------------------------------ catalogue


class ItemIn(BaseModel):
    category: str = "tablet"
    name: str
    brand: Optional[str] = ""
    unit: str = "Strip"
    sale_price: float = 0
    cost_price: float = 0
    # The count at or below which the row is flagged. Per item, because ten strips of a
    # painkiller is a full shelf and ten of something a single patient is on is a week.
    low_stock_at: int = 10
    notes: Optional[str] = ""


def _validate_item(payload: ItemIn):
    if not payload.name.strip():
        raise _err(400, "Name is required")
    if payload.category not in VALID_CATEGORIES:
        raise _err(400, f"category must be one of {', '.join(sorted(VALID_CATEGORIES))}")
    if payload.unit not in VALID_UNITS:
        raise _err(400, f"unit must be one of {', '.join(sorted(VALID_UNITS))}")
    if payload.sale_price < 0 or payload.cost_price < 0:
        raise _err(400, "Price cannot be negative")
    if payload.low_stock_at < 0:
        raise _err(400, "Low stock alert cannot be negative")


@router.post("/items")
async def create_item(payload: ItemIn, user: V3UserOut = Depends(v3_require_roles(*WRITE_ROLES))):
    _validate_item(payload)
    name = payload.name.strip()
    clash = await v3_col("inventory_items").find_one(
        {"category": payload.category, "name": {"$regex": f"^{_escape_regex(name)}$", "$options": "i"}},
        {"_id": 0, "id": 1},
    )
    if clash:
        raise _err(409, f"{name} is already in the catalogue")

    doc = payload.model_dump()
    doc.update({
        "id": str(uuid.uuid4()),
        "name": name,
        "brand": (payload.brand or "").strip(),
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "created_by": user.id,
        "created_by_name": user.full_name,
    })
    await v3_col("inventory_items").insert_one(doc.copy())
    return {**doc, "stock": 0, "low": True}


@router.put("/items/{item_id}")
async def update_item(item_id: str, payload: ItemIn, branch_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_roles(*WRITE_ROLES))):
    _validate_item(payload)
    await _require_item(item_id)
    branch = await _scope_branch(user, branch_id)

    update = payload.model_dump()
    update["name"] = payload.name.strip()
    update["brand"] = (payload.brand or "").strip()
    update["updated_at"] = now_iso()
    await v3_col("inventory_items").update_one({"id": item_id}, {"$set": update})

    doc = await v3_col("inventory_items").find_one({"id": item_id}, {"_id": 0})
    stock = await _stock_of(item_id, branch)
    return {**doc, "stock": stock, "low": stock <= int(doc.get("low_stock_at") or 0)}


@router.delete("/items/{item_id}")
async def delete_item(item_id: str, _: V3UserOut = Depends(v3_require_roles(*WRITE_ROLES))):
    """Removed from the catalogue only while no branch is holding any.

    Deleting an item some branch still has on a shelf would leave that stock uncountable
    and its history pointing at nothing. The branches holding it are named, so whoever is
    tidying up knows where to send the transfer.
    """
    await _require_item(item_id)
    held = await v3_col("inventory_stock").find({"item_id": item_id, "qty": {"$gt": 0}}, {"_id": 0, "branch_id": 1, "qty": 1}).to_list(100)
    if held:
        names = await _branch_names([h["branch_id"] for h in held])
        where = ", ".join(f"{names.get(h['branch_id'], 'a branch')} ({h['qty']})" for h in held)
        raise _err(400, f"Still in stock at {where} — move or sell it first")

    await v3_col("inventory_items").delete_one({"id": item_id})
    await v3_col("inventory_stock").delete_many({"item_id": item_id})
    return {"message": "Item deleted"}


@router.get("/items")
async def list_items(
    category: str = "tablet",
    branch_id: Optional[str] = None,
    search: Optional[str] = None,
    user: V3UserOut = Depends(v3_require_roles(*READ_ROLES)),
):
    """The catalogue with this branch's count against each row."""
    branch = await _scope_branch(user, branch_id)
    q = {"category": category}
    if search and search.strip():
        rx = {"$regex": _escape_regex(search.strip()), "$options": "i"}
        q["$or"] = [{"name": rx}, {"brand": rx}]

    items = await v3_col("inventory_items").find(q, {"_id": 0}).sort("name", 1).to_list(500)
    ids = [i["id"] for i in items]
    stock_rows = await v3_col("inventory_stock").find(
        {"item_id": {"$in": ids}, "branch_id": branch}, {"_id": 0, "item_id": 1, "qty": 1}
    ).to_list(1000)
    stock_map = {r["item_id"]: int(r.get("qty") or 0) for r in stock_rows}

    out = []
    for it in items:
        qty = stock_map.get(it["id"], 0)
        out.append({**it, "stock": qty, "low": qty <= int(it.get("low_stock_at") or 0)})
    return out


# ------------------------------------------------------------------ the three actions


class AddStockIn(BaseModel):
    qty: int
    cost_price: Optional[float] = None
    supplier: Optional[str] = ""
    note: Optional[str] = ""


@router.post("/items/{item_id}/add-stock")
async def add_stock(item_id: str, payload: AddStockIn, branch_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_roles(*WRITE_ROLES))):
    """Stock arriving at a branch — a delivery booked in."""
    if payload.qty <= 0:
        raise _err(400, "Quantity must be at least 1")
    item = await _require_item(item_id)
    branch = await _scope_branch(user, branch_id)

    qty_after = await _add_to_stock(item_id, branch, payload.qty)

    # A delivery at a new price is the price from now on; the old one was what the last
    # delivery cost, and nothing downstream wants a stale one.
    if payload.cost_price is not None and payload.cost_price >= 0:
        await v3_col("inventory_items").update_one(
            {"id": item_id}, {"$set": {"cost_price": payload.cost_price, "updated_at": now_iso()}}
        )

    await _log_movement(
        kind="add",
        category=item.get("category", "tablet"),
        item_id=item_id,
        item_name=item["name"],
        branch_id=branch,
        qty=payload.qty,
        qty_after=qty_after,
        unit_price=payload.cost_price if payload.cost_price is not None else item.get("cost_price", 0),
        amount=(payload.cost_price if payload.cost_price is not None else item.get("cost_price", 0) or 0) * payload.qty,
        supplier=(payload.supplier or "").strip(),
        note=(payload.note or "").strip(),
        by_user_id=user.id,
        by_user_name=user.full_name,
    )
    return {"stock": qty_after, "message": f"Added {payload.qty} to {item['name']}"}


class SellIn(BaseModel):
    qty: int
    unit_price: Optional[float] = None
    customer_name: Optional[str] = ""
    payment_mode: str = "cash"
    note: Optional[str] = ""


@router.post("/items/{item_id}/sell")
async def sell_item(item_id: str, payload: SellIn, branch_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_roles(*WRITE_ROLES))):
    """A counter sale: stock leaves the branch and money comes in."""
    if payload.qty <= 0:
        raise _err(400, "Quantity must be at least 1")
    if payload.payment_mode not in VALID_PAYMENT_MODES:
        raise _err(400, f"payment_mode must be one of {', '.join(sorted(VALID_PAYMENT_MODES))}")
    item = await _require_item(item_id)
    branch = await _scope_branch(user, branch_id)

    unit_price = payload.unit_price if payload.unit_price is not None else float(item.get("sale_price") or 0)
    if unit_price < 0:
        raise _err(400, "Price cannot be negative")

    qty_after = await _take_from_stock(item_id, branch, payload.qty, item["name"])
    # Only now that the stock is committed — an id handed out for a sale that was then
    # refused for want of stock is an id in the sequence pointing at nothing.
    txn_id = await generate_transaction_id(branch)

    movement = await _log_movement(
        kind="sale",
        category=item.get("category", "tablet"),
        item_id=item_id,
        item_name=item["name"],
        branch_id=branch,
        qty=payload.qty,
        qty_after=qty_after,
        unit_price=unit_price,
        amount=unit_price * payload.qty,
        customer_name=(payload.customer_name or "").strip(),
        payment_mode=payload.payment_mode,
        transaction_id=txn_id,
        note=(payload.note or "").strip(),
        by_user_id=user.id,
        by_user_name=user.full_name,
    )
    return {
        "stock": qty_after,
        "transaction_id": txn_id,
        "amount": movement["amount"],
        "message": f"Sold {payload.qty} × {item['name']}",
    }


class TransferIn(BaseModel):
    qty: int
    to_branch_id: str
    note: Optional[str] = ""


@router.post("/items/{item_id}/transfer")
async def transfer_item(item_id: str, payload: TransferIn, branch_id: Optional[str] = None, user: V3UserOut = Depends(v3_require_roles(*WRITE_ROLES))):
    """Stock moving from this branch to another.

    Two movements, not one: the branch sending and the branch receiving each need this in
    their own ledger, and a single row would show up as a mystery in whichever branch was
    not named on it.
    """
    if payload.qty <= 0:
        raise _err(400, "Quantity must be at least 1")
    item = await _require_item(item_id)
    branch = await _scope_branch(user, branch_id)
    if not payload.to_branch_id:
        raise _err(400, "Pick a branch to move it to")
    if payload.to_branch_id == branch:
        raise _err(400, "That is the branch it is already at")

    dest = await v3_col("branches").find_one({"id": payload.to_branch_id}, {"_id": 0, "id": 1, "branch_name": 1, "name": 1})
    if not dest:
        raise _err(404, "Destination branch not found")
    dest_name = dest.get("branch_name") or dest.get("name") or "the other branch"
    names = await _branch_names([branch])
    from_name = names.get(branch, "")

    qty_after = await _take_from_stock(item_id, branch, payload.qty, item["name"])
    try:
        dest_after = await _add_to_stock(item_id, payload.to_branch_id, payload.qty)
    except Exception:
        # Put it back rather than leave it in neither branch. The two writes cannot be one
        # atomic step without a replica-set transaction, so the failure is undone by hand.
        await _add_to_stock(item_id, branch, payload.qty)
        raise _err(500, "Could not move the stock — nothing was changed")

    common = {
        "category": item.get("category", "tablet"),
        "item_id": item_id,
        "item_name": item["name"],
        "qty": payload.qty,
        "from_branch_id": branch,
        "from_branch_name": from_name,
        "to_branch_id": payload.to_branch_id,
        "to_branch_name": dest_name,
        "note": (payload.note or "").strip(),
        "by_user_id": user.id,
        "by_user_name": user.full_name,
    }
    await _log_movement(kind="transfer_out", branch_id=branch, qty_after=qty_after, **common)
    await _log_movement(kind="transfer_in", branch_id=payload.to_branch_id, qty_after=dest_after, **common)

    return {"stock": qty_after, "message": f"Moved {payload.qty} × {item['name']} to {dest_name}"}


# ------------------------------------------------------------------ ledger and totals


@router.get("/movements")
async def list_movements(
    category: str = "tablet",
    kind: Optional[str] = None,
    item_id: Optional[str] = None,
    branch_id: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    user: V3UserOut = Depends(v3_require_roles(*READ_ROLES)),
):
    branch = await _scope_branch(user, branch_id)
    q = {"category": category, "branch_id": branch}
    if kind:
        q["kind"] = kind
    if item_id:
        q["item_id"] = item_id
    rows = await v3_col("inventory_movements").find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return {"movements": rows}


@router.get("/summary")
async def inventory_summary(
    category: str = "tablet",
    branch_id: Optional[str] = None,
    user: V3UserOut = Depends(v3_require_roles(*READ_ROLES)),
):
    """The four figures above the table: what is held, what is nearly out, what sold today."""
    branch = await _scope_branch(user, branch_id)
    items = await v3_col("inventory_items").find({"category": category}, {"_id": 0, "id": 1, "low_stock_at": 1, "sale_price": 1}).to_list(500)
    ids = [i["id"] for i in items]
    stock_rows = await v3_col("inventory_stock").find(
        {"item_id": {"$in": ids}, "branch_id": branch}, {"_id": 0, "item_id": 1, "qty": 1}
    ).to_list(1000)
    stock_map = {r["item_id"]: int(r.get("qty") or 0) for r in stock_rows}

    units = sum(stock_map.values())
    stock_value = sum(stock_map.get(i["id"], 0) * float(i.get("sale_price") or 0) for i in items)
    low = [i for i in items if stock_map.get(i["id"], 0) <= int(i.get("low_stock_at") or 0)]
    out_of = [i for i in items if stock_map.get(i["id"], 0) <= 0]

    # Day boundary in UTC, matching how every other created_at in the OS is stamped and
    # compared. A branch closing after midnight UTC would see the sale land on the next
    # day, which is the same rounding every other board here already makes.
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    sales_today = await v3_col("inventory_movements").find(
        {"category": category, "branch_id": branch, "kind": "sale", "created_at": {"$gte": day_start}},
        {"_id": 0, "qty": 1, "amount": 1},
    ).to_list(1000)

    return {
        "items": len(items),
        "units": units,
        "stock_value": round(stock_value, 2),
        "low_stock": len(low),
        "out_of_stock": len(out_of),
        "sold_today_qty": sum(int(s.get("qty") or 0) for s in sales_today),
        "sold_today_amount": round(sum(float(s.get("amount") or 0) for s in sales_today), 2),
    }
