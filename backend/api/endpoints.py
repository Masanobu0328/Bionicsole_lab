from __future__ import annotations

import sys
import time
import traceback
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from backend.api.auth import get_current_practitioner_optional
from backend.api.supabase_client import get_supabase

# Ensure core modules can be imported
PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.geometry_v4_frontend import generate_insole_from_outline
from core.xcell_3d import apply_3d_xcell_lattice

router = APIRouter()


class TaskManager:
    def __init__(self):
        self.tasks = {}

    def create_task(self):
        task_id = str(uuid.uuid4())
        self.tasks[task_id] = {
            "status": "pending",
            "progress": 0,
            "message": "Initializing...",
            "result": None,
        }
        return task_id

    def update_task(self, task_id, status=None, progress=None, message=None, result=None):
        if task_id in self.tasks:
            if status:
                self.tasks[task_id]["status"] = status
            if progress is not None:
                self.tasks[task_id]["progress"] = progress
            if message:
                self.tasks[task_id]["message"] = message
            if result is not None:
                self.tasks[task_id]["result"] = result

    def get_task(self, task_id):
        return self.tasks.get(task_id)


task_manager = TaskManager()


class ArchSettings(BaseModel):
    medial_start: float = 15.0
    medial_peak: float = 43.0
    medial_end: float = 70.0
    medial_height: float = 0.0
    lateral_start: float = 20.0
    lateral_peak: float = 32.5
    lateral_end: float = 45.0
    lateral_height: float = 0.0
    transverse_start: float = 43.0
    transverse_peak: float = 59.0
    transverse_end: float = 75.0
    transverse_height: float = 0.0
    medial_y_start: float = 65.0
    medial_y_end: float = 100.0
    lateral_y_start: float = 0.0
    lateral_y_end: float = 25.0
    transverse_y_start: float = 25.0
    transverse_y_end: float = 65.0
    grid_cell_heights: Optional[Dict[str, float]] = None
    medial_detail_enabled: bool = False
    medial_detail_heights: List[float] = []
    transverse_detail_enabled: bool = False
    transverse_detail_heights: List[float] = []


class CurvePoint(BaseModel):
    x: float
    y: float


class ArchCurves(BaseModel):
    medial: List[CurvePoint]
    medialFlat: Optional[List[CurvePoint]] = None
    lateral: List[CurvePoint]
    lateralFlat: Optional[List[CurvePoint]] = None
    transverse: List[CurvePoint]
    heelBridge: Optional[List[CurvePoint]] = None
    lateralBridge: Optional[List[CurvePoint]] = None
    metatarsalBridge: Optional[List[CurvePoint]] = None


class InsoleParams(BaseModel):
    patient_id: str
    foot_side: str
    flip_orientation: bool = False
    base_thickness: float = 3.0
    wall_height_offset_mm: float = 0.0
    heel_cup_scale: float = 1.0
    arch_scale: float = 1.0
    heel_cup_height: Optional[float] = None
    medial_wall_height: Optional[float] = None
    medial_wall_peak_x: Optional[float] = None
    lateral_wall_height: Optional[float] = None
    lateral_wall_peak_x: Optional[float] = None
    arch_settings: ArchSettings
    enable_lattice: bool = False
    lattice_cell_size: float = 3.0
    strut_radius: float = 0.2
    outline_points: Optional[List[Dict[str, float]]] = None
    landmark_config: Optional[Dict[str, float]] = None
    arch_curves: Optional[ArchCurves] = None
    bottom_outline_points: Optional[List[Dict[str, float]]] = None


class Patient(BaseModel):
    id: str
    name: str


def lookup_patient_db_record(patient_code: str, practitioner_id: str) -> Optional[Dict[str, str]]:
    try:
        supabase = get_supabase()
        response = (
            supabase.table("patients")
            .select("id, patient_code")
            .eq("practitioner_id", practitioner_id)
            .eq("patient_code", patient_code)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        if not rows:
            return None

        row = rows[0]
        return {
            "id": str(row["id"]),
            "patient_code": str(row.get("patient_code", patient_code)),
        }
    except Exception as exc:
        print(f"[WARNING] Failed to resolve patient record for {patient_code}: {exc}")
        return None


def upload_to_storage(
    practitioner_id: str,
    patient_code: str,
    foot_side: str,
    local_path: Path,
    extension: str,
) -> str:
    storage_path = f"{practitioner_id}/{patient_code}_{foot_side}_{int(time.time())}.{extension}"
    supabase = get_supabase()

    with open(local_path, "rb") as file_handle:
        content = file_handle.read()

    mime_type = "model/gltf-binary" if extension == "glb" else "application/octet-stream"
    supabase.storage.from_("exports").upload(storage_path, content, {"content-type": mime_type})
    return storage_path


def get_signed_url(storage_path: str, expires_in: int = 3600) -> str:
    supabase = get_supabase()
    result = supabase.storage.from_("exports").create_signed_url(storage_path, expires_in)
    signed_url = (
        result.get("signedURL")
        or result.get("signedUrl")
        or result.get("signed_url")
    )
    if not signed_url:
        raise ValueError("Signed URL was not returned by Supabase Storage")
    return signed_url


def save_generation_job(
    practitioner_id: str,
    patient_db_id: str,
    params: InsoleParams,
    glb_storage_path: str,
    stl_storage_path: str,
) -> None:
    supabase = get_supabase()
    supabase.table("generation_jobs").insert({
        "practitioner_id": practitioner_id,
        "patient_id": patient_db_id,
        "foot_side": params.foot_side,
        "status": "completed",
        "progress": 100,
        "glb_storage_path": glb_storage_path,
        "stl_storage_path": stl_storage_path,
        "params_snapshot": params.model_dump(),
    }).execute()


def generate_insole_worker(
    task_id: str,
    params: InsoleParams,
    practitioner_id: Optional[str] = None,
):
    try:
        def progress_callback(message, percent):
            task_manager.update_task(task_id, status="processing", progress=percent, message=message)

        print("[DEBUG] ===== Generation Request =====")
        print(f"[DEBUG] Patient: {params.patient_id}, Side: {params.foot_side}")
        print(f"[DEBUG] Base Thickness: {params.base_thickness}")
        print(f"[DEBUG] Heel Cup Height: {params.heel_cup_height}")
        print(f"[DEBUG] Wall Heights - Medial: {params.medial_wall_height}, Lateral: {params.lateral_wall_height}")
        print(f"[DEBUG] Wall Peak X - Medial: {params.medial_wall_peak_x}, Lateral: {params.lateral_wall_peak_x}")
        print(f"[DEBUG] Arch Settings: {params.arch_settings.model_dump()}")
        print(f"[DEBUG] Landmark Config: {params.landmark_config}")
        print(f"[DEBUG] Arch Curves: {params.arch_curves}")
        print("[DEBUG] ================================")

        patients_dir = PROJECT_ROOT / "patients"
        outline_csv_path = patients_dir / params.patient_id / "outline.csv"

        if not params.outline_points and not outline_csv_path.exists():
            raise Exception("Patient outline not found")

        flip_x = params.flip_orientation
        flip_y = False
        arch_settings_dict = params.arch_settings.model_dump()

        landmark_settings = None
        if params.landmark_config:
            landmark_settings = params.landmark_config

        wall_params = {
            "medial_height": params.medial_wall_height,
            "lateral_height": params.lateral_wall_height,
            "medial_peak_x": params.medial_wall_peak_x,
            "lateral_peak_x": params.lateral_wall_peak_x,
        }
        wall_params = {key: value for key, value in wall_params.items() if value is not None}

        print(f"[DEBUG] Processed wall_params: {wall_params}")
        print(f"[DEBUG] Processed landmark_settings: {landmark_settings}")

        arch_curves_dict = params.arch_curves.model_dump() if params.arch_curves else None

        mesh = generate_insole_from_outline(
            outline_csv_path=outline_csv_path if not params.outline_points else None,
            outline_points=params.outline_points,
            flip_x=flip_x,
            flip_y=flip_y,
            base_thickness=params.base_thickness,
            arch_scale=params.arch_scale,
            wall_height_offset_mm=params.wall_height_offset_mm,
            heel_cup_scale=params.heel_cup_scale,
            arch_settings=arch_settings_dict,
            landmark_settings=landmark_settings,
            wall_params=wall_params,
            heel_cup_height=params.heel_cup_height,
            arch_curves=arch_curves_dict,
            progress_callback=progress_callback,
            bottom_outline_points=params.bottom_outline_points,
        )

        import numpy as np

        if params.foot_side == "right":
            y_min = float(mesh.vertices[:, 1].min())
            y_max = float(mesh.vertices[:, 1].max())
            mirror = np.array([
                [1, 0, 0, 0],
                [0, -1, 0, y_min + y_max],
                [0, 0, 1, 0],
                [0, 0, 0, 1],
            ], dtype=float)
            mesh.apply_transform(mirror)
            print("[DEBUG] Applied Y-mirror for right foot")

        lattice_info = None
        if params.enable_lattice:
            mesh, lattice_info = apply_3d_xcell_lattice(
                base_mesh=mesh,
                cell_size=params.lattice_cell_size,
                strut_radius=params.strut_radius,
                progress_callback=progress_callback,
            )

        progress_callback("Exporting files...", 95)
        exports_dir = PROJECT_ROOT / "exports"
        exports_dir.mkdir(exist_ok=True)

        glb_filename = f"generated_{params.patient_id}_{params.foot_side}.glb"
        glb_path = exports_dir / glb_filename
        mesh.export(glb_path)

        stl_filename = f"generated_{params.patient_id}_{params.foot_side}.stl"
        stl_path = exports_dir / stl_filename
        mesh.export(stl_path)

        result = {
            "download_url": f"/exports/{glb_filename}",
            "stl_url": f"/exports/{stl_filename}",
            "lattice_info": lattice_info if params.enable_lattice else None,
        }

        if practitioner_id:
            try:
                patient_record = lookup_patient_db_record(params.patient_id, practitioner_id)
                glb_storage_path = upload_to_storage(practitioner_id, params.patient_id, params.foot_side, glb_path, "glb")
                stl_storage_path = upload_to_storage(practitioner_id, params.patient_id, params.foot_side, stl_path, "stl")

                result["download_url"] = get_signed_url(glb_storage_path)
                result["stl_url"] = get_signed_url(stl_storage_path)

                if patient_record:
                    save_generation_job(
                        practitioner_id=practitioner_id,
                        patient_db_id=patient_record["id"],
                        params=params,
                        glb_storage_path=glb_storage_path,
                        stl_storage_path=stl_storage_path,
                    )
            except Exception as storage_error:
                print(f"[WARNING] Supabase upload failed: {storage_error}")

        task_manager.update_task(
            task_id,
            status="completed",
            progress=100,
            message="Generation complete!",
            result=result,
        )
    except Exception as exc:
        traceback.print_exc()
        task_manager.update_task(task_id, status="failed", message=str(exc))


@router.get("/patients", response_model=List[Patient])
async def list_patients():
    patients_dir = PROJECT_ROOT / "patients"
    if not patients_dir.exists():
        return []

    patients = []
    for directory in patients_dir.iterdir():
        if directory.is_dir():
            patients.append(Patient(id=directory.name, name=directory.name))
    return patients


@router.post("/generate-insole")
async def generate_insole(
    params: InsoleParams,
    background_tasks: BackgroundTasks,
    practitioner_id: Optional[str] = Depends(get_current_practitioner_optional),
):
    task_id = task_manager.create_task()
    background_tasks.add_task(generate_insole_worker, task_id, params, practitioner_id)
    return {"task_id": task_id}


@router.get("/tasks/{task_id}")
async def get_task_status(task_id: str):
    task = task_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.get("/exports/{filename}")
async def get_export(filename: str):
    from fastapi.responses import FileResponse

    file_path = PROJECT_ROOT / "exports" / filename
    if file_path.exists():
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail="File not found")
