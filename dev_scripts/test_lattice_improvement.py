"""ラティス改善の効果を確認するスクリプト"""
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

print("=" * 60)
print("Lattice Improvement Verification")
print("=" * 60)

stl_path = Path("exports/generated_v4_insole.stl")

if not stl_path.exists():
    print(f"\n[INFO] {stl_path} not found.")
    print("Please generate STL from UI first, then run this script again.")
    sys.exit(0)

print(f"\nLoading STL: {stl_path}")
mesh = trimesh.load(str(stl_path))

print("\n" + "=" * 60)
print("Basic Mesh Info")
print("=" * 60)
print(f"Vertices: {len(mesh.vertices):,}")
print(f"Faces: {len(mesh.faces):,}")
print(f"Watertight: {mesh.is_watertight}")
print(f"Winding consistent: {mesh.is_winding_consistent}")

# エッジの詳細チェック
print("\n" + "=" * 60)
print("Edge Analysis (Key Metric)")
print("=" * 60)
try:
    edges_unique = mesh.edges_unique
    edges_all = mesh.edges
    duplicate_edges = len(edges_all) - len(edges_unique)
    
    print(f"Unique edges: {len(edges_unique):,}")
    print(f"All edges: {len(edges_all):,}")
    print(f"Duplicate edges: {duplicate_edges:,}")
    
    # 改善目標との比較
    target = 10000
    previous = 700071  # 修正前の値
    
    print(f"\nComparison:")
    print(f"  Previous (before fix): {previous:,}")
    print(f"  Current: {duplicate_edges:,}")
    print(f"  Target: < {target:,}")
    
    reduction = ((previous - duplicate_edges) / previous) * 100
    print(f"  Reduction: {reduction:.1f}%")
    
    if duplicate_edges < target:
        print(f"\n[SUCCESS] Duplicate edges below target!")
    elif duplicate_edges < previous * 0.5:
        print(f"\n[IMPROVED] Significant reduction in duplicate edges")
    else:
        print(f"\n[WARN] Still many duplicate edges")
        
except Exception as e:
    print(f"Edge check failed: {e}")

# 詳細な検証
print("\n" + "=" * 60)
print("Detailed Validation")
print("=" * 60)
result = validate_mesh(mesh)
report = generate_quality_report(mesh, result)
print(report)

print("\n" + "=" * 60)
print("Summary")
print("=" * 60)
print("Key improvements expected:")
print("  1. Center sphere reduces strut overlap")
print("  2. Struts stop at sphere surface (not center)")
print("  3. Increased cylinder sections (8->16) for smoother joints")
print("  4. Enhanced cleanup (remove_degenerate/duplicate faces, fix_normals)")
