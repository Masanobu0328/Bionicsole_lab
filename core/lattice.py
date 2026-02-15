"""
MasaCAD Core - 2.5D X-Cell Lattice Module v4.0
Fusion 360スタイルの2.5D Xセル ラティス構造生成

構造分析結果（インソール試作20256月 v3.stl）:
- 45度回転した対角線壁が交差してダイヤモンド形の開口部を形成
- 壁はXY平面上で±45度方向に配置
- Z方向に垂直に立ち上がる
- 上から見るとダイヤモンド型（ひし形）の開口部

修正版 v4.0 (2025-01-14):
- 45度回転した対角線壁に変更
- 参照STLの構造と一致するように修正

Version: 4.0
"""

import numpy as np
import trimesh
from typing import Tuple, List, Optional
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.resolve()
EXPORTS_DIR = PROJECT_ROOT / "exports"


# =============================================================================
# ユニットセル生成（修正版：45度対角線壁）
# =============================================================================

def create_xcell_unit_cell(
    cell_size: float = 3.0,
    cell_height: float = 8.0,
    strut_thickness: float = 0.8,
    top_skin: float = 1.0,
    bottom_skin: float = 1.0
) -> trimesh.Trimesh:
    """
    X-cellユニットセル（原型）を生成
    
    修正版：45度対角線壁でダイヤモンド開口部を形成
    
    構造（上から見た図）:
    
       /\
      /  \
     /    \     <- 対角線壁が交差
     \    /
      \  /
       \/
    
    ダイヤモンド/ひし形の開口部
    
    Args:
        cell_size: セルのXY方向サイズ (mm)
        cell_height: セルの高さ (mm)
        strut_thickness: 壁厚 (mm)
        top_skin: 上面スキン厚 (mm)
        bottom_skin: 底面スキン厚 (mm)
    
    Returns:
        X-cellユニットセルのメッシュ
    """
    parts = []
    
    lattice_height = cell_height - top_skin - bottom_skin
    z_bottom = bottom_skin
    z_mid = z_bottom + lattice_height / 2
    
    half_cell = cell_size / 2
    
    # 対角線の長さ（セルの対角線）
    diagonal_length = cell_size * np.sqrt(2)
    
    # スキン層
    if bottom_skin > 0:
        bottom_box = trimesh.creation.box(
            extents=[cell_size, cell_size, bottom_skin]
        )
        bottom_box.apply_translation([half_cell, half_cell, bottom_skin / 2])
        parts.append(bottom_box)
    
    if top_skin > 0:
        top_box = trimesh.creation.box(
            extents=[cell_size, cell_size, top_skin]
        )
        top_box.apply_translation([half_cell, half_cell, cell_height - top_skin / 2])
        parts.append(top_box)
    
    # 45度対角線壁
    if lattice_height > 0:
        # +45度方向の壁（左下から右上）
        wall1 = trimesh.creation.box(
            extents=[diagonal_length, strut_thickness, lattice_height]
        )
        # 45度回転
        rotation_45 = trimesh.transformations.rotation_matrix(
            np.radians(45), [0, 0, 1]
        )
        wall1.apply_transform(rotation_45)
        wall1.apply_translation([half_cell, half_cell, z_mid])
        parts.append(wall1)
        
        # -45度方向の壁（右下から左上）
        wall2 = trimesh.creation.box(
            extents=[diagonal_length, strut_thickness, lattice_height]
        )
        # -45度回転
        rotation_neg45 = trimesh.transformations.rotation_matrix(
            np.radians(-45), [0, 0, 1]
        )
        wall2.apply_transform(rotation_neg45)
        wall2.apply_translation([half_cell, half_cell, z_mid])
        parts.append(wall2)
    
    unit_cell = trimesh.util.concatenate(parts)
    unit_cell.merge_vertices()
    
    return unit_cell


# =============================================================================
# ラティス構造生成（修正版：45度対角線壁）
# =============================================================================

def generate_xcell_lattice(
    bounds: np.ndarray,
    cell_size: float = 3.0,
    strut_thickness: float = 0.8,
    top_skin: float = 1.0,
    bottom_skin: float = 1.0
) -> trimesh.Trimesh:
    """
    指定された境界ボックス内にX-cellラティスを生成
    
    修正版：45度対角線壁でダイヤモンド開口部を形成
    
    Args:
        bounds: [[x_min, y_min, z_min], [x_max, y_max, z_max]]
        cell_size: セルサイズ (mm)
        strut_thickness: 壁厚 (mm)
        top_skin: 上面スキン厚 (mm)
        bottom_skin: 底面スキン厚 (mm)
    
    Returns:
        ラティス構造メッシュ
    """
    x_min, y_min, z_min = bounds[0]
    x_max, y_max, z_max = bounds[1]
    
    total_height = z_max - z_min
    lattice_height = total_height - top_skin - bottom_skin
    z_bottom = z_min + bottom_skin
    z_mid = z_bottom + lattice_height / 2
    
    if lattice_height <= 0:
        print("[X-CELL] Lattice height <= 0, skipping")
        return trimesh.Trimesh()
    
    parts = []
    
    # スキン層
    width = x_max - x_min
    depth = y_max - y_min
    center_x = (x_min + x_max) / 2
    center_y = (y_min + y_max) / 2
    
    if bottom_skin > 0:
        bottom_box = trimesh.creation.box(extents=[width, depth, bottom_skin])
        bottom_box.apply_translation([center_x, center_y, z_min + bottom_skin / 2])
        parts.append(bottom_box)
    
    if top_skin > 0:
        top_box = trimesh.creation.box(extents=[width, depth, top_skin])
        top_box.apply_translation([center_x, center_y, z_max - top_skin / 2])
        parts.append(top_box)
    
    # 対角線方向のセル間隔
    # ダイヤモンドパターンでは、対角線方向にcell_size間隔で壁を配置
    diagonal_spacing = cell_size / np.sqrt(2)
    
    # 対角線の長さ（ボックス全体をカバー）
    max_diagonal = np.sqrt(width**2 + depth**2) + cell_size * 2
    
    # +45度方向の壁（左下から右上）
    # 壁の配置位置を計算
    n_walls_diag = int(np.ceil((width + depth) / diagonal_spacing)) + 2
    
    rotation_45 = trimesh.transformations.rotation_matrix(np.radians(45), [0, 0, 1])
    rotation_neg45 = trimesh.transformations.rotation_matrix(np.radians(-45), [0, 0, 1])
    
    wall_count = 0
    
    # +45度壁
    for i in range(-n_walls_diag // 2, n_walls_diag // 2 + 1):
        offset = i * diagonal_spacing * np.sqrt(2)
        
        wall = trimesh.creation.box(
            extents=[max_diagonal, strut_thickness, lattice_height]
        )
        wall.apply_transform(rotation_45)
        wall.apply_translation([center_x + offset, center_y, z_mid])
        parts.append(wall)
        wall_count += 1
    
    # -45度壁
    for i in range(-n_walls_diag // 2, n_walls_diag // 2 + 1):
        offset = i * diagonal_spacing * np.sqrt(2)
        
        wall = trimesh.creation.box(
            extents=[max_diagonal, strut_thickness, lattice_height]
        )
        wall.apply_transform(rotation_neg45)
        wall.apply_translation([center_x, center_y + offset, z_mid])
        parts.append(wall)
        wall_count += 1
    
    print(f"[X-CELL] Diagonal walls: {wall_count} (+-45 degrees)")
    print(f"[X-CELL] Total parts: {len(parts)}")
    
    lattice = trimesh.util.concatenate(parts)
    lattice.merge_vertices()
    
    return lattice


def apply_xcell_lattice(
    mesh: trimesh.Trimesh,
    cell_size: float = 3.0,
    strut_thickness: float = 0.8,
    top_skin: float = 1.0,
    bottom_skin: float = 1.0
) -> trimesh.Trimesh:
    """
    メッシュに2.5D Xセル ラティス構造を適用
    
    Args:
        mesh: 入力メッシュ
        cell_size: セル間隔 (mm) - ダイヤモンドの辺の長さ
        strut_thickness: 壁厚 (mm)
        top_skin: 上面スキン厚 (mm)
        bottom_skin: 底面スキン厚 (mm)
    
    Returns:
        Xセル適用後のメッシュ
    """
    print(f"[X-CELL] === X-cell Lattice v4.0 (Diagonal Wall Pattern) ===")
    print(f"[X-CELL] Cell size: {cell_size}mm, Wall thickness: {strut_thickness}mm")
    print(f"[X-CELL] Skin: top={top_skin}mm, bottom={bottom_skin}mm")
    
    bounds = mesh.bounds
    z_min, z_max = bounds[0][2], bounds[1][2]
    total_height = z_max - z_min
    
    print(f"[X-CELL] Mesh height: {total_height:.1f}mm")
    
    lattice_height = total_height - top_skin - bottom_skin
    if lattice_height <= 0:
        print(f"[X-CELL] Skin exceeds mesh height. Skipping.")
        return mesh
    
    # ラティス構造を生成
    print(f"[X-CELL] Generating diagonal wall lattice...")
    lattice = generate_xcell_lattice(
        bounds=bounds,
        cell_size=cell_size,
        strut_thickness=strut_thickness,
        top_skin=top_skin,
        bottom_skin=bottom_skin
    )
    
    print(f"[X-CELL] Lattice: {len(lattice.vertices)} verts, {len(lattice.faces)} faces")
    
    if len(lattice.vertices) == 0:
        print(f"[X-CELL] No lattice generated. Returning original mesh.")
        return mesh
    
    # ブーリアン交差でクリップ
    print(f"[X-CELL] Clipping to mesh shape...")
    
    engines = ["blender", "manifold"]
    result = None
    
    for engine in engines:
        try:
            result = lattice.intersection(mesh, engine=engine)
            if result is not None and len(result.vertices) > 0:
                print(f"[X-CELL] Boolean OK ({engine})")
                break
        except Exception as e:
            print(f"[X-CELL] {engine} failed: {e}")
            continue
    
    if result is None or len(result.vertices) == 0:
        print(f"[X-CELL] Boolean failed. Returning raw lattice.")
        result = lattice
    
    print(f"[X-CELL] Result: {len(result.vertices)} verts, {len(result.faces)} faces")
    print(f"[X-CELL] Watertight: {result.is_watertight}")
    
    return result


# =============================================================================
# 後方互換性API
# =============================================================================

def apply_lattice_to_insole(
    insole_mesh: trimesh.Trimesh,
    cell_size: float = 3.0,
    top_skin: float = 1.0,
    bottom_skin: float = 1.0,
    pattern: str = "xcell",
    strut_thickness: float = 0.8
) -> trimesh.Trimesh:
    """
    インソールメッシュにラティスを適用
    
    Args:
        insole_mesh: インソールメッシュ
        cell_size: セルサイズ (mm) - 推奨: 3.0mm
        top_skin: 上面スキン厚 (mm)
        bottom_skin: 底面スキン厚 (mm)
        pattern: パターン種類（現在は"xcell"のみ）
        strut_thickness: 壁厚 (mm) - 推奨: 0.8mm
    
    Returns:
        ラティス適用後のメッシュ
    """
    return apply_xcell_lattice(
        mesh=insole_mesh,
        cell_size=cell_size,
        strut_thickness=strut_thickness,
        top_skin=top_skin,
        bottom_skin=bottom_skin
    )


# =============================================================================
# テスト
# =============================================================================

if __name__ == "__main__":
    print("=" * 60)
    print("X-Cell Lattice Module v4.0 Test (Diagonal Wall Pattern)")
    print("=" * 60)
    
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    
    # 1. ユニットセルのテスト
    print("\n--- Unit Cell Test ---")
    unit_cell = create_xcell_unit_cell(
        cell_size=3.0,
        cell_height=8.0,
        strut_thickness=0.8,
        top_skin=1.0,
        bottom_skin=1.0
    )
    print(f"Unit cell: {len(unit_cell.vertices)} verts, watertight={unit_cell.is_watertight}")
    print(f"Bounds: {unit_cell.bounds}")
    
    unit_path = EXPORTS_DIR / "xcell_unit_diamond_3mm.stl"
    unit_cell.export(str(unit_path))
    print(f"[OK] Saved: {unit_path}")
    
    # 2. ラティスボックスのテスト
    print("\n--- Lattice Box Test ---")
    test_box = trimesh.creation.box(extents=[30, 30, 10])
    test_box.apply_translation([15, 15, 5])
    
    print(f"Test box: 30x30x10mm")
    
    result = apply_xcell_lattice(
        test_box,
        cell_size=3.0,
        strut_thickness=0.8,
        top_skin=1.0,
        bottom_skin=1.0
    )
    
    if result and len(result.vertices) > 0:
        print(f"Result: {len(result.vertices)} verts, watertight={result.is_watertight}")
        test_path = EXPORTS_DIR / "xcell_lattice_diamond_30mm.stl"
        result.export(str(test_path))
        print(f"[OK] Saved: {test_path}")
    
    print("\n" + "=" * 60)
    print("Test Complete!")
    print("=" * 60)
