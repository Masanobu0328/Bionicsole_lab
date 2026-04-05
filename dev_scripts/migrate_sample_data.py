"""
Migrate patient 0001 as sample data to Supabase.
Run once: python dev_scripts/migrate_sample_data.py
"""
import sys
import os
import csv
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / "backend" / ".env")

from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
PATIENTS_DIR = Path(__file__).parent.parent / "patients"

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def read_csv_outline(csv_path):
    points = []
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            points.append({"x": float(row["x_mm"]), "y": float(row["y_mm"])})
    return points


def migrate_sample():
    print("Migrating patient 0001 as sample data...")

    # 1. Insert sample patient (no practitioner - available to all)
    result = supabase.table("patients").upsert({
        "patient_code": "0001",
        "display_label": "Sample Patient (Demo)",
        "note": "Demo data - shows a typical insole design workflow.",
        "is_sample": True,
    }, on_conflict="practitioner_id,patient_code").execute()

    patient_id = result.data[0]["id"]
    print(f"Patient created: {patient_id}")

    # 2. Insert foot outline (right foot only)
    outline_path = PATIENTS_DIR / "0001" / "outline.csv"
    if outline_path.exists():
        points = read_csv_outline(outline_path)
        supabase.table("foot_outlines").upsert({
            "patient_id": patient_id,
            "foot_side": "right",
            "outline_points": points,
            "source": "csv_upload",
        }, on_conflict="patient_id,foot_side").execute()
        print(f"Outline migrated: {len(points)} points")

    # 3. Insert design (from design.json)
    design_path = PATIENTS_DIR / "0001" / "design.json"
    if design_path.exists():
        with open(design_path) as f:
            design = json.load(f)

        supabase.table("insole_designs").upsert({
            "patient_id": patient_id,
            "foot_side": "right",
            "version": 1,
            "base_thickness": design.get("base_thickness", 3.0),
            "heel_cup_height": design.get("heel_cup", 3.0),
            "arch_settings": design.get("arch", {}),
            "landmark_config": design.get("arch_position_cm", {}),
        }, on_conflict="patient_id,foot_side,version").execute()
        print("Design migrated")

    # 4. Upload GLB to Supabase Storage
    glb_path = Path(__file__).parent.parent / "exports" / "generated_0001_right.glb"
    if glb_path.exists():
        storage_path = f"samples/0001_right_sample.glb"
        try:
            with open(glb_path, "rb") as f:
                content = f.read()
            supabase.storage.from_("exports").upload(
                storage_path, content,
                {"content-type": "model/gltf-binary", "upsert": "true"}
            )
            print(f"GLB uploaded to Storage: {storage_path}")
        except Exception as e:
            print(f"GLB upload skipped (may already exist): {e}")

    print("\nMigration complete!")
    print(f"Patient 0001 is now available as sample data for all users.")


if __name__ == "__main__":
    migrate_sample()
