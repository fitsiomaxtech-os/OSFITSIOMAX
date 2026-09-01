"""What each sheet source is actually mapping, and what it would map today.

Reads only. Prints nothing back to the database:

    cd backend && python tools/lead_source_mapping_check.py

Why this is worth looking at.

A source's column_mapping is not a setting somebody chose -- unless they opened the
mapping dialog, it is whatever the last pull worked out, written back at the end of
_internal_pull_source. So a field the mapper of the day failed to recognise is stored as
"not mapped", and the next pull reuses the stored mapping ahead of re-deriving one. The
absence sticks, and improving the mapper does nothing on its own.

That is what kept every Meta-export lead landing as "Unknown" after the alias table was
fixed: "full_name" went unmatched once under the old exact-match mapper, and the source
had been carrying a mapping with no name in it ever since.

The importer now fills those gaps from the tab's own headers on each pull, so this is a
check rather than a fix. What to look for per source:

  MAPPED     what the source has stored, and will use as-is
  WOULD ADD  fields the stored mapping does not name that today's mapper recognises
             -- these get filled in on the next pull
  UNMAPPED   fields neither the stored mapping nor the mapper can place; a column headed
             something nobody has listed. Add the spelling to FIELD_ALIASES in
             routers/v3_marketing.py, or set it by hand in the mapping dialog.

headers_detected is written by the last pull, so a source that has never been pulled
shows nothing to compare against and says so.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import v3_col  # noqa: E402
from routers.v3_marketing import auto_map_columns, normalize_source  # noqa: E402


async def main():
    sources = await v3_col("marketing_sources").find({}, {"_id": 0}).to_list(500)
    if not sources:
        print("No sheet sources configured.")
        return

    print("Sheet sources: " + str(len(sources)))
    for source in sources:
        source = normalize_source(source)
        stored = dict(source.get("column_mapping") or {})
        headers = list(source.get("headers_detected") or [])

        print()
        print("=" * 78)
        print(source.get("name") or source.get("id"))
        print("  tabs        : " + ", ".join(source.get("sheet_names") or []))
        print("  last synced : " + str(source.get("last_synced") or "never"))
        print("  last import : " + str(source.get("last_sync_imported", "—"))
              + " imported, " + str(source.get("last_sync_skipped_duplicate", "—")) + " dupes, "
              + str(source.get("last_sync_skipped_no_phone", "—")) + " with no phone")

        if not headers:
            print("  headers     : none recorded — this source has not been pulled yet.")
            print("  MAPPED      : " + (str(stored) if stored else "nothing stored"))
            continue

        print("  headers     : " + ", ".join(headers))
        fresh = auto_map_columns(headers)

        print()
        print("  MAPPED (stored, used as-is):")
        for field in sorted(stored):
            print("      " + field.ljust(18) + "-> " + str(stored[field]))
        if not stored:
            print("      (nothing stored — the whole mapping is derived each pull)")

        would_add = {
            f: h for f, h in fresh.items()
            if f not in stored and h not in set(stored.values())
        }
        print()
        print("  WOULD ADD (filled in on the next pull):")
        for field in sorted(would_add):
            print("      " + field.ljust(18) + "-> " + str(would_add[field]))
        if not would_add:
            print("      (nothing — the stored mapping already names everything recognised)")

        placed = set(stored) | set(would_add)
        unmapped = [h for h in headers
                    if h not in set(stored.values()) and h not in set(would_add.values())]
        print()
        print("  UNMAPPED columns (kept as extra detail under their own header):")
        print("      " + (", ".join(unmapped) if unmapped else "(none)"))

        if "name" not in placed:
            print()
            print("  *** No name column. Leads from this source import as \"Unknown\".")
            print("      Add the header's spelling to FIELD_ALIASES['name'] in")
            print("      routers/v3_marketing.py, or map it by hand in the dialog.")
        if "phone" not in placed:
            print()
            print("  *** No phone column. The importer falls back to detecting one from")
            print("      the values; where it cannot, the tab is skipped.")


if __name__ == "__main__":
    asyncio.run(main())
