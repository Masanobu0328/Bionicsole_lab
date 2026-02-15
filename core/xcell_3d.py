"""
MasaCAD Core - 3D X-Cell 繝ｦ繝九ャ繝医そ繝ｫ
蜈ｨ譁ｹ蜷代°繧厩蝙九↓隕九∴繧狗悄縺ｮ3D X-cell讒矩

讒矩:
- 遶区婿菴薙・8縺､縺ｮ繧ｳ繝ｼ繝翫・縺九ｉ荳ｭ蠢・↓蜷代°縺・せ繝医Λ繝・ヨ
- 縺ｩ縺ｮ譁ｹ蜷代°繧芽ｦ九※繧９蝙九↓隕九∴繧・
- 譁懊ａ縺ｮ繧ｹ繝医Λ繝・ヨ縺・谺｡蜈・噪縺ｫ莠､蟾ｮ

Version: 1.0
"""

import numpy as np
import trimesh
import os
from typing import Optional, List, Tuple, Dict
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.resolve()
EXPORTS_DIR = PROJECT_ROOT / "exports"


def create_3d_xcell_unit(
    size: float = 3.0,
    strut_radius: float = 0.4
) -> trimesh.Trimesh:
    """
    3D X-Cell繝ｦ繝九ャ繝医そ繝ｫ繧堤函謌・
    
    遶区婿菴薙・8縺､縺ｮ繧ｳ繝ｼ繝翫・縺九ｉ荳ｭ蠢・↓蜷代°縺・せ繝医Λ繝・ヨ縺ｧ讒区・
    縺ｩ縺ｮ譁ｹ蜷代°繧芽ｦ九※繧９蝙九↓隕九∴繧・
    
    讒矩:
        繧ｳ繝ｼ繝翫・(0,0,0) -----> 荳ｭ蠢・0.5,0.5,0.5) <----- 繧ｳ繝ｼ繝翫・(1,1,1)
        繧ｳ繝ｼ繝翫・(1,0,0) -----> 荳ｭ蠢・0.5,0.5,0.5) <----- 繧ｳ繝ｼ繝翫・(0,1,1)
        ... (8譛ｬ縺ｮ繧ｹ繝医Λ繝・ヨ)
    
    Args:
        size: 遶区婿菴薙・繧ｵ繧､繧ｺ (mm)
        strut_radius: 繧ｹ繝医Λ繝・ヨ縺ｮ蜊雁ｾ・(mm)
    
    Returns:
        3D X-Cell繝ｦ繝九ャ繝医そ繝ｫ縺ｮ繝｡繝・す繝･
    """
    parts = []
    
    center = np.array([size/2, size/2, size/2])

    # Center sphere to reduce strut overlap
    sphere_subdiv = 1 if size <= 2.5 else 2
    cyl_sections = 10 if size <= 2.5 else 16
    center_sphere = trimesh.creation.icosphere(
        subdivisions=sphere_subdiv,
        radius=strut_radius
    )
    center_sphere.apply_translation(center)
    parts.append(center_sphere)
    
    # 8縺､縺ｮ繧ｳ繝ｼ繝翫・
    corners = [
        np.array([0, 0, 0]),
        np.array([size, 0, 0]),
        np.array([0, size, 0]),
        np.array([size, size, 0]),
        np.array([0, 0, size]),
        np.array([size, 0, size]),
        np.array([0, size, size]),
        np.array([size, size, size]),
    ]
    
    # 蜷・さ繝ｼ繝翫・縺九ｉ荳ｭ蠢・∈縺ｮ繧ｹ繝医Λ繝・ヨ
    for corner in corners:
        # 繧ｹ繝医Λ繝・ヨ縺ｮ譁ｹ蜷代→髟ｷ縺・
        direction = center - corner
        direction_length = np.linalg.norm(direction)
        direction_normalized = direction / direction_length
        # 繧ｹ繝医Λ繝・ヨ縺ｮ髟ｷ縺輔ｒ險育ｮ・
        # 荳ｭ蠢・帥縺ｨ遒ｺ螳溘↓驥阪↑繧九ｈ縺・↓縲・聞縺輔ｒ蟆代＠髟ｷ繧√↓險ｭ螳夲ｼ井ｸｭ蠢・∪縺ｧ蛻ｰ驕斐＆縺帙ｋ・・
        # 蜈・ strut_length = direction_length - strut_radius
        strut_length = direction_length
        
        if strut_length < 0.001:
            continue
        
        # 繧ｷ繝ｪ繝ｳ繝繝ｼ繧剃ｽ懈・
        cylinder = trimesh.creation.cylinder(
            radius=strut_radius,
            height=strut_length,
            sections=cyl_sections
        )
        
        # 譁ｹ蜷代ｒ蜷医ｏ縺帙ｋ
        z_axis = np.array([0, 0, 1])
        
        # 蝗櫁ｻ｢陦悟・繧定ｨ育ｮ・
        rotation_matrix = rotation_matrix_from_vectors(z_axis, direction_normalized)
        
        cylinder.apply_transform(rotation_matrix)
        
        # 菴咲ｽｮ繧貞粋繧上○繧具ｼ医さ繝ｼ繝翫・縺ｨ荳ｭ蠢・・荳ｭ髢鍋せ縺ｫ遘ｻ蜍包ｼ・
        strut_start = corner + direction_normalized * strut_radius
        strut_center = strut_start + direction_normalized * (strut_length / 2)
        cylinder.apply_translation(strut_center)
        
        parts.append(cylinder)

        # Corner sphere to close cylinder ends
        corner_sphere = trimesh.creation.icosphere(
            subdivisions=sphere_subdiv,
            radius=strut_radius
        )
        corner_sphere.apply_translation(corner)
        parts.append(corner_sphere)
    
    # 蜈ｨ縺ｦ縺ｮ繝代・繝・ｒ邨仙粋
    if not parts:
        return trimesh.Trimesh()
    
    # Manifold union for watertight mesh
    try:
        unit = trimesh.boolean.union(parts, engine='manifold')
    except Exception as e:
        print(f"[3D-XCELL] manifold union failed: {e}, using concatenate")
        unit = trimesh.util.concatenate(parts)
        unit.merge_vertices()
        unit.update_faces(unit.nondegenerate_faces())
        unit.merge_vertices()
        unit.fix_normals()

    return unit


def rotation_matrix_from_vectors(vec1, vec2):
    """
    vec1縺九ｉvec2縺ｸ縺ｮ蝗櫁ｻ｢陦悟・繧定ｨ育ｮ・
    """
    a = vec1 / np.linalg.norm(vec1)
    b = vec2 / np.linalg.norm(vec2)
    
    v = np.cross(a, b)
    c = np.dot(a, b)
    
    if np.linalg.norm(v) < 1e-10:
        if c > 0:
            return np.eye(4)
        else:
            # 180蠎ｦ蝗櫁ｻ｢
            return trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0])
    
    s = np.linalg.norm(v)
    
    kmat = np.array([
        [0, -v[2], v[1]],
        [v[2], 0, -v[0]],
        [-v[1], v[0], 0]
    ])
    
    rotation_3x3 = np.eye(3) + kmat + kmat @ kmat * ((1 - c) / (s ** 2))
    
    # 4x4陦悟・縺ｫ螟画鋤
    rotation_4x4 = np.eye(4)
    rotation_4x4[:3, :3] = rotation_3x3
    
    return rotation_4x4


def generate_3d_xcell_lattice(
    bounds: np.ndarray,
    cell_size: float = 3.0,
    strut_radius: float = 0.4
) -> trimesh.Trimesh:
    """
    謖・ｮ壹＆繧後◆蠅・阜繝懊ャ繧ｯ繧ｹ蜀・↓3D X-cell繝ｩ繝・ぅ繧ｹ繧堤函謌・
    
    Args:
        bounds: [[x_min, y_min, z_min], [x_max, y_max, z_max]]
        cell_size: 遶区婿菴薙そ繝ｫ縺ｮ繧ｵ繧､繧ｺ (mm)
        strut_radius: 繧ｹ繝医Λ繝・ヨ縺ｮ蜊雁ｾ・(mm)
    
    Returns:
        繝ｩ繝・ぅ繧ｹ讒矩繝｡繝・す繝･
    """
    x_min, y_min, z_min = bounds[0]
    x_max, y_max, z_max = bounds[1]
    
    # 繧ｻ繝ｫ謨ｰ繧定ｨ育ｮ・
    n_x = int(np.ceil((x_max - x_min) / cell_size))
    n_y = int(np.ceil((y_max - y_min) / cell_size))
    n_z = int(np.ceil((z_max - z_min) / cell_size))
    
    print(f"[3D-XCELL] Bounds: {x_max-x_min:.1f} x {y_max-y_min:.1f} x {z_max-z_min:.1f} mm")
    print(f"[3D-XCELL] Cell size: {cell_size}mm")
    print(f"[3D-XCELL] Grid: {n_x} x {n_y} x {n_z} cells = {n_x * n_y * n_z} total")
    
    # 蝓ｺ譛ｬ繝ｦ繝九ャ繝医そ繝ｫ繧剃ｽ懈・
    unit_cell = create_3d_xcell_unit(size=cell_size, strut_radius=strut_radius)
    
    if len(unit_cell.vertices) == 0:
        return trimesh.Trimesh()
    
    # 繧ｰ繝ｪ繝・ラ驟咲ｽｮ
    parts = []
    
    for iz in range(n_z):
        for iy in range(n_y):
            for ix in range(n_x):
                # 繝ｦ繝九ャ繝医そ繝ｫ繧偵さ繝斐・縺励※驟咲ｽｮ
                cell_copy = unit_cell.copy()
                
                # 菴咲ｽｮ繧定ｨ育ｮ・
                x_pos = x_min + ix * cell_size
                y_pos = y_min + iy * cell_size
                z_pos = z_min + iz * cell_size
                
                cell_copy.apply_translation([x_pos, y_pos, z_pos])
                parts.append(cell_copy)
    
    print(f"[3D-XCELL] Generated {len(parts)} cells")
    
    if not parts:
        return trimesh.Trimesh()
    
    lattice = trimesh.util.concatenate(parts)
    lattice.merge_vertices()
    
    print(f"[3D-XCELL] Lattice: {len(lattice.vertices)} verts, {len(lattice.faces)} faces")
    
    return lattice


def generate_perforated_top_skin(
    cell_centers: list,
    cell_size: float,
    top_interp,
    top_skin: float,
    outline_path,
    outline_points: np.ndarray,
    hole_ratio: float = 0.45
) -> trimesh.Trimesh:
    """
    Build an open perforated top skin with diamond-like openings.
    """
    if not cell_centers:
        return trimesh.Trimesh()

    hole_size = cell_size * hole_ratio
    frame_width = max(0.12, (cell_size - hole_size) / 2.0)
    diag_length = float(cell_size * np.sqrt(2.0))
    all_parts = []

    for cx, cy in cell_centers:
        if not outline_path.contains_points([[cx, cy]])[0]:
            continue
        z_top = float(top_interp([[cx, cy]])[0])
        z_mid = z_top - top_skin * 0.5

        rib_pos = trimesh.creation.box([diag_length, frame_width, top_skin])
        rib_pos.apply_transform(
            trimesh.transformations.rotation_matrix(np.radians(45.0), [0, 0, 1])
        )
        rib_pos.apply_translation([cx, cy, z_mid])
        all_parts.append(rib_pos)

        rib_neg = trimesh.creation.box([diag_length, frame_width, top_skin])
        rib_neg.apply_transform(
            trimesh.transformations.rotation_matrix(np.radians(-45.0), [0, 0, 1])
        )
        rib_neg.apply_translation([cx, cy, z_mid])
        all_parts.append(rib_neg)

    if not all_parts:
        return trimesh.Trimesh()

    skin = trimesh.util.concatenate(all_parts)
    skin.merge_vertices(digits_vertex=4)
    skin.update_faces(skin.nondegenerate_faces())
    skin.remove_unreferenced_vertices()
    skin.fix_normals()
    return skin



def extract_top_surface(mesh: trimesh.Trimesh, threshold: float = 0.5) -> trimesh.Trimesh:
    """
    Extract top faces based on face normals pointing to +Z.
    """
    normals = mesh.face_normals
    top_mask = normals[:, 2] > threshold
    return mesh.submesh([top_mask], append=True)


def extract_bottom_surface(mesh: trimesh.Trimesh, threshold: float = -0.5) -> trimesh.Trimesh:
    """
    Extract bottom faces based on face normals pointing to -Z.
    """
    normals = mesh.face_normals
    bottom_mask = normals[:, 2] < threshold
    return mesh.submesh([bottom_mask], append=True)


def _get_oriented_boundary_edges(mesh: trimesh.Trimesh) -> List[tuple]:
    """
    Return boundary edges with orientation based on face winding.
    """
    if len(mesh.faces) == 0:
        return []

    edge_count = {}
    edge_oriented = {}

    for face in mesh.faces:
        edges = [
            (int(face[0]), int(face[1])),
            (int(face[1]), int(face[2])),
            (int(face[2]), int(face[0])),
        ]
        for edge in edges:
            key = tuple(sorted(edge))
            edge_count[key] = edge_count.get(key, 0) + 1
            if key not in edge_oriented:
                edge_oriented[key] = edge

    boundary_edges = [
        edge_oriented[key] for key, count in edge_count.items() if count == 1
    ]
    return boundary_edges


def create_rim_between_surfaces(
    outer_surface: trimesh.Trimesh,
    inner_surface: trimesh.Trimesh,
    xy_decimals: int = 6
) -> trimesh.Trimesh:
    """
    Create a triangle strip rim between outer and inner boundary edges.
    """
    if len(outer_surface.vertices) == 0 or len(inner_surface.vertices) == 0:
        return trimesh.Trimesh()

    boundary_edges = _get_oriented_boundary_edges(outer_surface)
    if not boundary_edges:
        return trimesh.Trimesh()

    inner_lookup = {}
    for idx, v in enumerate(inner_surface.vertices):
        key = (round(float(v[0]), xy_decimals), round(float(v[1]), xy_decimals))
        if key not in inner_lookup:
            inner_lookup[key] = idx

    outer_to_inner = {}
    for idx, v in enumerate(outer_surface.vertices):
        key = (round(float(v[0]), xy_decimals), round(float(v[1]), xy_decimals))
        if key in inner_lookup:
            outer_to_inner[idx] = inner_lookup[key]

    offset = len(outer_surface.vertices)
    rim_faces = []

    for i, j in boundary_edges:
        if i not in outer_to_inner or j not in outer_to_inner:
            continue
        i_inner = offset + outer_to_inner[i]
        j_inner = offset + outer_to_inner[j]
        rim_faces.append([i, j, j_inner])
        rim_faces.append([i, j_inner, i_inner])

    if not rim_faces:
        return trimesh.Trimesh()

    rim_vertices = np.vstack([outer_surface.vertices, inner_surface.vertices])
    rim_mesh = trimesh.Trimesh(vertices=rim_vertices, faces=np.array(rim_faces))
    rim_mesh.update_faces(rim_mesh.nondegenerate_faces())
    rim_mesh.merge_vertices()
    rim_mesh.fix_normals()
    return rim_mesh


def build_shell_mesh(
    mesh: trimesh.Trimesh,
    top_skin: float,
    bottom_skin: float,
    threshold: float = 0.5
) -> trimesh.Trimesh:
    """
    Build a shell mesh by offsetting top and bottom surfaces and keeping side faces.
    """
    top_outer = extract_top_surface(mesh, threshold=threshold)
    bottom_outer = extract_bottom_surface(mesh, threshold=-threshold)

    top_inner = trimesh.Trimesh()
    if len(top_outer.vertices) > 0:
        top_inner = top_outer.copy()
        top_inner.vertices = top_inner.vertices.copy()
        top_inner.vertices[:, 2] -= top_skin
        top_inner.invert()

    bottom_inner = trimesh.Trimesh()
    if len(bottom_outer.vertices) > 0:
        bottom_inner = bottom_outer.copy()
        bottom_inner.vertices = bottom_inner.vertices.copy()
        bottom_inner.vertices[:, 2] += bottom_skin
        bottom_inner.invert()

    normals = mesh.face_normals
    side_mask = (normals[:, 2] >= -threshold) & (normals[:, 2] <= threshold)
    side_surface = mesh.submesh([side_mask], append=True)

    top_rim = create_rim_between_surfaces(top_outer, top_inner)
    bottom_rim = create_rim_between_surfaces(bottom_outer, bottom_inner)

    parts = [
        part for part in [
            top_outer,
            top_inner,
            bottom_outer,
            bottom_inner,
            side_surface,
            top_rim,
            bottom_rim,
        ]
        if len(part.vertices) > 0
    ]
    if not parts:
        return trimesh.Trimesh()

    shell_mesh = trimesh.util.concatenate(parts)
    shell_mesh.merge_vertices()
    shell_mesh.update_faces(shell_mesh.nondegenerate_faces())
    shell_mesh.merge_vertices()
    shell_mesh.fix_normals()

    # Watertight check only (no repair) to avoid heavy processing.
    if not shell_mesh.is_watertight:
        print("[3D-XCELL] Warning: Shell not watertight")
        # trimesh.repair.fill_holes(shell_mesh)  # disabled due to performance
    print(f"[3D-XCELL] Shell watertight: {shell_mesh.is_watertight}")

    return shell_mesh


def _smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    if edge1 <= edge0:
        return np.zeros_like(x)
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _field_touches_boundary(field: np.ndarray) -> bool:
    if field.size == 0:
        return False
    return (
        np.any(field[0, :, :] <= 0.0)
        or np.any(field[-1, :, :] <= 0.0)
        or np.any(field[:, 0, :] <= 0.0)
        or np.any(field[:, -1, :] <= 0.0)
        or np.any(field[:, :, 0] <= 0.0)
        or np.any(field[:, :, -1] <= 0.0)
    )


def _extract_boundary_mesh_from_voxels(
    solid_mask: np.ndarray,
    pitch: float,
    origin: np.ndarray
) -> trimesh.Trimesh:
    """
    Build a voxel boundary mesh from a 3D boolean occupancy mask.
    Used as a fallback when marching cubes backend is unavailable.
    """
    if not np.any(solid_mask):
        return trimesh.Trimesh()

    vertices: List[List[float]] = []
    faces: List[List[int]] = []

    def add_quad(v0, v1, v2, v3):
        base = len(vertices)
        vertices.extend([v0, v1, v2, v3])
        faces.append([base, base + 1, base + 2])
        faces.append([base, base + 2, base + 3])

    nx, ny, nz = solid_mask.shape
    filled = np.argwhere(solid_mask)
    half = pitch * 0.5

    for i, j, k in filled:
        cx = origin[0] + i * pitch
        cy = origin[1] + j * pitch
        cz = origin[2] + k * pitch

        x0, x1 = cx - half, cx + half
        y0, y1 = cy - half, cy + half
        z0, z1 = cz - half, cz + half

        if i == nx - 1 or not solid_mask[i + 1, j, k]:
            add_quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1])
        if i == 0 or not solid_mask[i - 1, j, k]:
            add_quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0])
        if j == ny - 1 or not solid_mask[i, j + 1, k]:
            add_quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0])
        if j == 0 or not solid_mask[i, j - 1, k]:
            add_quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1])
        if k == nz - 1 or not solid_mask[i, j, k + 1]:
            add_quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1])
        if k == 0 or not solid_mask[i, j, k - 1]:
            add_quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0])

    mesh = trimesh.Trimesh(vertices=np.asarray(vertices), faces=np.asarray(faces), process=False)
    mesh.merge_vertices(digits_vertex=4)
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.remove_unreferenced_vertices()
    mesh.fix_normals()
    return mesh


def _extract_iso_surface(
    field: np.ndarray,
    pitch: float,
    origin: np.ndarray
) -> trimesh.Trimesh:
    """
    Extract zero-isosurface from scalar field.
    Uses skimage marching cubes when available, otherwise voxel boundary fallback.
    """
    dev_fallback = os.environ.get("MASACAD_DEV_FALLBACK", "0") == "1"
    try:
        from skimage.measure import marching_cubes
    except Exception as e:
        if not dev_fallback:
            raise RuntimeError(
                f"skimage is required for production TPMS extraction (set MASACAD_DEV_FALLBACK=1 only for dev): {e}"
            ) from e
        print(f"[3D-XCELL] marching_cubes unavailable ({e}); dev fallback enabled")
        mesh = _extract_boundary_mesh_from_voxels(field <= 0.0, pitch=pitch, origin=origin)
        mesh.metadata["extraction"] = "voxel_boundary"
    else:
        verts, faces, _, _ = marching_cubes(field, level=0.0, spacing=(pitch, pitch, pitch))
        verts += origin
        mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
        mesh.metadata["extraction"] = "marching_cubes"

    if len(mesh.vertices) == 0:
        return mesh

    mesh.merge_vertices(digits_vertex=4)
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.remove_unreferenced_vertices()
    mesh.fix_normals()
    return mesh


def _build_3d_xcell_lattice_components(
    base_mesh: trimesh.Trimesh,
    cell_size: float = 4.0,
    strut_radius: float = 0.4,
    skin_thickness: float = 0.5,
    progress_callback: callable = None,
    lattice_only: bool = False
) -> Tuple[Optional[trimesh.Trimesh], Optional[trimesh.Trimesh], Dict, Optional[trimesh.Trimesh]]:
    """
    Build lattice and shell components without combining them.
    """
    # Skin thickness is fixed by UI requirement.
    top_skin = skin_thickness
    bottom_skin = skin_thickness
    from matplotlib.path import Path as MplPath
    from scipy.spatial import ConvexHull
    from scipy.interpolate import LinearNDInterpolator
    from core.geometry_v4 import generate_hollow_shell
    
    print(f"[3D-XCELL] === 3D X-Cell Lattice v4.1 (Ventilation) ===")
    print(f"[3D-XCELL] Cell size: {cell_size}mm, Strut radius: {strut_radius}mm")
    print(f"[3D-XCELL] Skin thickness: {skin_thickness}mm")
    
    bounds = base_mesh.bounds
    mesh_size = bounds[1] - bounds[0]
    print(f"[3D-XCELL] Insole size: {mesh_size[0]:.1f} x {mesh_size[1]:.1f} x {mesh_size[2]:.1f} mm")
    
    mesh_verts = base_mesh.vertices
    mesh_faces = base_mesh.faces
    mesh = base_mesh
    
    x_min, y_min, z_min = bounds[0]
    x_max, y_max, z_max = bounds[1]
    
    # 1. 繧､繝ｳ繧ｽ繝ｼ繝ｫ縺ｮ荳企擇縺ｨ荳矩擇縺ｮ鬮倥＆繝槭ャ繝励ｒ菴懈・
    if progress_callback:
        progress_callback("Building surface height maps...", 10)
    print(f"[3D-XCELL] Step 1: Build surface height maps...")
    
    # 繧ｵ繝ｳ繝励Μ繝ｳ繧ｰ隗｣蜒丞ｺｦ: 繧ｻ繝ｫ繧ｵ繧､繧ｺ縺ｮ1/4縺・.0mm縺ｮ蟆上＆縺・婿・育ｲｾ蠎ｦ蜷台ｸ奇ｼ・
    sample_step = min(cell_size / 6, 0.5)
    print(f"[3D-XCELL]   Sample step: {sample_step:.2f}mm")
    
    xy_to_z = {}
    for v in mesh_verts:
        key = (round(v[0] / sample_step) * sample_step, 
               round(v[1] / sample_step) * sample_step)
        if key not in xy_to_z:
            xy_to_z[key] = []
        xy_to_z[key].append(v[2])
    
    top_heights = {}
    bottom_heights = {}
    for key, z_vals in xy_to_z.items():
        top_heights[key] = max(z_vals)
        bottom_heights[key] = min(z_vals)
    
    print(f"[3D-XCELL]   Height samples: {len(top_heights)}")
    
    # 陬憺俣髢｢謨ｰ繧剃ｽ懈・
    if len(top_heights) > 3:
        xy_points = np.array(list(top_heights.keys()))
        top_z = np.array([top_heights[tuple(p)] for p in xy_points])
        bottom_z = np.array([bottom_heights[tuple(p)] for p in xy_points])
        
        try:
            top_interp = LinearNDInterpolator(xy_points, top_z, fill_value=z_max)
            bottom_interp = LinearNDInterpolator(xy_points, bottom_z, fill_value=z_min)
        except Exception as e:
            print(f"[3D-XCELL] Interpolation failed: {e}")
            top_interp = lambda pts: np.full(len(pts), z_max)
            bottom_interp = lambda pts: np.full(len(pts), z_min)
    else:
        top_interp = lambda pts: np.full(len(pts), z_max)
        bottom_interp = lambda pts: np.full(len(pts), z_min)
    
    # 2. 繧､繝ｳ繧ｽ繝ｼ繝ｫ縺ｮ2D霈ｪ驛ｭ繧呈歓蜃ｺ・亥・蠖｢迥ｶ繧よｭ｣遒ｺ縺ｫ蜃ｦ逅・ｼ・
    if progress_callback:
        progress_callback("Extracting insole outline...", 20)
    print(f"[3D-XCELL] Step 2: Extract insole outline...")
    
    outline_points = None
    
    # 譁ｹ豕・: 繝｡繝・す繝･縺ｮ蠎暮擇蠅・阜繧ｨ繝・ず縺九ｉ霈ｪ驛ｭ繧呈歓蜃ｺ・域怙繧よｭ｣遒ｺ・・
    try:
        from collections import Counter, defaultdict
        
        # Z=0莉倩ｿ代・蠎暮擇縺ｮ髱｢繧貞叙蠕・
        face_mask = np.all(mesh_verts[mesh_faces][:, :, 2] < z_min + 0.5, axis=1)
        bottom_faces = mesh_faces[face_mask]
        
        if len(bottom_faces) > 0:
            # 蠎暮擇縺ｮ繧ｨ繝・ず繧偵き繧ｦ繝ｳ繝茨ｼ亥｢・阜繧ｨ繝・ず縺ｯ1蝗槭・縺ｿ蜃ｺ迴ｾ・・
            edges = Counter()
            for face in bottom_faces:
                for i in range(3):
                    edge = tuple(sorted([face[i], face[(i+1)%3]]))
                    edges[edge] += 1
            
            boundary_edges = [e for e, count in edges.items() if count == 1]
            
            if len(boundary_edges) > 3:
                # 髫｣謗･繝ｪ繧ｹ繝医ｒ讒狗ｯ・
                adj = defaultdict(list)
                for e in boundary_edges:
                    adj[e[0]].append(e[1])
                    adj[e[1]].append(e[0])
                
                # 髢峨§縺溘ヱ繧ｹ繧偵ヨ繝ｬ繝ｼ繧ｹ・域怙螟ｧ繝ｫ繝ｼ繝励ｒ隕九▽縺代ｋ・・
                start = boundary_edges[0][0]
                path = [start]
                visited = {start}
                current = start
                
                while True:
                    neighbors = [n for n in adj[current] if n not in visited]
                    if not neighbors:
                        # 繝ｫ繝ｼ繝励ｒ髢峨§繧峨ｌ繧九°繝√ぉ繝・け
                        if adj[current] and start in adj[current]:
                            break  # 繝ｫ繝ｼ繝怜ｮ御ｺ・
                        break
                    current = neighbors[0]
                    path.append(current)
                    visited.add(current)
                
                if len(path) > 3:
                    outline_points = mesh_verts[path][:, :2]
                    outline_points = np.vstack([outline_points, outline_points[0]])
                    print(f"[3D-XCELL]   Outline extracted from mesh boundary edges")
    except Exception as e:
        print(f"[3D-XCELL]   Mesh boundary extraction failed: {e}")
    
    # 譁ｹ豕・: 蠎暮擇鬆らせ縺九ｉDelaunay蠅・阜繧呈歓蜃ｺ・医ヵ繧ｩ繝ｼ繝ｫ繝舌ャ繧ｯ・・
    if outline_points is None:
        try:
            from scipy.spatial import Delaunay
            from collections import Counter
            
            bottom_mask = mesh_verts[:, 2] < z_min + 1.0
            bottom_verts_2d = mesh_verts[bottom_mask][:, :2]
            
            if len(bottom_verts_2d) < 10:
                bottom_verts_2d = mesh_verts[:, :2]
            
            tri = Delaunay(bottom_verts_2d)
            
            edges = Counter()
            for simplex in tri.simplices:
                for i in range(3):
                    edge = tuple(sorted([simplex[i], simplex[(i+1)%3]]))
                    edges[edge] += 1
            
            boundary_edges = [edge for edge, count in edges.items() if count == 1]
            
            if len(boundary_edges) > 3:
                adj = defaultdict(list)
                for e in boundary_edges:
                    adj[e[0]].append(e[1])
                    adj[e[1]].append(e[0])
                
                start = boundary_edges[0][0]
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
                
                if len(path) > 3:
                    outline_points = bottom_verts_2d[path]
                    outline_points = np.vstack([outline_points, outline_points[0]])
                    print(f"[3D-XCELL]   Outline extracted from Delaunay boundary")
        except Exception as e:
            print(f"[3D-XCELL]   Delaunay boundary extraction failed: {e}")
    
    # 譁ｹ豕・: ConvexHull・域怙蠕後・繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ - 蜃ｹ蠖｢迥ｶ縺ｧ縺ｯ荳肴ｭ｣遒ｺ・・
    if outline_points is None:
        try:
            bottom_mask = mesh_verts[:, 2] < z_min + 1.0
            bottom_verts_2d = mesh_verts[bottom_mask][:, :2]
            if len(bottom_verts_2d) < 10:
                bottom_verts_2d = mesh_verts[:, :2]
            
            hull = ConvexHull(bottom_verts_2d)
            outline_points = bottom_verts_2d[hull.vertices]
            outline_points = np.vstack([outline_points, outline_points[0]])
            print(f"[3D-XCELL]   WARNING: Using ConvexHull fallback (may not handle concave shapes)")
        except Exception as e:
            print(f"[3D-XCELL]   ConvexHull failed: {e}")
            outline_points = np.array([
                [x_min, y_min], [x_max, y_min], 
                [x_max, y_max], [x_min, y_max], [x_min, y_min]
            ])
            print(f"[3D-XCELL]   Using bounding box as outline")
    
    outline_path = MplPath(outline_points)
    print(f"[3D-XCELL]   Outline points: {len(outline_points)}")

    # 2.5 Inner outline for lattice clipping
    if progress_callback:
        progress_callback("Generating inner outline and hollow shell...", 30)
    wall_thickness = 0.8
    inner_outline_points = outline_points
    try:
        from shapely.geometry import Polygon
        outline = np.array(outline_points, dtype=float)
        if np.allclose(outline[0], outline[-1]):
            outline = outline[:-1]
        polygon = Polygon(outline)
        inner_polygon = polygon.buffer(-wall_thickness)
        if not inner_polygon.is_empty:
            if inner_polygon.geom_type == "MultiPolygon":
                inner_polygon = max(inner_polygon.geoms, key=lambda p: p.area)
            inner_outline_points = np.array(inner_polygon.exterior.coords)
    except Exception as e:
        print(f"[3D-XCELL]   Inner outline offset failed: {e}")

    inner_outline_path = MplPath(inner_outline_points)

    # 2.6 Hollow shell from boolean difference
    # Pass the original mesh to avoid regenerating outer solid
    hollow_shell, inner_volume = generate_hollow_shell(
        outline_points=outline_points,
        top_height_map=top_heights,
        bottom_height_map=bottom_heights,
        wall_thickness=wall_thickness,
        top_skin=top_skin,
        bottom_skin=bottom_skin,
        outer_mesh=base_mesh  # Reuse existing watertight mesh
    )
    if len(inner_volume.vertices) == 0:
        inner_outline_path = outline_path


    # 3. Kelvin-like strut SDF with 110+111 directions and continuous grading
    if progress_callback:
        progress_callback("Building Kelvin-like strut SDF...", 60)

    print(f"[3D-XCELL] Step 3: Building Kelvin-like strut SDF...")
    k_fillet = 0.6
    r_surface = 0.55
    r_inner = 0.85
    transition_depth = 6.0
    cell_surface = 14.0
    cell_inner = 10.0
    lattice_param_msg = (
        f"kelvinlike_strut_sdf params: k_fillet={k_fillet:.2f}, "
        f"r_surface={r_surface:.2f}, r_inner={r_inner:.2f}, "
        f"cell_surface={cell_surface:.2f}, cell_inner={cell_inner:.2f}, "
        f"transition_depth={transition_depth:.2f}"
    )
    print(f"[3D-XCELL]   {lattice_param_msg}")

    def _failure_return(message: str, extra_messages: Optional[List[str]] = None):
        fallback_mesh = hollow_shell if len(hollow_shell.vertices) > 0 else base_mesh
        if fallback_mesh is None or len(getattr(fallback_mesh, 'vertices', [])) == 0:
            fallback_mesh = base_mesh
        messages = list(extra_messages or [])
        messages.append(message)
        info = {
            'success': False,
            'cells_generated': 0,
            'skip_reasons': {'center_outside': 0, 'corners_outside': 0, 'height_insufficient': 0},
            'messages': messages
        }
        return None, hollow_shell, info, fallback_mesh

    try:
        from skimage.measure import marching_cubes  # noqa: F401
    except Exception as e:
        if os.environ.get("MASACAD_DEV_FALLBACK", "0") != "1":
            raise RuntimeError(f"skimage is required for Kelvin-like strut extraction: {e}") from e

    def _smooth_min(a: np.ndarray, b: np.ndarray, k: float) -> np.ndarray:
        h = np.clip(0.5 + 0.5 * (b - a) / max(k, 1e-6), 0.0, 1.0)
        return a * h + b * (1.0 - h) - k * h * (1.0 - h)

    def _segment_distance_batch(points_batch: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        # points_batch: (M,3), a/b: (N,3) -> distances (M,N)
        ab = b - a
        ab2 = np.sum(ab * ab, axis=1) + 1e-8
        ap = points_batch[:, None, :] - a[None, :, :]
        t = np.sum(ap * ab[None, :, :], axis=2) / ab2[None, :]
        t = np.clip(t, 0.0, 1.0)
        q = a[None, :, :] + t[:, :, None] * ab[None, :, :]
        d = np.linalg.norm(points_batch[:, None, :] - q, axis=2)
        return d.astype(np.float32, copy=False)

    def _build_segments_dense(period: float) -> Tuple[np.ndarray, np.ndarray]:
        pad = 2.0 * period
        xs = np.arange(x_min - pad, x_max + pad + period, period, dtype=np.float32)
        ys = np.arange(y_min - pad, y_max + pad + period, period, dtype=np.float32)
        zs = np.arange(z_min - pad, z_max + pad + period, period, dtype=np.float32)
        cx, cy, cz = np.meshgrid(xs, ys, zs, indexing='ij')
        centers = np.stack([cx.ravel(), cy.ravel(), cz.ravel()], axis=1)
        dirs110 = np.array([
            [1, 1, 0],
            [1, -1, 0],
            [1, 0, 1],
            [1, 0, -1],
            [0, 1, 1],
            [0, 1, -1],
        ], dtype=np.float32)
        dirs111 = np.array([
            [1, 1, 1],
            [1, 1, -1],
            [1, -1, 1],
            [-1, 1, 1],
        ], dtype=np.float32)
        dirs = np.vstack([dirs110, dirs111]) * np.float32(period)
        a = np.repeat(centers, len(dirs), axis=0)
        b = a + np.tile(dirs, (len(centers), 1))
        return a.astype(np.float32, copy=False), b.astype(np.float32, copy=False)

    def _build_spatial_hash(seg_a: np.ndarray, seg_b: np.ndarray, hash_size: float, inflate: float):
        origin = np.array([x_min, y_min, z_min], dtype=np.float32) - np.float32(2.0 * hash_size)
        seg_map: Dict[tuple, List[int]] = {}
        min_bb = np.minimum(seg_a, seg_b) - np.float32(inflate)
        max_bb = np.maximum(seg_a, seg_b) + np.float32(inflate)
        ijk_min = np.floor((min_bb - origin) / hash_size).astype(np.int32)
        ijk_max = np.floor((max_bb - origin) / hash_size).astype(np.int32)
        for i in range(len(seg_a)):
            ax, ay, az = ijk_min[i]
            bx, by, bz = ijk_max[i]
            for ix in range(ax, bx + 1):
                for iy in range(ay, by + 1):
                    for iz in range(az, bz + 1):
                        key = (int(ix), int(iy), int(iz))
                        seg_map.setdefault(key, []).append(i)
        seg_map_np: Dict[tuple, np.ndarray] = {}
        for k, v in seg_map.items():
            seg_map_np[k] = np.asarray(v, dtype=np.int64)
        return origin, seg_map_np

    pitch = float(max(0.6, min(0.8, cell_size / 12.0)))
    x_vals = np.arange(x_min, x_max + 0.5 * pitch, pitch, dtype=np.float32)
    y_vals = np.arange(y_min, y_max + 0.5 * pitch, pitch, dtype=np.float32)
    z_vals = np.arange(z_min, z_max + 0.5 * pitch, pitch, dtype=np.float32)
    if len(x_vals) < 4 or len(y_vals) < 4 or len(z_vals) < 4:
        return _failure_return("Sampling grid too small", extra_messages=[lattice_param_msg])

    voxels = int(len(x_vals) * len(y_vals) * len(z_vals))
    runtime_estimate = (
        "runtime_estimate=~2-6min" if voxels < 2_500_000
        else "runtime_estimate=~6-14min" if voxels < 6_000_000
        else "runtime_estimate=~14-25min"
    )
    print(f"[3D-XCELL]   Grid: {len(x_vals)} x {len(y_vals)} x {len(z_vals)} voxels={voxels}")
    print(f"[3D-XCELL]   pitch={pitch:.3f}, {runtime_estimate}")

    if progress_callback:
        progress_callback("Preparing insole masks...", 70)
    print(f"[3D-XCELL] Step 4: Preparing distance/mask...")

    xg, yg, zg = np.meshgrid(x_vals, y_vals, z_vals, indexing='ij')
    points = np.stack([xg.ravel(), yg.ravel(), zg.ravel()], axis=1).astype(np.float32, copy=False)

    try:
        from trimesh.proximity import ProximityQuery
        pq = ProximityQuery(base_mesh)
        signed = pq.signed_distance(points)
        if signed is None or len(signed) != points.shape[0]:
            raise RuntimeError("signed_distance failed")
        signed = np.asarray(signed, dtype=np.float32)
        inside_flat = signed <= 0.0
        dist_surface = np.abs(signed)
    except Exception as e:
        print(f"[3D-XCELL]   signed_distance unavailable, fallback mask: {e}")
        xx2d, yy2d = np.meshgrid(x_vals, y_vals, indexing='ij')
        xy_flat = np.stack([xx2d.ravel(), yy2d.ravel()], axis=1)
        inside_xy = inner_outline_path.contains_points(xy_flat).reshape(xx2d.shape)
        top_grid = np.asarray(top_interp(xy_flat), dtype=np.float32).reshape(xx2d.shape)
        bottom_grid = np.asarray(bottom_interp(xy_flat), dtype=np.float32).reshape(xx2d.shape)
        inside = np.logical_and(
            inside_xy[:, :, None],
            np.logical_and(zg >= bottom_grid[:, :, None], zg <= top_grid[:, :, None])
        )
        inside_flat = inside.ravel()
        dist_surface = np.minimum(
            np.abs(top_grid[:, :, None].ravel() - points[:, 2]),
            np.abs(points[:, 2] - bottom_grid[:, :, None].ravel())
        ).astype(np.float32, copy=False)

    w = _smoothstep(0.0, transition_depth, dist_surface)
    radius_p = (r_surface * (1.0 - w) + r_inner * w).astype(np.float32, copy=False)
    cell_p = (cell_surface * (1.0 - w) + cell_inner * w).astype(np.float32, copy=False)

    seg_a, seg_b = _build_segments_dense(cell_inner)
    seg_mid = (seg_a + seg_b) * 0.5
    seg_bb_min = np.minimum(seg_a, seg_b).astype(np.float32, copy=False)
    seg_bb_max = np.maximum(seg_a, seg_b).astype(np.float32, copy=False)
    r_max = float(r_inner + k_fillet + 1.0)
    hash_size = float(cell_inner)
    hash_origin, seg_hash = _build_spatial_hash(seg_a, seg_b, hash_size, inflate=r_max)

    inside_idx = np.where(inside_flat)[0]
    if len(inside_idx) == 0:
        return _failure_return("No inside voxels for lattice domain", extra_messages=[lattice_param_msg])

    if progress_callback:
        progress_callback("Evaluating Kelvin-like segment SDF...", 75)
    print(f"[3D-XCELL] Step 5: Evaluating segment field with spatial pruning...")

    # Group inside points by hash cell for candidate pruning.
    p_inside = points[inside_idx]
    p_cell = np.floor((p_inside - hash_origin[None, :]) / hash_size).astype(np.int32)
    cell_keys, inv = np.unique(p_cell, axis=0, return_inverse=True)
    point_groups: Dict[tuple, np.ndarray] = {}
    for gi in range(len(cell_keys)):
        point_groups[(int(cell_keys[gi, 0]), int(cell_keys[gi, 1]), int(cell_keys[gi, 2]))] = np.where(inv == gi)[0]

    field_inside = np.full(len(inside_idx), np.float32(2.0), dtype=np.float32)
    total_candidates = 0
    min_candidates = 10**9
    max_candidates = 0
    groups_count = 0

    for key, local_list in point_groups.items():
        groups_count += 1
        cand = seg_hash.get(key, None)
        if cand is None or len(cand) == 0:
            continue

        # Early exclusion: if point-to-segment-AABB distance > R_max for all points, skip that segment.
        li = np.asarray(local_list, dtype=np.int64)
        p_batch = p_inside[li]
        bb_min = seg_bb_min[cand]
        bb_max = seg_bb_max[cand]
        delta_low = np.maximum(bb_min[None, :, :] - p_batch[:, None, :], 0.0)
        delta_high = np.maximum(p_batch[:, None, :] - bb_max[None, :, :], 0.0)
        delta = delta_low + delta_high
        d_aabb = np.sqrt(np.sum(delta * delta, axis=2))
        cand_keep = np.any(d_aabb <= np.float32(r_max), axis=0)
        if not np.any(cand_keep):
            continue
        cand = cand[cand_keep]

        cand_n = int(len(cand))
        total_candidates += cand_n
        min_candidates = min(min_candidates, cand_n)
        max_candidates = max(max_candidates, cand_n)

        p_batch = p_inside[li]
        r_batch = radius_p[inside_idx[li]]
        cell_batch = cell_p[inside_idx[li]]

        a = seg_a[cand]
        b = seg_b[cand]
        dmat = _segment_distance_batch(p_batch, a, b)

        # Local cell-size driven influence gating (single network, continuous behavior).
        mid = seg_mid[cand]
        dmid = np.linalg.norm(p_batch[:, None, :] - mid[None, :, :], axis=2).astype(np.float32, copy=False)
        keep = dmid <= (1.6 * cell_batch[:, None] + 2.0 * r_batch[:, None] + k_fillet)
        dmat[~keep] = np.float32(1e6)

        f = dmat - r_batch[:, None]
        val = f[:, 0]
        for j in range(1, f.shape[1]):
            val = _smooth_min(val, f[:, j], k_fillet)
        field_inside[li] = val.astype(np.float32, copy=False)

    if groups_count == 0:
        return _failure_return("No hash groups evaluated", extra_messages=[lattice_param_msg])

    avg_candidates = float(total_candidates) / float(max(1, groups_count))
    avg_candidates_per_voxel = float(total_candidates) / float(max(1, len(inside_idx)))
    if min_candidates == 10**9:
        min_candidates = 0
    pruned_stats = (
        f"candidates_pruned_stats=min={min_candidates},avg={avg_candidates:.1f},"
        f"max={max_candidates},groups={groups_count}"
    )

    field_flat = np.full(points.shape[0], np.float32(2.0), dtype=np.float32)
    field_flat[inside_idx] = field_inside
    masked_field = field_flat.reshape(xg.shape)
    masked_field[~inside_flat.reshape(xg.shape)] = np.float32(2.0)

    if progress_callback:
        progress_callback("Extracting isosurface...", 85)
    print(f"[3D-XCELL] Step 6: Extracting Kelvin-like isosurface...")
    try:
        lattice = _extract_iso_surface(
            masked_field,
            pitch=pitch,
            origin=np.array([x_vals[0], y_vals[0], z_vals[0]], dtype=np.float32)
        )
    except Exception as e:
        return _failure_return(f"Kelvin-like extraction failed: {e}", extra_messages=[lattice_param_msg, pruned_stats])

    if lattice is None or len(getattr(lattice, 'vertices', [])) == 0:
        return _failure_return("Kelvin-like extraction returned empty mesh", extra_messages=[lattice_param_msg, pruned_stats])

    faces_before = len(lattice.faces)
    lattice.merge_vertices(digits_vertex=4)
    try:
        lattice.remove_duplicate_faces()
    except Exception:
        pass
    try:
        lattice.remove_degenerate_faces()
    except Exception:
        pass
    faces_after_degen = len(lattice.faces)
    lattice.remove_unreferenced_vertices()
    lattice.fix_normals()

    invalid_vertices = (not np.isfinite(lattice.vertices).all()) if len(lattice.vertices) > 0 else True
    faces_after = len(lattice.faces)
    degen_loss_ratio = float(max(0, faces_before - faces_after_degen)) / float(max(1, faces_before))
    zero_area_faces = False
    try:
        af = np.asarray(lattice.area_faces)
        zero_area_faces = bool(np.any((~np.isfinite(af)) | (af <= 1e-12)))
    except Exception:
        zero_area_faces = True
    bounds_finite = bool(np.isfinite(lattice.bounds).all()) if len(lattice.vertices) > 0 else False

    printable_ok = (
        (not invalid_vertices)
        and (faces_after > 2000)
        and (degen_loss_ratio < 0.25)
        and (not zero_area_faces)
        and bounds_finite
    )
    if not printable_ok:
        reasons = []
        if invalid_vertices:
            reasons.append("nan_or_inf_vertices")
        if faces_after <= 2000:
            reasons.append("too_few_faces")
        if degen_loss_ratio >= 0.25:
            reasons.append(f"degen_loss_ratio={degen_loss_ratio:.3f}")
        if zero_area_faces:
            reasons.append("zero_area_faces")
        if not bounds_finite:
            reasons.append("non_finite_bounds")
        return _failure_return(
            "printable validation failed: " + ",".join(reasons),
            extra_messages=[lattice_param_msg, pruned_stats, f"watertight_info={lattice.is_watertight}"]
        )

    nx_cells = int(np.ceil((x_max - x_min) / max(cell_inner, 1e-6)))
    ny_cells = int(np.ceil((y_max - y_min) / max(cell_inner, 1e-6)))
    nz_cells = int(np.ceil((z_max - z_min) / max(cell_inner, 1e-6)))
    cells_generated = nx_cells * ny_cells * nz_cells

    print(f"[3D-XCELL]   Lattice: {len(lattice.vertices)} verts, {len(lattice.faces)} faces")
    print(f"[3D-XCELL]   Lattice watertight: {lattice.is_watertight}")

    info = {
        'success': True,
        'cells_generated': cells_generated,
        'open_skin_mode': True,
        'skip_reasons': {'center_outside': 0, 'corners_outside': 0, 'height_insufficient': 0},
        'messages': [
            'lattice_type=KelvinLike_strut_SDF_110+111',
            f'k_fillet={k_fillet}',
            f'cell_surface={cell_surface}, cell_inner={cell_inner}, transition_depth={transition_depth}',
            f'r_surface={r_surface}, r_inner={r_inner}',
            'optimization=spatial_hash_enabled',
            f'total_segments={len(seg_a)}',
            f'avg_candidates_per_voxel={avg_candidates_per_voxel:.2f}',
            f'pitch={pitch:.3f}',
            runtime_estimate,
            pruned_stats,
            f'mesh_vertices={len(lattice.vertices)}',
            f'mesh_faces={len(lattice.faces)}',
            f'watertight_ref={lattice.is_watertight}',
            'printable_validation=OK'
        ]
    }
    return lattice, hollow_shell, info, None




def apply_3d_xcell_lattice(
    base_mesh: trimesh.Trimesh,
    cell_size: float = 4.0,
    strut_radius: float = 0.4,
    skin_thickness: float = 0.5,
    progress_callback: callable = None
) -> Tuple[trimesh.Trimesh, Dict]:
    """
    Apply 3D X-cell lattice and combine with shell.
    """
    lattice, hollow_shell, info, fallback_mesh = _build_3d_xcell_lattice_components(
        base_mesh=base_mesh,
        cell_size=cell_size,
        strut_radius=strut_radius,
        skin_thickness=skin_thickness,
        progress_callback=progress_callback
    )
    if lattice is None:
        return fallback_mesh, info

    if info.get("open_skin_mode", False):
        print("[3D-XCELL] Step 6: Skipped closed-shell union (open-skin mode)")
        return lattice, info

    print(f"[3D-XCELL] Step 6: Combine shell and lattice with manifold...")

    if hollow_shell is base_mesh or (len(hollow_shell.vertices) == len(base_mesh.vertices)):
        print(f"[3D-XCELL] WARNING: Hollow shell generation failed, returning lattice only")
        shell_mesh = None
    else:
        shell_mesh = hollow_shell

    if shell_mesh is None:
        result = lattice
        print(f"[3D-XCELL]   Using lattice only (no shell)")
    else:
        try:
            result = trimesh.boolean.union([shell_mesh, lattice], engine='manifold')
            print(f"[3D-XCELL]   Final mesh watertight: {result.is_watertight}")
        except Exception as e:
            print(f"[3D-XCELL] Final union failed: {e}, using lattice only")
            result = lattice

    print(f"[3D-XCELL] Result: {len(result.vertices)} verts, {len(result.faces)} faces")
    return result, info


def apply_3d_xcell_lattice_only(
    base_mesh: trimesh.Trimesh,
    cell_size: float = 4.0,
    strut_radius: float = 0.4,
    skin_thickness: float = 0.5,
    progress_callback: callable = None
) -> Tuple[trimesh.Trimesh, Dict]:
    """
    Return lattice only without combining it with the shell.
    """
    lattice, _, info, fallback_mesh = _build_3d_xcell_lattice_components(
        base_mesh=base_mesh,
        cell_size=cell_size,
        strut_radius=strut_radius,
        skin_thickness=skin_thickness,
        progress_callback=progress_callback,
        lattice_only=True
    )
    if lattice is None:
        return fallback_mesh, info
    return lattice, info

# =============================================================================
# 繝・せ繝・
# =============================================================================

if __name__ == "__main__":
    print("=" * 60)
    print("3D X-Cell Unit Test")
    print("=" * 60)
    
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    
    # 1. 繝ｦ繝九ャ繝医そ繝ｫ縺ｮ繝・せ繝・
    print("\n--- Unit Cell Test ---")
    
    for size in [3.0, 4.0, 5.0]:
        unit_cell = create_3d_xcell_unit(
            size=size,
            strut_radius=0.4
        )
        print(f"\nSize {size}mm:")
        print(f"  Vertices: {len(unit_cell.vertices)}")
        print(f"  Faces: {len(unit_cell.faces)}")
        print(f"  Watertight: {unit_cell.is_watertight}")
        print(f"  Bounds: {unit_cell.bounds[0]} to {unit_cell.bounds[1]}")
        
        unit_path = EXPORTS_DIR / f"xcell_3d_{size}mm.stl"
        unit_cell.export(str(unit_path))
        print(f"  [SAVED] {unit_path.name}")
    
    # 2. 繝ｩ繝・ぅ繧ｹ繝懊ャ繧ｯ繧ｹ縺ｮ繝・せ繝・
    print("\n--- Lattice Box Test ---")
    
    test_box = trimesh.creation.box(extents=[15, 15, 6])
    test_box.apply_translation([7.5, 7.5, 3])
    
    print(f"Test box: 15x15x6mm")

    result, lattice_info = apply_3d_xcell_lattice(
        test_box,
        cell_size=3.0,
        strut_radius=0.4
    )

    print(f"\nLattice info: {lattice_info}")

    if result and len(result.vertices) > 0:
        print(f"\nResult:")
        print(f"  Vertices: {len(result.vertices)}")
        print(f"  Faces: {len(result.faces)}")
        
        test_path = EXPORTS_DIR / "xcell_3d_lattice_15x15x6.stl"
        result.export(str(test_path))
        print(f"  [SAVED] {test_path.name}")
    
    print("\n" + "=" * 60)
    print("Test Complete!")
    print("=" * 60)


