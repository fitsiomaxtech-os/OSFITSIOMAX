"""Test sheet connections the API test suite left in the live database, and their removal.

Reads only by default. Prints what it would remove and changes nothing:

    cd backend && python tools/test_connection_cleanup.py

Once you have read that list and agree with it:

    cd backend && python tools/test_connection_cleanup.py --delete

Why these rows are here.

The API tests post real connections through the live API -- BASE_URL is
REACT_APP_BACKEND_URL, so there is no separate test database -- and none of them delete
what they create. There is no DELETE route on /api/v3/sheets/connections for them to
call even if they tried, so every full run of the suite leaves six more rows behind:

    TEST_Conn_            tests/test_fitsiomax_v3_api.py
    TEST_CB_              tests/test_fitsiomax_v3_iteration9_retest.py
    TEST_Connection_      tests/test_v3_regression.py
    TEST_MappingConn_     tests/test_v3_regression.py
    TEST_BD_Connection_   tests/test_bd_dashboard_iteration14.py
    TEST_BD_Mapping_      tests/test_bd_dashboard_iteration14.py
    TEST_BD_Sync_         tests/test_bd_dashboard_iteration14.py

They are not only untidy on the Settings tab. dashboard/bd-summary counts
sheet_connections with an unfiltered count_documents, so each row inflates the
connection figure a BD user reads as live integrations. None of them can ever sync:
every one is created with oauth_connected False and nothing flips it.

What goes, and what is left alone.

Only connections whose connection_name starts with TEST_, and the sheet_mappings rows
pointing at them -- those mappings are unreachable once their connection is gone. The
delete is issued against the exact ids printed under REMOVING, not against a pattern, so
what you read is what is removed. Everything else is listed under KEEPING and never
touched; read that list before passing --delete.

Leads the sync tests imported (source_tab "TestTab") are counted and reported but left
in place. Removing lead records is a separate decision and not this script's to make.
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import v3_col  # noqa: E402

TEST_PREFIX = "TEST_"


def describe(row):
    return (
        f"      sheet {row.get('spreadsheet_id') or '--'}"
        f"   oauth_connected={row.get('oauth_connected')}"
        f"   created {row.get('created_at') or '--'}"
    )


async def main():
    parser = argparse.ArgumentParser(
        description="Remove sheet connections left behind by the API test suite."
    )
    parser.add_argument(
        "--delete",
        action="store_true",
        help="remove the rows listed under REMOVING; without it nothing is written",
    )
    args = parser.parse_args()

    rows = await v3_col("sheet_connections").find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    if not rows:
        print("No sheet connections in the database. Nothing to do.")
        return

    doomed, keeping = [], []
    for row in rows:
        name = row.get("connection_name") or ""
        (doomed if name.startswith(TEST_PREFIX) else keeping).append(row)

    print(f"{len(rows)} sheet connection(s) in the database.\n")

    print(f"KEEPING ({len(keeping)})")
    if keeping:
        for row in keeping:
            print(f"  {row.get('connection_name') or '<unnamed>'}")
            print(describe(row))
    else:
        print("  -- none; every connection in the database is a test row --")

    print(f"\nREMOVING ({len(doomed)})")
    if doomed:
        for row in doomed:
            print(f"  {row.get('connection_name')}")
            print(describe(row))
    else:
        print("  -- none; nothing matches the TEST_ prefix --")

    ids = [row["id"] for row in doomed if row.get("id")]
    unidentified = len(doomed) - len(ids)
    if unidentified:
        print(f"\n  {unidentified} matching row(s) carry no id and cannot be removed by this script.")

    mappings = 0
    if ids:
        mappings = await v3_col("sheet_mappings").count_documents({"connection_id": {"$in": ids}})
        print(f"\n  plus {mappings} sheet_mappings row(s) belonging to the connections above")

    test_leads = await v3_col("leads").count_documents({"source_tab": "TestTab"})
    if test_leads:
        print("\nReported only, not touched by this script:")
        print(f"  {test_leads} lead(s) with source_tab \"TestTab\", imported by the sync tests.")

    if not args.delete:
        print("\nNothing was changed. Re-run with --delete to remove the rows under REMOVING.")
        return

    if not ids:
        print("\nNothing to remove.")
        return

    removed = await v3_col("sheet_connections").delete_many({"id": {"$in": ids}})
    removed_mappings = await v3_col("sheet_mappings").delete_many({"connection_id": {"$in": ids}})
    remaining = await v3_col("sheet_connections").count_documents({})

    print(f"\nRemoved {removed.deleted_count} connection(s) and {removed_mappings.deleted_count} mapping(s).")
    print(f"{remaining} connection(s) left in the database.")


if __name__ == "__main__":
    asyncio.run(main())
