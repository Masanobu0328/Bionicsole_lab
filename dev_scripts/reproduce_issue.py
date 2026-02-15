
import sys
import os
from pathlib import Path
import traceback
import time

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.resolve()
sys.path.insert(0, str(PROJECT_ROOT))

# wrapper for print that flushes
def log(msg):
    print(msg, flush=True)

log("Starting reproduction script (Lattice Enabled)...")

try:
    from core.geometry_v4 import generate_insole_from_outline, export_mesh
    from core.xcell_3d import apply_3d_xcell_lattice
    log("Import successful.")
except Exception as e:
    log(f"Import failed: {e}")
    traceback.print_exc()
    sys.exit(1)

def reproduce():
    # Use a dummy outline or an existing one
    outline_path = PROJECT_ROOT / "patients" / "0001" / "outline.csv"
    
    if not outline_path.exists():
        log(f"Outline not found at {outline_path}, creating dummy...")
        import numpy as np
        theta = np.linspace(0, 2*np.pi, 100)
        x = 130 + 130 * np.cos(theta) 
        y = 50 + 40 * np.sin(theta)
        
        dummy_dir = PROJECT_ROOT / "patients" / "dummy"
        dummy_dir.mkdir(parents=True, exist_ok=True)
        outline_path = dummy_dir / "outline.csv"
        with open(outline_path, "w") as f:
            f.write("x_mm,y_mm\n")
            for xi, yi in zip(x, y):
                f.write(f"{xi},{yi}\n")
    
    try:
        log(f"Generating insole from {outline_path}...")
        mesh = generate_insole_from_outline(
            outline_csv_path=outline_path,
            base_thickness=3.0,
            arch_scale=1.0,
            wall_height_offset_mm=0.0,
            heel_cup_scale=1.0
        )
        log("Base insole generated.")
        
        log("Applying 3D X-Cell Lattice...")
        # Simulating enabled lattice
        mesh, info = apply_3d_xcell_lattice(
            mesh,
            cell_size=3.0,
            strut_radius=0.2
        )
        log("Lattice application successful!")
        
        # Test export
        export_path = PROJECT_ROOT / "exports" / "reproduction_lattice_test.glb"
        export_mesh(mesh, export_path)
        log("Export successful!")
        
    except AttributeError as e:
        if "remove_degenerate_faces" in str(e):
            log("\n[CONFIRMED] Reproduction successful! The error exists in the code.")
            traceback.print_exc()
        else:
            log(f"\n[ERROR] Attribute error but different: {e}")
            traceback.print_exc()
    except Exception as e:
        log(f"\n[ERROR] An exception occurred: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    reproduce()
