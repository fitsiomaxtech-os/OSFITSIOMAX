from database import v3_col


async def get_first_stage_name(stage_type: str, fallback: str) -> str:
    """Return the current name of the first (order=0) pipeline stage for the given type.

    Several code paths used to hardcode literal stage names (e.g. "New Appointment") when
    stamping a lead's first position in a pipeline. Once Super Admin renames that stage via
    Pipeline Stage Management, the hardcoded literal no longer matches any real stage — the
    lead becomes orphaned (counted in totals but invisible in every stage pill). Callers should
    look the name up dynamically instead so they always land leads on the live first stage.
    """
    doc = await v3_col("pipeline_stages").find_one(
        {"type": stage_type}, {"_id": 0, "name": 1}, sort=[("order", 1)]
    )
    return doc["name"] if doc else fallback


async def get_closing_stage_name(stage_type: str, fallback: str) -> str:
    """Return the current name of the stage a lead *finishes* a pipeline on.

    The mirror of get_first_stage_name, and orphans leads the same way when hardcoded:
    the Head Physio pipeline's closing stage shipped as "Consultation Visit" and has since
    been renamed, so writing that literal put completed consultations on a stage that no
    longer existed — invisible on every board that filters by stage.

    Prefers the stage flagged final; falls back to the last by order, since a pipeline
    always has a last stage even when nothing is flagged.
    """
    rows = await v3_col("pipeline_stages").find(
        {"type": stage_type}, {"_id": 0, "name": 1, "is_final": 1}
    ).sort("order", 1).to_list(100)
    if not rows:
        return fallback
    return next((r["name"] for r in rows if r.get("is_final")), rows[-1]["name"])


async def get_stage_name_at(stage_type: str, index: int, fallback: str) -> str:
    """Return the stage occupying a given position, for hand-off points identified by
    where they sit rather than by what they're called."""
    rows = await v3_col("pipeline_stages").find(
        {"type": stage_type}, {"_id": 0, "name": 1}
    ).sort("order", 1).to_list(100)
    names = [r["name"] for r in rows]
    if not names:
        return fallback
    return names[index] if 0 <= index < len(names) else names[-1]
