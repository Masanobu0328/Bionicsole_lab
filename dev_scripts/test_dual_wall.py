"""Test script for dual-wall shell integration"""
import numpy as np
import pandas as pd
import trimesh
from core.xcell_3d import apply_3d_xcell_lattice
from core.geometry_v4 import generate_insole_from_outline

# Load actual insole outline
outline_path = 'patients/0001/outline.csv'
df = pd.read_csv(outline_path)
print(f'Loaded outline: {len(df)} points')

# Generate base mesh using the CSV path
mesh = generate_insole_from_outline(outline_path, base_thickness=3.0)
print(f'Base mesh: {len(mesh.vertices)} verts, watertight: {mesh.is_watertight}')

# Apply lattice with dual-wall shell
result, info = apply_3d_xcell_lattice(
    mesh,
    cell_size=4.0,
    strut_radius=0.4,
    top_skin=0.4,
    bottom_skin=0.4
)

print(f'\nResult:')
print(f'  Vertices: {len(result.vertices)}')
print(f'  Faces: {len(result.faces)}')
print(f'  Success: {info["success"]}')
print(f'  Cells generated: {info["cells_generated"]}')

# Export
result.export('exports/dual_wall_insole_test.stl')
print('\nExported to exports/dual_wall_insole_test.stl')
