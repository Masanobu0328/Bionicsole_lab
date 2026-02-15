"""ラティスユニットセルの品質チェックスクリプト"""
import sys
import trimesh
import numpy as np
from pathlib import Path

# Windowsの標準出力で絵文字が出ると失敗するためUTF-8に固定
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except:
        pass

sys.path.insert(0, str(Path(__file__).parent))
from core.xcell_3d import create_3d_xcell_unit

print("=" * 60)
print("3D X-Cell Unit Quality Check")
print("=" * 60)

# ユニットセルを生成
print("\nGenerating unit cell...")
unit = create_3d_xcell_unit(size=3.0, strut_radius=0.4)

print("\n" + "=" * 60)
print("Basic Mesh Info")
print("=" * 60)
print(f"Vertices: {len(unit.vertices):,}")
print(f"Faces: {len(unit.faces):,}")
print(f"Watertight: {unit.is_watertight}")
print(f"Winding consistent: {unit.is_winding_consistent}")

# エッジの詳細チェック
print("\n" + "=" * 60)
print("Edge Analysis")
print("=" * 60)
try:
    edges_unique = unit.edges_unique
    edges_all = unit.edges
    print(f"Unique edges: {len(edges_unique):,}")
    print(f"All edges: {len(edges_all):,}")
    duplicate_edges = len(edges_all) - len(edges_unique)
    print(f"Duplicate edges: {duplicate_edges:,}")
    
    if duplicate_edges < 100:
        print("[OK] Duplicate edges are minimal")
    else:
        print(f"[WARN] Many duplicate edges: {duplicate_edges}")
except Exception as e:
    print(f"Edge check failed: {e}")

# 中心付近の頂点チェック（結合部の品質）
print("\n" + "=" * 60)
print("Joint Quality Check (Center Region)")
print("=" * 60)
center = np.array([1.5, 1.5, 1.5])
vertices = unit.vertices
distances = np.linalg.norm(vertices - center, axis=1)
center_vertices = vertices[distances < 0.5]  # 中心から0.5mm以内

print(f"Vertices within 0.5mm of center: {len(center_vertices):,}")
print(f"Expected: ~200-300 (sphere 80 faces + strut ends 8×16 faces)")

if 100 < len(center_vertices) < 500:
    print("[OK] Joint region has appropriate vertex count")
else:
    print(f"[WARN] Joint region vertex count: {len(center_vertices)}")

# バウンディングボックスチェック
print("\n" + "=" * 60)
print("Bounding Box Check")
print("=" * 60)
bounds = unit.bounds
size_actual = bounds[1] - bounds[0]
print(f"Expected size: [3.0, 3.0, 3.0]")
print(f"Actual size: {size_actual}")
if np.allclose(size_actual, [3.0, 3.0, 3.0], atol=0.1):
    print("[OK] Bounding box matches expected size")
else:
    print("[WARN] Bounding box size mismatch")

# テスト用STLを保存
test_output = Path("exports/test_unit_cell.stl")
test_output.parent.mkdir(exist_ok=True)
unit.export(str(test_output))
print(f"\nTest STL saved to: {test_output}")

print("\n" + "=" * 60)
print("Quality Check Complete")
print("=" * 60)
