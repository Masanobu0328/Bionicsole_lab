"""
MasaCAD Core - Validation Module
メッシュ自動検証・修復

機能:
- 体積・厚み・面数チェック
- 非多様体修復
- 品質レポート生成
"""

import trimesh
import numpy as np
from typing import Dict, Tuple, Optional


def validate_mesh(mesh: trimesh.Trimesh, config: Optional[Dict] = None) -> Dict:
    """
    メッシュを総合的に検証
    
    Args:
        mesh: 検証対象メッシュ
        config: 検証設定 {
            "min_volume": 1000.0,
            "max_volume": 100000.0,
            "min_thickness": 1.0,
            "max_thickness": 20.0,
            "max_faces": 50000
        }
    
    Returns:
        dict: 検証結果 {
            "valid": bool,
            "errors": List[str],
            "warnings": List[str],
            "metrics": Dict
        }
    """
    if config is None:
        config = {
            "min_volume": 1000.0,
            "max_volume": 100000.0,
            "min_thickness": 1.0,
            "max_thickness": 20.0,
            "max_faces": 50000
        }
    
    errors = []
    warnings = []
    metrics = {}
    
    # 1. 基本メトリクス
    try:
        metrics["volume"] = float(mesh.volume)
        metrics["area"] = float(mesh.area)
        metrics["n_vertices"] = len(mesh.vertices)
        metrics["n_faces"] = len(mesh.faces)
        metrics["is_watertight"] = bool(mesh.is_watertight)
        metrics["is_winding_consistent"] = bool(mesh.is_winding_consistent)
    except Exception as e:
        errors.append(f"基本メトリクス取得失敗: {e}")
        return {"valid": False, "errors": errors, "warnings": warnings, "metrics": metrics}
    
    # 2. 体積チェック
    if metrics["volume"] < config["min_volume"]:
        errors.append(f"体積が小さすぎます: {metrics['volume']:.1f} < {config['min_volume']}")
    elif metrics["volume"] > config["max_volume"]:
        warnings.append(f"体積が大きい: {metrics['volume']:.1f} > {config['max_volume']}")
    
    # 3. 厚みチェック（バウンディングボックスのZ方向）
    bounds = mesh.bounds
    thickness = bounds[1, 2] - bounds[0, 2]
    metrics["thickness"] = float(thickness)
    
    if thickness < config["min_thickness"]:
        errors.append(f"厚みが薄すぎます: {thickness:.2f} < {config['min_thickness']}")
    elif thickness > config["max_thickness"]:
        warnings.append(f"厚みが厚い: {thickness:.2f} > {config['max_thickness']}")
    
    # 4. 面数チェック
    if metrics["n_faces"] > config["max_faces"]:
        warnings.append(f"面数が多い: {metrics['n_faces']} > {config['max_faces']} (処理が重い)")
    
    # 5. トポロジーチェック
    if not metrics["is_watertight"]:
        errors.append("メッシュが閉じていません（watertight違反）")
    
    if not metrics["is_winding_consistent"]:
        warnings.append("法線の向きが不整合です")
    
    # 6. 非多様体チェック
    try:
        edges_unique = mesh.edges_unique
        edges_all = mesh.edges
        if len(edges_unique) != len(edges_all):
            warnings.append(f"重複エッジ検出: {len(edges_all) - len(edges_unique)}本")
    except Exception as e:
        warnings.append(f"エッジチェック失敗: {e}")
    
    # 結果
    valid = len(errors) == 0
    
    return {
        "valid": valid,
        "errors": errors,
        "warnings": warnings,
        "metrics": metrics
    }


def repair_mesh(mesh: trimesh.Trimesh, aggressive: bool = False) -> Tuple[trimesh.Trimesh, Dict]:
    """
    メッシュを自動修復
    
    Args:
        mesh: 修復対象メッシュ
        aggressive: 積極的修復（トポロジー変更含む）
    
    Returns:
        (repaired_mesh, repair_log): 修復後メッシュと修復ログ
    """
    log = {
        "fixed_normals": False,
        "removed_degenerate": False,
        "filled_holes": False,
        "merged_vertices": False
    }
    
    repaired = mesh.copy()
    
    # 1. 法線修正
    try:
        repaired.fix_normals()
        log["fixed_normals"] = True
        print("[INFO] 法線を修正しました")
    except Exception as e:
        print(f"[WARN] 法線修正失敗: {e}")
    
    # 2. 縮退面削除
    try:
        initial_faces = len(repaired.faces)
        repaired.update_faces(repaired.nondegenerate_faces())
        removed = initial_faces - len(repaired.faces)
        if removed > 0:
            log["removed_degenerate"] = True
            print(f"[INFO] 縮退面を削除: {removed}面")
    except Exception as e:
        print(f"[WARN] 縮退面削除失敗: {e}")
    
    # 3. 穴埋め（積極的修復時のみ）
    if aggressive:
        try:
            if not repaired.is_watertight:
                repaired.fill_holes()
                log["filled_holes"] = True
                print("[INFO] 穴を埋めました")
        except Exception as e:
            print(f"[WARN] 穴埋め失敗: {e}")
    
    # 4. 重複頂点のマージ
    try:
        initial_verts = len(repaired.vertices)
        repaired.merge_vertices()
        merged = initial_verts - len(repaired.vertices)
        if merged > 0:
            log["merged_vertices"] = True
            print(f"[INFO] 重複頂点をマージ: {merged}頂点")
    except Exception as e:
        print(f"[WARN] 頂点マージ失敗: {e}")
    
    return repaired, log


def generate_quality_report(mesh: trimesh.Trimesh, validation: Dict, repair_log: Optional[Dict] = None) -> str:
    """
    品質レポートをテキスト生成
    
    Args:
        mesh: メッシュ
        validation: 検証結果
        repair_log: 修復ログ（オプション）
    
    Returns:
        str: レポートテキスト
    """
    lines = []
    lines.append("=" * 60)
    lines.append("MasaCAD メッシュ品質レポート")
    lines.append("=" * 60)
    lines.append("")
    
    # メトリクス
    lines.append("【メトリクス】")
    metrics = validation["metrics"]
    lines.append(f"  体積:       {metrics.get('volume', 0):.2f} mm³")
    lines.append(f"  表面積:     {metrics.get('area', 0):.2f} mm²")
    lines.append(f"  厚み:       {metrics.get('thickness', 0):.2f} mm")
    lines.append(f"  頂点数:     {metrics.get('n_vertices', 0):,}")
    lines.append(f"  面数:       {metrics.get('n_faces', 0):,}")
    lines.append(f"  閉じてる:   {'[OK]' if metrics.get('is_watertight') else '[NG]'}")
    lines.append(f"  法線整合:   {'[OK]' if metrics.get('is_winding_consistent') else '[NG]'}")
    lines.append("")
    
    # エラー
    if validation["errors"]:
        lines.append("[ERROR]")
        for err in validation["errors"]:
            lines.append(f"  x {err}")
        lines.append("")

    # 警告
    if validation["warnings"]:
        lines.append("[WARN]")
        for warn in validation["warnings"]:
            lines.append(f"  ! {warn}")
        lines.append("")

    # 修復ログ
    if repair_log:
        lines.append("[REPAIR]")
        for action, done in repair_log.items():
            status = "* done" if done else "- skip"
            lines.append(f"  {status}: {action}")
        lines.append("")
    
    # 判定
    lines.append("[RESULT]")
    if validation["valid"]:
        lines.append("  [PASS] メッシュは正常です")
    else:
        lines.append("  [FAIL] 修正が必要です")
    
    lines.append("=" * 60)
    
    return "\n".join(lines)


# テスト用
if __name__ == "__main__":
    # テストメッシュ
    mesh = trimesh.creation.box(extents=[100, 50, 5])
    
    # 検証
    result = validate_mesh(mesh)
    print(generate_quality_report(mesh, result))
    
    # 修復
    if not result["valid"]:
        repaired, log = repair_mesh(mesh, aggressive=True)
        result2 = validate_mesh(repaired)
        print("\n修復後:")
        print(generate_quality_report(repaired, result2, log))

