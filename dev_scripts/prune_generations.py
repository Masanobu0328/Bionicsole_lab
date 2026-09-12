"""Apply the retention rule to every patient that already has a backlog.

The backend prunes as it generates from now on, but that only touches patients
who generate again. This sweeps what is already stored.

Dry run by default - it prints what it would remove and exits. Pass --apply to
actually delete. Deletion cannot be undone.

    python dev_scripts/prune_generations.py
    python dev_scripts/prune_generations.py --apply
    python dev_scripts/prune_generations.py --keep 5 --apply
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.resolve()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(PROJECT_ROOT / "backend" / ".env")

from supabase import create_client  # noqa: E402

from backend.api.retention import DEFAULT_KEEP, prune_generations  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keep", type=int, default=DEFAULT_KEEP,
                        help=f"generations to keep per patient and side (default {DEFAULT_KEEP})")
    parser.add_argument("--apply", action="store_true",
                        help="actually delete; without it this only reports")
    args = parser.parse_args()

    if args.keep < 1:
        print("--keep must be at least 1: the newest generation is never removed")
        return 2

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found in backend/.env")
        return 2

    supabase = create_client(url, key)

    jobs = (
        supabase.table("generation_jobs")
        .select("patient_id, foot_side")
        .execute()
    ).data or []

    groups = defaultdict(int)
    for job in jobs:
        if job.get("patient_id") and job.get("foot_side"):
            groups[(job["patient_id"], job["foot_side"])] += 1

    labels = {
        row["id"]: f'{row["patient_code"]} ({row.get("display_label") or "-"})'
        for row in (supabase.table("patients")
                    .select("id, patient_code, display_label").execute()).data or []
    }

    mode = "DELETING" if args.apply else "dry run - nothing will be deleted"
    print(f"keeping the newest {args.keep} per patient and side [{mode}]\n")

    total_jobs = total_files = 0
    for (patient_id, foot_side), generations in sorted(
        groups.items(), key=lambda kv: (labels.get(kv[0][0], ""), kv[0][1])
    ):
        result = prune_generations(
            supabase, patient_id, foot_side, args.keep, dry_run=not args.apply
        )
        total_jobs += result["jobs"]
        total_files += result["files"]
        verb = "removed" if args.apply else "would remove"
        print(f"  {labels.get(patient_id, patient_id):<34} {foot_side:<6} "
              f"{generations:>4} generations -> {verb} {result['files']:>4} files "
              f"from {result['jobs']:>3} old ones")

    print(f"\n{'removed' if args.apply else 'would remove'} "
          f"{total_files} files from {total_jobs} generations")
    if not args.apply:
        print("re-run with --apply to actually delete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
