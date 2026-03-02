from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, Dict, List, Tuple
from pathlib import Path
import sys
import shutil
import uuid
import asyncio
from concurrent.futures import ThreadPoolExecutor

# Ensure core modules can be imported
PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Import core modules
# These imports will fail if dependencies are not installed or if there's an import error.
from core.geometry_v4_frontend import generate_insole_from_outline, export_mesh
from core.xcell_3d import apply_3d_xcell_lattice

router = APIRouter()

# --- Task Manager ---
class TaskManager:
    def __init__(self):
        self.tasks = {} # task_id -> {status, progress, message, result}

    def create_task(self):
        task_id = str(uuid.uuid4())
        self.tasks[task_id] = {
            "status": "pending",
            "progress": 0,
            "message": "Initializing...",
            "result": None
        }
        return task_id

    def update_task(self, task_id, status=None, progress=None, message=None, result=None):
        if task_id in self.tasks:
            if status: self.tasks[task_id]["status"] = status
            if progress is not None: self.tasks[task_id]["progress"] = progress
            if message: self.tasks[task_id]["message"] = message
            if result: self.tasks[task_id]["result"] = result

    def get_task(self, task_id):
        return self.tasks.get(task_id)

task_manager = TaskManager()
# Use a thread pool for blocking geometry operations so we don't block the async event loop
executor = ThreadPoolExecutor(max_workers=3)

# --- Pydantic Models ---

class ArchSettings(BaseModel):
    medial_start: float = 15.0
    medial_peak: float = 43.0
    medial_end: float = 70.0
    medial_height: float = 0.0 # Will use defaults if 0? No, explicitly passed.
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
    
    # Detailed grid settings
    grid_cell_heights: Optional[Dict[str, float]] = None
    # Per-landmark Z height control (詳細設定)
    medial_detail_enabled: bool = False
    medial_detail_heights: List[float] = []  # [subtalar, navicular, cuneiform, m5] in mm
    transverse_detail_enabled: bool = False
    transverse_detail_heights: List[float] = []  # [nav, cun, mt, met] in mm

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
    foot_side: str # "left" or "right"
    flip_orientation: bool = False
    
    base_thickness: float = 3.0
    wall_height_offset_mm: float = 0.0
    heel_cup_scale: float = 1.0
    arch_scale: float = 1.0
    
    # New Shape Parameters (Optional to maintain backward compatibility)
    heel_cup_height: Optional[float] = None
    medial_wall_height: Optional[float] = None
    medial_wall_peak_x: Optional[float] = None
    lateral_wall_height: Optional[float] = None
    lateral_wall_peak_x: Optional[float] = None
    
    arch_settings: ArchSettings
    
    enable_lattice: bool = False
    lattice_cell_size: float = 3.0
    strut_radius: float = 0.2
    
    # Custom Design Data
    outline_points: Optional[List[Dict[str, float]]] = None
    landmark_config: Optional[Dict[str, float]] = None
    arch_curves: Optional[ArchCurves] = None

class Patient(BaseModel):
    id: str
    name: str # Might just be ID if no name file

# --- Background Worker ---
def generate_insole_worker(task_id: str, params: InsoleParams):
    try:
        def progress_callback(message, percent):
            task_manager.update_task(task_id, status="processing", progress=percent, message=message)

        # Debug logging
        print(f"[DEBUG] ===== Generation Request =====")
        print(f"[DEBUG] Patient: {params.patient_id}, Side: {params.foot_side}")
        print(f"[DEBUG] Base Thickness: {params.base_thickness}")
        print(f"[DEBUG] Heel Cup Height: {params.heel_cup_height}")
        print(f"[DEBUG] Wall Heights - Medial: {params.medial_wall_height}, Lateral: {params.lateral_wall_height}")
        print(f"[DEBUG] Wall Peak X - Medial: {params.medial_wall_peak_x}, Lateral: {params.lateral_wall_peak_x}")
        print(f"[DEBUG] Arch Settings: {params.arch_settings.dict()}")
        print(f"[DEBUG] Landmark Config: {params.landmark_config}")
        print(f"[DEBUG] Arch Curves: {params.arch_curves}")
        print(f"[DEBUG] ================================")

        patients_dir = PROJECT_ROOT / "patients"
        outline_csv_path = patients_dir / params.patient_id / "outline.csv"

        # If no custom points and no file, fail
        if not params.outline_points and not outline_csv_path.exists():
            raise Exception("Patient outline not found")

        flip_x = params.flip_orientation
        flip_y = False  # Outline Y stays as-is; right foot mirroring applied post-generation

        arch_settings_dict = params.arch_settings.dict()

        # Convert landmark_config to landmark_settings expected by geometry_v4
        landmark_settings = None
        if params.landmark_config:
            # Map frontend keys to geometry keys if needed, or pass through
            landmark_settings = params.landmark_config

        # Construct wall_params
        wall_params = {
            'medial_height': params.medial_wall_height,
            'lateral_height': params.lateral_wall_height,
            'medial_peak_x': params.medial_wall_peak_x,
            'lateral_peak_x': params.lateral_wall_peak_x
        }
        # Filter out None values
        wall_params = {k: v for k, v in wall_params.items() if v is not None}

        print(f"[DEBUG] Processed wall_params: {wall_params}")
        print(f"[DEBUG] Processed landmark_settings: {landmark_settings}")
        
        # Prepare Arch Curves
        arch_curves_dict = params.arch_curves.dict() if params.arch_curves else None

        # Generate Base Mesh
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
            progress_callback=progress_callback
        )
        
        # Mirror mesh for right foot.
        # Default generation (no flip) produces what appears as LEFT FOOT in the viewer.
        # For RIGHT FOOT: mirror Y axis using apply_transform (handles normals automatically).
        import numpy as np
        if params.foot_side == 'right':
            y_min = float(mesh.vertices[:, 1].min())
            y_max = float(mesh.vertices[:, 1].max())
            mirror = np.array([
                [1,  0, 0, 0],
                [0, -1, 0, y_min + y_max],
                [0,  0, 1, 0],
                [0,  0, 0, 1],
            ], dtype=float)
            mesh.apply_transform(mirror)
            print(f"[DEBUG] Applied Y-mirror for right foot")

        # Apply Lattice if enabled
        info = None
        if params.enable_lattice:
            mesh, info = apply_3d_xcell_lattice(
                base_mesh=mesh,
                cell_size=params.lattice_cell_size,
                strut_radius=params.strut_radius,
                progress_callback=progress_callback
            )
            
        # Export
        progress_callback("Exporting files...", 95)
        exports_dir = PROJECT_ROOT / "exports"
        exports_dir.mkdir(exist_ok=True)
        
        # 1. Export GLB for Web Preview
        glb_filename = f"generated_{params.patient_id}_{params.foot_side}.glb"
        glb_path = exports_dir / glb_filename
        mesh.export(glb_path)
        
        # 2. Export STL for Slicer
        stl_filename = f"generated_{params.patient_id}_{params.foot_side}.stl"
        stl_path = exports_dir / stl_filename
        mesh.export(stl_path)
        
        result = {
            "download_url": f"/exports/{glb_filename}",
            "stl_url": f"/exports/{stl_filename}",
            "lattice_info": info if params.enable_lattice else None
        }
        
        task_manager.update_task(task_id, status="completed", progress=100, message="Generation complete!", result=result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        task_manager.update_task(task_id, status="failed", message=str(e))


# --- Endpoints ---

@router.get("/patients", response_model=List[Patient])
async def list_patients():
    patients_dir = PROJECT_ROOT / "patients"
    if not patients_dir.exists():
        return []
    
    patients = []
    for d in patients_dir.iterdir():
        if d.is_dir():
            patients.append(Patient(id=d.name, name=d.name))
    return patients

@router.post("/generate-insole")
async def generate_insole(params: InsoleParams, background_tasks: BackgroundTasks):
    task_id = task_manager.create_task()
    # Run in background thread
    background_tasks.add_task(generate_insole_worker, task_id, params)
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
