"""
Diagnostic test to identify where watertight breaks
"""
import sys
sys.path.insert(0, '.')

import numpy as np
import pandas as pd
from pathlib import Path
from core.geometry_v4 import generate_insole_from_outline, generate_hollow_shell

OUTLINE_CSV = Path('patients/0001/outline.csv')

def main():
    print("=" * 60)
    print("WATERTIGHT DIAGNOSTIC TEST")
    print("=" * 60)
    
    # Step 1: Load outline
    outline = pd.read_csv(OUTLINE_CSV)[['x_mm', 'y_mm']].values
    print(f"\n[Step 1] Loaded outline: {len(outline)} points")
    
    # Step 2: Generate base mesh
    print("\n[Step 2] Generating base insole mesh...")
    mesh = generate_insole_from_outline(str(OUTLINE_CSV))
    print(f"  Base mesh: {len(mesh.vertices)} verts, {len(mesh.faces)} faces")
    print(f"  >>> WATERTIGHT: {mesh.is_watertight}")
    
    if not mesh.is_watertight:
        print("  WARNING: Base mesh is NOT watertight!")
        return
    
    # Step 3: Build height maps (simplified)
    print("\n[Step 3] Building height maps...")
    from scipy.interpolate import LinearNDInterpolator
    
    mesh_verts = mesh.vertices
    xy = mesh_verts[:, :2]
    z = mesh_verts[:, 2]
    
    z_min, z_max = z.min(), z.max()
    top_mask = z > (z_max - 1.0)
    bottom_mask = z < (z_min + 1.0)
    
    top_heights = {}
    bottom_heights = {}
    
    for v in mesh_verts[top_mask]:
        key = (round(float(v[0]), 1), round(float(v[1]), 1))
        if key not in top_heights or v[2] > top_heights[key]:
            top_heights[key] = float(v[2])
    
    for v in mesh_verts[bottom_mask]:
        key = (round(float(v[0]), 1), round(float(v[1]), 1))
        if key not in bottom_heights or v[2] < bottom_heights[key]:
            bottom_heights[key] = float(v[2])
    
    print(f"  Top height samples: {len(top_heights)}")
    print(f"  Bottom height samples: {len(bottom_heights)}")
    
    # Step 4: Generate hollow shell
    print("\n[Step 4] Generating hollow shell (boolean difference)...")
    
    # Get outline points
    from collections import defaultdict
    boundary_edges = mesh.edges[mesh.edges_unique_inverse][mesh.faces_unique_edges].reshape(-1, 2)
    from collections import Counter
    edge_counts = Counter(map(tuple, np.sort(boundary_edges, axis=1).tolist()))
    boundary_edge_list = [e for e, c in edge_counts.items() if c == 1]
    
    if boundary_edge_list:
        adj = defaultdict(list)
        for e in boundary_edge_list:
            adj[e[0]].append(e[1])
            adj[e[1]].append(e[0])
        
        start = boundary_edge_list[0][0]
        path = [start]
        visited = {start}
        current = start
        
        for _ in range(len(adj) + 1):
            neighbors = [n for n in adj[current] if n not in visited]
            if not neighbors:
                break
            current = neighbors[0]
            path.append(current)
            visited.add(current)
        
        outline_points = mesh_verts[path][:, :2]
        outline_points = np.vstack([outline_points, outline_points[0]])
    else:
        outline_points = outline
    
    print(f"  Outline points: {len(outline_points)}")
    
    hollow_shell, inner_volume = generate_hollow_shell(
        outline_points=outline_points,
        top_height_map=top_heights,
        bottom_height_map=bottom_heights,
        wall_thickness=0.8,
        top_skin=0.4,
        bottom_skin=0.4,
        outer_mesh=mesh
    )
    
    print(f"\n  Hollow shell: {len(hollow_shell.vertices)} verts, {len(hollow_shell.faces)} faces")
    print(f"  >>> HOLLOW SHELL WATERTIGHT: {hollow_shell.is_watertight}")
    
    print(f"\n  Inner volume: {len(inner_volume.vertices)} verts, {len(inner_volume.faces)} faces")
    print(f"  >>> INNER VOLUME WATERTIGHT: {inner_volume.is_watertight}")
    
    # Step 5: Check if lattice combination breaks watertight
    print("\n[Step 5] Testing lattice combination...")
    
    from core.xcell_3d import create_3d_xcell_unit
    import trimesh
    
    # Create simple test lattice
    unit_cell = create_3d_xcell_unit(size=4.0, strut_radius=0.4)
    unit_cell.apply_translation([130, 47, 5])  # Center of insole approx
    
    combined = trimesh.util.concatenate([hollow_shell, unit_cell])
    combined.merge_vertices()
    combined.fix_normals()
    
    print(f"  Combined (shell + 1 cell): {len(combined.vertices)} verts")
    print(f"  >>> COMBINED WATERTIGHT: {combined.is_watertight}")
    
    # Summary
    summary_text = []
    summary_text.append("=" * 60)
    summary_text.append("SUMMARY")
    summary_text.append("=" * 60)
    summary_text.append(f"  Base mesh watertight:     {mesh.is_watertight}")
    summary_text.append(f"  Inner volume watertight:  {inner_volume.is_watertight}")
    summary_text.append(f"  Hollow shell watertight:  {hollow_shell.is_watertight}")
    summary_text.append(f"  Combined watertight:      {combined.is_watertight}")
    summary_text.append("=" * 60)
    
    summary_str = "\n".join(summary_text)
    print("\n" + summary_str)
    
    with open('diagnostic_summary.txt', 'w', encoding='utf-8') as f:
        f.write(summary_str)
    
    # Export for visual inspection
    hollow_shell.export('exports/diag_hollow_shell.stl')
    inner_volume.export('exports/diag_inner_volume.stl')
    print("\nExported: exports/diag_hollow_shell.stl, exports/diag_inner_volume.stl")

if __name__ == '__main__':
    main()
