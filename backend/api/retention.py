"""Keep only the newest few generations of each patient's insole.

Every generation writes a GLB and an STL, about 19 MB the pair, and nothing
ever removed them. One month of shape debugging put 2 GB in a bucket whose
free-tier allowance is 1 GB. Trimming by age does not help - the 2 GB was all
recent - so the rule is by count, per patient and per side, which also keeps
the newest version of an insole made a year ago.
"""
from __future__ import annotations

from typing import Dict, List, Optional

BUCKET = "exports"

# Three, because a mesh is an output, not the record. The design that produced
# it lives in insole_designs with every parameter, and generation_jobs keeps a
# snapshot besides, so any older shape can be rebuilt in about twenty seconds.
# What three buys is being able to eyeball the last few attempts side by side.
DEFAULT_KEEP = 3


def find_prunable_jobs(
    supabase,
    patient_id: str,
    foot_side: str,
    keep: int = DEFAULT_KEEP,
) -> List[Dict]:
    """Jobs for this patient and side beyond the newest `keep`, newest first.

    Only jobs that still name a stored file are returned, so running this
    twice does not report the same rows again.
    """
    response = (
        supabase.table("generation_jobs")
        .select("id, glb_storage_path, stl_storage_path, created_at")
        .eq("patient_id", patient_id)
        .eq("foot_side", foot_side)
        .order("created_at", desc=True)
        .execute()
    )
    rows = response.data or []
    return [
        row
        for row in rows[keep:]
        if row.get("glb_storage_path") or row.get("stl_storage_path")
    ]


def prune_generations(
    supabase,
    patient_id: str,
    foot_side: str,
    keep: int = DEFAULT_KEEP,
    dry_run: bool = False,
) -> Dict[str, int]:
    """Delete the stored meshes of those jobs and forget their paths.

    The job rows stay: they carry params_snapshot, which is the part worth
    keeping, and the database is nowhere near its own limit. Paths are cleared
    so no row claims a file that is gone.
    """
    stale = find_prunable_jobs(supabase, patient_id, foot_side, keep)
    if not stale:
        return {"jobs": 0, "files": 0}

    paths: List[str] = []
    for row in stale:
        for column in ("glb_storage_path", "stl_storage_path"):
            if row.get(column):
                paths.append(row[column])

    if dry_run:
        return {"jobs": len(stale), "files": len(paths)}

    for start in range(0, len(paths), 50):
        supabase.storage.from_(BUCKET).remove(paths[start:start + 50])

    for row in stale:
        (
            supabase.table("generation_jobs")
            .update({"glb_storage_path": None, "stl_storage_path": None})
            .eq("id", row["id"])
            .execute()
        )

    return {"jobs": len(stale), "files": len(paths)}


def prune_quietly(
    supabase,
    patient_id: Optional[str],
    foot_side: Optional[str],
    keep: int = DEFAULT_KEEP,
) -> None:
    """Prune after a generation, never letting it fail the generation.

    The mesh the practitioner just asked for is already built and uploaded by
    this point; housekeeping that throws must not turn that into an error.
    """
    if not patient_id or not foot_side:
        return
    try:
        result = prune_generations(supabase, patient_id, foot_side, keep)
        if result["files"]:
            print(
                f"[INFO] retention: removed {result['files']} files from "
                f"{result['jobs']} old generations (keeping newest {keep})"
            )
    except Exception as exc:
        print(f"[WARNING] retention pass failed, nothing removed: {exc}")
