"""Where one lead off a sheet actually went, when the ERP does not show it.

Reads only. Writes nothing back to the database:

    cd backend && python tools/missing_lead_check.py "p:+919842622622"
    cd backend && python tools/missing_lead_check.py 9842622622 "Rajesh Soni"

Takes the phone exactly as the sheet holds it -- Meta's export writes "p:+91..." and the
"p:" is stripped the same way the importer strips it. A name fragment can be given as a
second argument, which is what finds the patient when the number in the sheet is not the
number on the record.

"Missing" is two different questions and this answers them in order.

FIRST: is the lead in the database at all? A lead imports with a branch only where its
source is tagged to exactly ONE branch -- see source_branch_id in _internal_pull_source.
A source tagged to several (one tab per branch, all in one spreadsheet) routes nothing:
every row lands in Pre-Sales with branch_id None, which is a lead nobody's Branch Leads
board will ever draw. It is in the ERP and invisible where somebody is looking for it,
which reads exactly like a lost lead. So the first half prints every place a found lead
would show, and says plainly where it will not.

SECOND: if it really is not there, which of the importer's silences swallowed it. Each
of these is a row skipped or never read, and none of them raises anything a person sees:

  DUPLICATE     another lead already holds these last ten digits. The dedupe is global --
                every branch, every source, all time -- and skips silently. A family
                sharing one number is one lead, and the second enquiry is dropped.
  NO PHONE      normalize_phone got nothing usable out of the mapped column.
  TAB NOT PULLED  a new Meta form writes a new tab. A tab that is not in the source's
                sheet_names is never read, so a whole form's leads go missing at once.
  RANGE CAP     the pull asks for A1:Z10000. Past 9999 data rows, new rows are never
                fetched; past column Z, the columns after it -- which on a Meta export
                is where full_name and phone_number sit -- are not fetched either.
  NOT CONNECTED  no Google refresh token: every auto-sync cycle fails and swallows it
                (`except Exception: pass` in _auto_sync_loop).
  NOT SYNCING   the source is inactive, auto-sync is off, or nothing has pulled since
                the row landed in the sheet.

What it cannot see: the sheet. Where this points at the sheet -- a missing tab, the
range caps -- the last step is to open the spreadsheet and count.
"""
import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import v3_col  # noqa: E402
from routers.v3_marketing import normalize_phone, normalize_source  # noqa: E402
from routers.v3_google_sheets import TOKEN_DOC_ID  # noqa: E402

# What the pull asks Sheets for, spelled here so the caps can be checked against what a
# source actually received. Keep in step with _internal_pull_source's default range_.
RANGE_ROWS = 10000
RANGE_LAST_COLUMN = "Z"
RANGE_COLUMNS = 26


def dash(value, empty="—"):
    return empty if value in (None, "", []) else value


async def branch_name(branch_id):
    if not branch_id:
        return None
    doc = await v3_col("branches").find_one({"id": branch_id}, {"_id": 0, "branch_name": 1})
    return (doc or {}).get("branch_name") or branch_id


async def show_lead(lead):
    print("  " + str(dash(lead.get("patient_number"), "(no patient number)"))
          + "  " + str(dash(lead.get("name"))))
    print("      id           : " + str(lead.get("id")))
    print("      phone        : " + str(dash(lead.get("phone")))
          + "   (normalized " + str(dash(lead.get("phone_normalized"))) + ")")
    print("      created      : " + str(dash(lead.get("created_at"))))
    print("      source       : " + str(dash(lead.get("source_tab")))
          + "  [" + str(dash(lead.get("source_type"))) + "]")
    print("      assigned to  : " + str(dash(lead.get("assigned_user_name"))))
    branch_id = lead.get("branch_id")
    print("      branch       : " + str(dash(await branch_name(branch_id), "NONE")))
    print("      stages       : pre-sales " + str(dash(lead.get("stage")))
          + " | branch " + str(dash(lead.get("branch_stage")))
          + " | consultation " + str(dash(lead.get("consultation_stage"))))
    print()
    if branch_id:
        print("      Visible on that branch's Branch Leads board, at the stage above.")
    else:
        # The whole point of the first half. A lead with no branch is not lost and not
        # broken; it is filed one desk away from where somebody is looking for it.
        print("      *** No branch, so NO Branch Leads board will show this lead. It is on")
        print("          Pre-Sales only. A sheet source assigns a branch only when it is")
        print("          tagged to exactly one; tagged to several (a tab per branch), it")
        print("          routes none of its rows. Check the source's branch tags, and")
        print("          assign this patient a branch from Pre-Sales in the meantime.")


async def main(phone_arg: str = "", name_arg: str = ""):
    if not phone_arg and not name_arg:
        print(__doc__)
        return

    key = normalize_phone(phone_arg)
    digits = re.sub(r"\D", "", phone_arg or "")
    print("=" * 78)
    print("Looking for: " + str(dash(phone_arg)) + "   " + str(dash(name_arg, "")))
    if phone_arg:
        print("  digits in the sheet : " + str(dash(digits)))
        print("  dedupe key (last 10): " + str(dash(key)))
        if len(digits) and len(key) < 10:
            print("  *** Under ten digits. normalize_phone keeps what it is given, so this")
            print("      row imports -- but against a key that collides with anything else")
            print("      ending the same way.")
    print()

    # ---- 1. is it in the database at all --------------------------------------------
    found = []
    if key:
        found = await v3_col("leads").find({"phone_normalized": key}, {"_id": 0}).to_list(50)
        if not found and digits:
            # A lead created before phone_normalized existed, or by a path that never set
            # it, still holds the number in `phone` -- and is still the patient being
            # looked for, even though the importer's own dedupe would not have seen it.
            loose = re.escape(digits[-10:]) if len(digits) >= 10 else re.escape(digits)
            found = await v3_col("leads").find(
                {"phone": {"$regex": loose}}, {"_id": 0},
            ).to_list(50)
            if found:
                print("*** Found by phone text, NOT by phone_normalized. The importer dedupes")
                print("    on phone_normalized alone, so this record would not have blocked")
                print("    the import -- and does not carry the key the boards search by.")
                print()

    by_name = []
    if name_arg:
        by_name = await v3_col("leads").find(
            {"name": {"$regex": re.escape(name_arg), "$options": "i"}}, {"_id": 0},
        ).to_list(50)

    seen = {lead["id"] for lead in found}
    also = [lead for lead in by_name if lead["id"] not in seen]

    if found or also:
        print("IN THE DATABASE — " + str(len(found) + len(also)) + " matching lead(s):")
        print()
        for lead in found:
            await show_lead(lead)
            print()
        for lead in also:
            print("  (matched on name only — a different number to the one asked for)")
            await show_lead(lead)
            print()
        if found:
            print("Note: because this number is already on a lead, EVERY later sheet row")
            print("carrying it is skipped as a duplicate, whoever the patient is.")
        return

    print("NOT IN THE DATABASE. Nothing holds that number.")
    print()

    # ---- 2. which silence swallowed it -----------------------------------------------
    token = await v3_col("google_sheets_tokens").find_one({"id": TOKEN_DOC_ID}, {"_id": 0, "refresh_token": 1})
    if not token or not token.get("refresh_token"):
        print("*** NOT CONNECTED to Google. No refresh token is stored, so every pull -- the")
        print("    hourly auto-sync included -- returns not_connected and imports nothing.")
        print("    Reconnect from Marketing → Google Sheets, then pull.")
        print()

    sources = await v3_col("marketing_sources").find({"source_type": "google_sheets"}, {"_id": 0}).to_list(500)
    if not sources:
        print("No Google Sheets sources are configured, so nothing imports from a sheet at all.")
        return

    print("SHEET SOURCES (" + str(len(sources)) + ") — the row has to come through one of these:")
    for source in sources:
        source = normalize_source(source)
        tabs = source.get("sheet_names") or []
        branch_ids = source.get("branch_ids") or []
        mapping = dict(source.get("column_mapping") or {})
        headers = list(source.get("headers_detected") or [])
        received = source.get("last_sync_rows_received")

        print()
        print("=" * 78)
        print(source.get("name") or source.get("id"))
        print("  active      : " + str(source.get("is_active"))
              + "   archived: " + str(source.get("is_archived")))
        print("  auto-sync   : " + str(source.get("auto_sync_enabled"))
              + "   every " + str(dash(source.get("auto_sync_interval_minutes"))) + " min")
        print("  last synced : " + str(dash(source.get("last_synced"), "never")))
        print("  last pull   : " + str(dash(source.get("last_sync_imported"))) + " imported, "
              + str(dash(source.get("last_sync_skipped_duplicate"))) + " duplicate, "
              + str(dash(source.get("last_sync_skipped_no_phone"))) + " no-phone, of "
              + str(dash(received)) + " rows read")
        print("  tabs pulled : " + (", ".join(tabs) if tabs else "—"))
        print("  branches    : " + (", ".join([await branch_name(b) or b for b in branch_ids]) if branch_ids else "—"))
        print("  phone column: " + str(dash(mapping.get("phone"), "not mapped — detected from the values")))
        print("  name column : " + str(dash(mapping.get("name"), "not mapped — leads land as Unknown")))
        print("  headers seen: " + str(len(headers)) + " columns"
              + ("  (" + ", ".join(headers[:6]) + (", …" if len(headers) > 6 else "") + ")" if headers else ""))

        # Each of these is a silence, so each is worth saying out loud even where another
        # one on the same source is the likelier answer.
        if not source.get("is_active"):
            print("  *** INACTIVE. The auto-sync loop skips it entirely.")
        if not source.get("auto_sync_enabled"):
            print("  *** AUTO-SYNC OFF. It imports only when somebody presses Pull.")
        if not source.get("last_synced"):
            print("  *** NEVER SYNCED.")
        if len(branch_ids) != 1:
            print("  *** " + ("No branch tag" if not branch_ids else str(len(branch_ids)) + " branches tagged")
                  + ", so rows from this source import with NO branch and appear on")
            print("      Pre-Sales only -- never on a Branch Leads board.")
        if isinstance(received, int) and received >= RANGE_ROWS - 1:
            print("  *** ROW CAP. The last pull read " + str(received) + " rows against a range of"
                  + " A1:" + RANGE_LAST_COLUMN + str(RANGE_ROWS) + ".")
            print("      Anything below row " + str(RANGE_ROWS) + " in the sheet is never fetched.")
        if len(headers) >= RANGE_COLUMNS:
            print("  *** COLUMN CAP. " + str(len(headers)) + " headers against a range ending at column "
                  + RANGE_LAST_COLUMN + " (" + str(RANGE_COLUMNS) + ").")
            print("      A Meta export puts full_name and phone_number last, so those are")
            print("      the first columns lost when the sheet outgrows the range.")

    print()
    print("=" * 78)
    print("If the row's tab is not listed under 'tabs pulled' on any source above, that is")
    print("the answer: a new Meta form writes a new tab, and a tab nobody added to the")
    print("source is never read. Add it in Marketing → the source → tabs, then Pull.")


if __name__ == "__main__":
    asyncio.run(main(*sys.argv[1:3]))
