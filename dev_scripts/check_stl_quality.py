"""STLファイルの品質チェックスクリプト"""
import sys
import trimesh
from pathlib import Path

# Windowsの標準出力で絵文字が出ると失敗するためUTF-8に固定
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except:
        pass

sys.path.insert(0, str(Path(__file__).parent))
from core.validate import validate_mesh, generate_quality_report

stl_path = Path("exports/generated_v4_insole.stl")

if not stl_path.exists():
    print(f"Error: {stl_path} not found")
    sys.exit(1)

print(f"Loading STL: {stl_path}")
mesh = trimesh.load(str(stl_path))

print("\n" + "=" * 60)
print("Basic Mesh Info")
print("=" * 60)
print(f"Vertices: {len(mesh.vertices):,}")
print(f"Faces: {len(mesh.faces):,}")
print(f"Watertight: {mesh.is_watertight}")
print(f"Winding consistent: {mesh.is_winding_consistent}")
print(f"Volume: {mesh.volume:.2f} mm^3")
print(f"Area: {mesh.area:.2f} mm^2")
bounds = mesh.bounds
print(f"Bounds: {bounds[0]} to {bounds[1]}")
print(f"Size: {(bounds[1] - bounds[0])} mm")

# 詳細な検証
print("\n" + "=" * 60)
print("Detailed Validation")
print("=" * 60)
result = validate_mesh(mesh)
report = generate_quality_report(mesh, result)
print(report)

# エッジの詳細チェック
print("\n" + "=" * 60)
print("Edge Analysis")
print("=" * 60)
try:
    edges_unique = mesh.edges_unique
    edges_all = mesh.edges
    print(f"Unique edges: {len(edges_unique):,}")
    print(f"All edges: {len(edges_all):,}")
    if len(edges_unique) != len(edges_all):
        print(f"WARNING: Duplicate edges detected: {len(edges_all) - len(edges_unique):,}")
except Exception as e:
    print(f"Edge check failed: {e}")

# 非多様体エッジのチェック
print("\n" + "=" * 60)
print("Non-manifold Check")
print("=" * 60)
try:
    if hasattr(mesh, 'is_watertight'):
        if not mesh.is_watertight:
            print("WARNING: Mesh is not watertight (open mesh)")
            print("This is expected for lattice structures with open cells")
        else:
            print("OK: Mesh is watertight")
except Exception as e:
    print(f"Watertight check failed: {e}")
