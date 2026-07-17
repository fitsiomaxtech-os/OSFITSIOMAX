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
