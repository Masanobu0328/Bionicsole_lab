"""
MasaCAD Core - Geometry Module v4.2
ハイブリッド方式：輪郭維持 + テンプレートプロファイル

設計思想:
- 輪郭CSVの閉じたループを正確に維持（端部が自然に閉じる）
- 輪郭内部にグリッド頂点を追加
- テンプレートから抽出したプロファイルで高さを制御
- アーチ・ヒールカップ・壁が正確に再現される
- 底面は完全に平坦（Z=0）

座標系:
- X: 0=つま先、max=踵
- Y: 0=外側（小指側）、max=内側（土踏まず側）
- Z: 0=底面、up=上面

作成日: 2024-12-28
"""

from typing import Dict, Optional, Tuple, List
from pathlib import Path
import numpy as np
from scipy.interpolate import CubicSpline, interp1d, LinearNDInterpolator
from scipy.spatial import Delaunay
import trimesh
from matplotlib.path import Path as MplPath

# プロジェクトルート
PROJECT_ROOT = Path(__file__).parent.parent.resolve()
EXPORTS_DIR = PROJECT_ROOT / "exports"

# バージョン情報
GEOMETRY_VERSION = "v4.3-arch-simple-2025-01-04"
print(f"[BOOT] geometry_v4 loaded: {GEOMETRY_VERSION}")


# =============================================================================
# 設計ルール（テンプレートから抽出）
# =============================================================================

# 座標系: X=0%=踵、X=100%=つま先（輪郭CSV基準）
# Y=0=外側、Y=1=内側

# 壁高さプロファイル（X位置% → (内壁高さmm, 外壁高さmm)）
# X=0%=踵、X=100%=つま先
# テンプレートから抽出した実データ（座標反転版）
# 全体的に-2mm調整（ピーク: 内壁10→8, 外壁7.9→5.9）
WALL_PROFILE = {
    0.0: (6.4, 5.9),    # 踵後端（高い壁・ヒールカップ）
    10.0: (6.3, 5.9),   # ヒールカップ
    20.0: (6.3, 5.9),   # ヒールカップ領域
    30.0: (7.2, 4.3),   # アーチ開始
    40.0: (8.0, 1.5),   # 内壁最高点
    50.0: (7.6, 0.0),   # アーチピーク（外壁なし）
    55.0: (4.0, 0.0),   # 内壁下降
    60.0: (1.6, 0.0),   # 内壁終了へ
    65.0: (0.0, 0.0),   # 壁なし開始
    70.0: (0.0, 0.0),   # 前足部（壁なし）
    80.0: (0.0, 0.0),   # 前足部（壁なし）
    90.0: (0.0, 0.0),   # つま先付近（壁なし）
    100.0: (0.0, 0.0),  # つま先（壁なし）
}

# ヒールカップ高さプロファイル（X位置% → 縁の高さmm）
# X=0%=踵（ヒールカップあり）、X=100%=つま先
# 範囲を広げて遷移を滑らかに
HEEL_CUP_PROFILE = {
    0.0: 1.8,      # 踵後端
    10.0: 2.0,     # ヒールカップピーク
    20.0: 1.8,     # 下降開始
    30.0: 1.2,     # 緩やかに下降
    40.0: 0.8,     # さらに下降
    50.0: 0.3,     # 終了へ
    60.0: 0.0,     # 終了
    100.0: 0.0,    # つま先（なし）
}

# =============================================================================
# アーチ設定（簡易版）
# =============================================================================

# デフォルトのアーチパラメータ（ガイドラインの骨ランドマークに対応）
# 参照: landmarks.py の DEFAULT_BONE_LANDMARKS
DEFAULT_ARCH_SETTINGS = {
    # 内側縦アーチ（Medial Longitudinal Arch）
    # arch_start(15%) → navicular(43%) → metatarsal(70%)
    'medial_start': 15.0,    # 起始位置: アーチ起始部 (arch_start)
    'medial_end': 70.0,      # 終了位置: 中足骨レベル (metatarsal)
    'medial_peak': 43.0,     # ピーク位置: 舟状骨レベル (navicular)
    'medial_height': 1.0,    # 高さ (mm)
    
    # 外側縦アーチ（Lateral Longitudinal Arch）
    # lateral_arch_start(20%) → 32.5% → cuboid(45%)
    'lateral_start': 20.0,   # 起始位置: 外側アーチ起始部 (lateral_arch_start)
    'lateral_end': 45.0,     # 終了位置: 立方骨レベル (cuboid)
    'lateral_peak': 32.5,    # ピーク位置: (20+45)/2
    'lateral_height': 0.5,   # 高さ (mm)
    
    # 横アーチ（Transverse Arch）- 第2-4中足骨部
    # navicular(43%) → 59% → metatarsal+5(75%)
    'transverse_start': 43.0,  # 起始位置: 舟状骨レベル (navicular)
    'transverse_end': 75.0,    # 終了位置: 中足骨レベル+5 (metatarsal+5)
    'transverse_peak': 59.0,   # ピーク位置: (43+75)/2
    'transverse_height': 0.5,  # 高さ (mm)

    # Y方向（幅）パラメータ
    'medial_y_start': 65.0,      # 第1列境界（内側縦アーチ開始）
    'medial_y_end': 100.0,       # 内側端
    'lateral_y_start': 0.0,      # 外側端
    'lateral_y_end': 25.0,       # 第5列境界（外側縦アーチ終了）
    'transverse_y_start': 25.0,  # 第5列境界
    'transverse_y_end': 65.0,    # 第1列境界
    'grid_cell_heights': None,   # グリッドセル高さ（オプション）
}


def generate_arch_profile(arch_settings: dict = None, landmark_settings: dict = None) -> dict:
    """
    アーチ設定パラメータからARCH_PROFILEを動的に生成
    
    Args:
        arch_settings: アーチ設定辞書。Noneの場合はデフォルト値を使用
        landmark_settings: ランドマーク設定（動的な幅計算に使用）
        
    Returns:
        ARCH_PROFILE形式の辞書 {X位置%: (外側高さmm, 内側高さmm, 横アーチ高さmm)}
    """
    settings = DEFAULT_ARCH_SETTINGS.copy()
    if arch_settings:
        settings.update(arch_settings)
    
    # ランドマークに基づく動的な幅設定
    if landmark_settings:
        ray1 = landmark_settings.get('ray1_boundary')
        ray5 = landmark_settings.get('ray5_boundary')
        
        if ray1 is not None:
            settings['medial_y_start'] = ray1 - 5.0
            settings['transverse_y_end'] = ray1 + 2.5

        if ray5 is not None:
            settings['lateral_y_end'] = ray5 + 5.0
            settings['transverse_y_start'] = ray5 - 2.5

    # グリッド設定の取得
    grid_heights = settings.get('grid_cell_heights', {})
    if grid_heights is None:
        grid_heights = {}

    # キーポイントを収集
    key_points = set([0.0, 10.0, 100.0])  # 固定ポイント
    
    # 内側アーチのポイント
    key_points.add(settings['medial_start'])
    key_points.add(settings['medial_peak'])
    key_points.add(settings['medial_end'])
    
    # 外側アーチのポイント
    key_points.add(settings['lateral_start'])
    key_points.add(settings['lateral_peak'])
    key_points.add(settings['lateral_end'])
    
    # 横アーチのポイント
    key_points.add(settings['transverse_start'])
    key_points.add(settings['transverse_peak'])
    key_points.add(settings['transverse_end'])
    
    # ランドマーク位置の取得（グリッドマッピング用）
    # settingsキーから逆算できない場合もあるため、標準的な順序で推定
    # 本来は landmark_settings を参照すべきだが、ここでは簡易的に settings 内の値を使用
    # 必要に応じて補間ポイントを追加
    lm_pos = {
        'arch_start': settings['medial_start'],
        'subtalar': (settings['medial_start'] + settings['medial_peak']) / 2, # 近似
        'navicular': settings['medial_peak'],
        'cuboid': settings['lateral_end'],
        'medial_cuneiform': (settings['medial_peak'] + settings['medial_end']) / 2, # 近似
        'metatarsal': settings['medial_end'],
        'lateral_arch_start': settings['lateral_start'],
    }
    
    # グリッドセルの定義（X範囲）
    grid_definitions = [
        # Medial
        {'id': 'medial_1', 'type': 'medial', 'start': lm_pos['arch_start'], 'end': lm_pos['subtalar']},
        {'id': 'medial_2', 'type': 'medial', 'start': lm_pos['subtalar'], 'end': lm_pos['navicular']},
        {'id': 'medial_3', 'type': 'medial', 'start': lm_pos['navicular'], 'end': lm_pos['medial_cuneiform']},
        {'id': 'medial_4', 'type': 'medial', 'start': lm_pos['medial_cuneiform'], 'end': lm_pos['metatarsal']},
        # Lateral
        {'id': 'lateral_1', 'type': 'lateral', 'start': lm_pos['lateral_arch_start'], 'end': lm_pos['cuboid']},
        # Transverse
        {'id': 'transverse_1', 'type': 'transverse', 'start': lm_pos['navicular'], 'end': (lm_pos['navicular'] + lm_pos['metatarsal'])/2},
        {'id': 'transverse_2', 'type': 'transverse', 'start': (lm_pos['navicular'] + lm_pos['metatarsal'])/2, 'end': lm_pos['metatarsal']},
        {'id': 'transverse_3', 'type': 'transverse', 'start': lm_pos['metatarsal'], 'end': lm_pos['metatarsal'] + 5},
    ]

    # 追加の補間ポイント
    for x in [15.0, 25.0, 35.0, 45.0, 50.0, 55.0, 65.0, 70.0, 80.0, 90.0]:
        key_points.add(x)
    
    key_points = sorted(key_points)
    
    profile = {}
    
    for x in key_points:
        # 1. 基本カーブによる高さ計算
        medial_h = _calculate_arch_height(
            x, 
            settings['medial_start'], 
            settings['medial_peak'],
            settings['medial_end'], 
            settings['medial_height']
        )
        
        lateral_h = _calculate_arch_height(
            x, 
            settings['lateral_start'], 
            settings['lateral_peak'],
            settings['lateral_end'], 
            settings['lateral_height']
        )
        
        transverse_h = _calculate_arch_height(
            x, 
            settings['transverse_start'], 
            settings['transverse_peak'],
            settings['transverse_end'], 
            settings['transverse_height']
        )
        
        # 2. グリッド設定によるオーバーライド（最大値採用）
        if grid_heights:
            for cell in grid_definitions:
                if cell['start'] <= x <= cell['end']:
                    cell_h = grid_heights.get(cell['id'], 0.0)
                    if cell_h > 0:
                        # セル範囲内でのフェードイン・アウト処理（カクつき防止）
                        # 端点付近では滑らかにする
                        edge_dist = min(x - cell['start'], cell['end'] - x)
                        blend_range = 2.0 # 2%範囲でブレンド
                        
                        factor = 1.0
                        if edge_dist < blend_range:
                            factor = edge_dist / blend_range
                            # Smoothstep
                            factor = factor * factor * (3 - 2 * factor)
                            
                        effective_h = cell_h * factor
                        
                        if cell['type'] == 'medial':
                            medial_h = max(medial_h, effective_h)
                        elif cell['type'] == 'lateral':
                            lateral_h = max(lateral_h, effective_h)
                        elif cell['type'] == 'transverse':
                            transverse_h = max(transverse_h, effective_h)
        
        profile[x] = (lateral_h, medial_h, transverse_h)
    
    return profile


def _calculate_arch_height(x: float, start: float, peak: float, end: float, max_height: float) -> float:
    """
    特定のX位置でのアーチ高さを計算（滑らかな山型）
    
    Args:
        x: X位置（%）
        start: アーチ開始位置（%）
        peak: アーチピーク位置（%）
        end: アーチ終了位置（%）
        max_height: 最大高さ（mm）
        
    Returns:
        その位置での高さ（mm）
    """
    if x <= start or x >= end:
        return 0.0
    
    if x <= peak:
        # 上り坂（start → peak）
        t = (x - start) / (peak - start)
        # スムーズステップ関数（S字カーブ）
        t = t * t * (3 - 2 * t)
        return max_height * t
    else:
        # 下り坂（peak → end）
        t = (x - peak) / (end - peak)
        # スムーズステップ関数（S字カーブ）
        t = t * t * (3 - 2 * t)
        return max_height * (1 - t)


# デフォルトのARCH_PROFILE（互換性のため）
ARCH_PROFILE = generate_arch_profile()


def generate_heel_cup_profile(landmark_settings: dict = None, height_mm: float = 1.8) -> dict:
    """
    ヒールカップ（踵中央の凹み）のプロファイルを動的に生成
    
    Args:
        landmark_settings: 骨ランドマーク設定
        height_mm: ヒールカップ深さ(mm)
    """
    if landmark_settings is None:
        landmark_settings = {}
        
    # ヒールカップ終了位置（内側と外側の平均的なアーチ開始位置を採用）
    medial_start = landmark_settings.get('arch_start', 15.0)
    lateral_start = landmark_settings.get('lateral_arch_start', 20.0)
    heel_end = (medial_start + lateral_start) / 2.0
    
    profile = {}
    
    # 0%からheel_endまでは最大深さ
    # そこから滑らかに0へ
    
    steps = 20
    for i in range(steps + 1):
        x = (i / steps) * 100.0
        
        if x <= heel_end:
            val = height_mm
        elif x <= heel_end + 15.0: # 終了から15%かけて減衰
            t = (x - heel_end) / 15.0
            # Cosine interpolation for smooth transition
            val = height_mm * (1.0 - (1.0 - np.cos(t * np.pi)) / 2.0) # S-curve down? No, cos(0)=1, cos(pi)=-1 -> (1 - (1 - (-1))/2) = 0
            val = height_mm * 0.5 * (1.0 + np.cos(t * np.pi))
        else:
            val = 0.0
            
        profile[x] = val
        
    return profile


def generate_wall_profile(landmark_settings: dict = None, wall_params: dict = None) -> dict:
    """
    骨ランドマークに連動した壁プロファイルを動的に生成
    ユーザー指定の高さを基準にスケーリングを行う
    """
    # デフォルト値
    if landmark_settings is None:
        landmark_settings = {}
    if wall_params is None:
        wall_params = {}
    
    navicular = landmark_settings.get('navicular', 43.0)
    cuboid = landmark_settings.get('cuboid', 45.0)
    metatarsal = landmark_settings.get('metatarsal', 70.0)
    
    # ヒールカップ終了（アーチ起始）
    medial_start = landmark_settings.get('arch_start', 15.0)
    lateral_start = landmark_settings.get('lateral_arch_start', 20.0)
    
    # ユーザー指定のターゲット高さ
    target_inner_max = wall_params.get('medial_height', 8.0)
    target_outer_max = wall_params.get('lateral_height', 4.3)
    
    # ピーク位置
    inner_peak_x = wall_params.get('medial_peak_x', navicular)
    outer_peak_x = wall_params.get('lateral_peak_x', 30.0)
    
    # デフォルトプロファイルの基準値（スケーリング用）
    DEFAULT_INNER_MAX = 8.0
    DEFAULT_OUTER_MAX = 4.3
    
    # スケールファクター
    # 0除算防止
    scale_inner = target_inner_max / DEFAULT_INNER_MAX if DEFAULT_INNER_MAX > 0 else 1.0
    scale_outer = target_outer_max / DEFAULT_OUTER_MAX if DEFAULT_OUTER_MAX > 0 else 1.0
    
    # スムーズステップ関数
    def smoothstep(t):
        t = max(0.0, min(1.0, t))
        return t * t * (3 - 2 * t)
    
    # Cosine補間関数
    def cosine_interp(t):
        t = max(0.0, min(1.0, t))
        return 0.5 * (1.0 + np.cos(t * np.pi))
    
    profile = {}
    
    # WALL_PROFILE（定数）の形状をベースにしつつ、
    # X位置のタイミングをランドマークに合わせ、
    # 高さをユーザースケールに合わせる
    
    # 0%から100%までスキャン
    for x in range(0, 101, 2):
        x = float(x)
        
        # --- 内壁 (Inner) ---
        # 基準プロファイル形状の模倣
        if x <= medial_start:
            # ヒール領域: 定数6.4mm * スケール
            inner = 6.4 * scale_inner
        elif x <= inner_peak_x:
            # 上昇
            t = (x - medial_start) / (inner_peak_x - medial_start)
            # 6.4 -> 8.0 (default) -> scaled
            base_val = 6.4 + (8.0 - 6.4) * smoothstep(t)
            inner = base_val * scale_inner
        elif x <= metatarsal:
            # 下降
            t = (x - inner_peak_x) / (metatarsal - inner_peak_x)
            # 8.0 -> 0.0 (default) -> scaled
            base_val = 8.0 * cosine_interp(t)
            inner = base_val * scale_inner
        else:
            inner = 0.0
            
        # --- 外壁 (Outer) ---
        if x <= lateral_start:
            # ヒール領域: 定数5.9mm * スケール
            outer = 5.9 * scale_outer
        elif x <= outer_peak_x:
            # 上昇 (5.9 -> 4.3?? 外壁はヒールの方が高い場合がある)
            # WALL_PROFILEを見ると 0%:5.9 -> 30%:4.3 なので実は下がる
            # しかしユーザー指定が target_outer_max なので、ピークに向かって遷移させる
            
            # ヒール高さ(5.9)とピーク高さ(4.3)の関係を維持するか、
            # ユーザー指定をピークとするか。
            # ここでは「ユーザー指定値 = ピーク」とするため、
            # ヒール高さも比率でスケーリングする
            
            t = (x - lateral_start) / (outer_peak_x - lateral_start)
            
            # デフォルト挙動: ヒール(5.9) -> ピーク(4.3)
            # ユーザー指定に合わせて: (5.9/4.3)*target -> target
            start_val = 5.9 * scale_outer
            end_val = target_outer_max
            
            # 線形補間 + smooth
            outer = start_val + (end_val - start_val) * smoothstep(t)
            
        elif x <= cuboid:
            # 下降
            t = (x - outer_peak_x) / (cuboid - outer_peak_x)
            outer = target_outer_max * cosine_interp(t)
        else:
            outer = 0.0
            
        profile[x] = (round(inner, 2), round(outer, 2))
        
    return profile


def create_profile_interpolators(arch_settings: dict = None, landmark_settings: dict = None, wall_params: dict = None):
    """
    設計ルールの補間関数を作成
    """
    settings = DEFAULT_ARCH_SETTINGS.copy()
    if arch_settings:
        settings.update(arch_settings)

    # 壁高さ
    wall_profile = generate_wall_profile(landmark_settings, wall_params)
    wall_x = sorted(wall_profile.keys())
    inner_walls = [wall_profile[x][0] for x in wall_x]
    outer_walls = [wall_profile[x][1] for x in wall_x]
    
    # ヒールカップ（動的生成）
    # note: height_mm is base profile, scaled later
    heel_profile_data = generate_heel_cup_profile(landmark_settings)
    heel_x = sorted(heel_profile_data.keys())
    heel_cup = [heel_profile_data[x] for x in heel_x]
    
    # アーチ
    arch_profile = generate_arch_profile(settings, landmark_settings)
    arch_x = sorted(arch_profile.keys())
    arch_outer = [arch_profile[x][0] for x in arch_x]
    arch_inner = [arch_profile[x][1] for x in arch_x]
    arch_transverse = [arch_profile[x][2] for x in arch_x]
    
    # Use cubic interpolation for smoother surfaces, fallback to linear if not enough points
    kind = 'cubic' if len(wall_x) > 3 else 'linear'
    
    return {
        'inner_wall': interp1d(wall_x, inner_walls, kind=kind, fill_value='extrapolate'),
        'outer_wall': interp1d(wall_x, outer_walls, kind=kind, fill_value='extrapolate'),
        'heel_cup': interp1d(heel_x, heel_cup, kind=kind, fill_value='extrapolate'),
        'arch_outer': interp1d(arch_x, arch_outer, kind=kind, fill_value='extrapolate'),
        'arch_inner': interp1d(arch_x, arch_inner, kind=kind, fill_value='extrapolate'),
        'arch_transverse': interp1d(arch_x, arch_transverse, kind=kind, fill_value='extrapolate'),
        'arch_settings': settings,
        'landmark_settings': landmark_settings or {},
    }


# =============================================================================
# 輪郭処理
# =============================================================================

def load_outline_csv(csv_path: Path, flip_x: bool = False, flip_y: bool = False) -> np.ndarray:
    """輪郭CSVファイルを読み込む"""
    import pandas as pd
    
    csv_path = Path(csv_path)
    if not csv_path.exists():
        raise FileNotFoundError(f"輪郭CSVが見つかりません: {csv_path}")
    
    df = pd.read_csv(csv_path)
    
    if 'x_mm' in df.columns and 'y_mm' in df.columns:
        outline = df[['x_mm', 'y_mm']].values
    elif 'x' in df.columns and 'y' in df.columns:
        outline = df[['x', 'y']].values
    else:
        outline = df.iloc[:, :2].values
    
    if flip_x:
        outline[:, 0] = outline[:, 0].max() - outline[:, 0]
    if flip_y:
        outline[:, 1] = outline[:, 1].max() - outline[:, 1]
    
    # 原点正規化
    outline[:, 0] -= outline[:, 0].min()
    outline[:, 1] -= outline[:, 1].min()
    
    print(f"[INFO] 輪郭CSV読み込み: {csv_path.name}")
    print(f"[INFO] 輪郭点数: {len(outline)}")
    print(f"[INFO] 輪郭サイズ: X={outline[:, 0].max():.1f}mm, Y={outline[:, 1].max():.1f}mm")
    
    return outline


def get_outline_y_bounds(outline: np.ndarray) -> Tuple:
    """輪郭の上辺・下辺の補間関数を作成"""
    x = outline[:, 0]
    y = outline[:, 1]
    
    x_min, x_max = x.min(), x.max()
    n_samples = 200
    sample_x = np.linspace(x_min, x_max, n_samples)
    
    y_mins = []
    y_maxs = []
    
    for sx in sample_x:
        tol = (x_max - x_min) / 100
        mask = np.abs(x - sx) < tol
        if np.sum(mask) > 0:
            y_mins.append(y[mask].min())
            y_maxs.append(y[mask].max())
        else:
            # 補間
            if y_mins:
                y_mins.append(y_mins[-1])
                y_maxs.append(y_maxs[-1])
            else:
                y_mins.append(y.min())
                y_maxs.append(y.max())
    
    f_y_min = interp1d(sample_x, y_mins, kind='linear', fill_value='extrapolate')
    f_y_max = interp1d(sample_x, y_maxs, kind='linear', fill_value='extrapolate')
    
    return f_y_min, f_y_max, x_min, x_max


def point_in_polygon(point: np.ndarray, polygon: np.ndarray) -> bool:
    """点がポリゴン内部にあるかチェック（レイキャスティング法）"""
    x, y = point
    n = len(polygon)
    inside = False
    
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    
    return inside


# =============================================================================
# 高さ計算
# =============================================================================

def _distance_to_outline(x: float, y: float, outline: np.ndarray) -> float:
    """
    点(x, y)から輪郭への最短距離を計算

    Args:
        x, y: 内部点の座標
        outline: 輪郭点の配列 (N, 2)

    Returns:
        輪郭への最短距離（mm）
    """
    point = np.array([x, y])
    distances = np.sqrt(np.sum((outline[:, :2] - point) ** 2, axis=1))
    return float(np.min(distances))


def _get_heel_center(outline: np.ndarray, x_min: float, threshold_ratio: float = 0.05) -> Tuple[float, float]:
    """
    かかと後端の中心点を計算

    Args:
        outline: 輪郭点の配列 (N, 2)
        x_min: 輪郭の最小X座標
        threshold_ratio: かかと後端と見なすX範囲の割合（デフォルト5%）

    Returns:
        (x, y): かかと後端の中心点座標
    """
    x_coords = outline[:, 0]
    y_coords = outline[:, 1]
    length = x_coords.max() - x_min
    threshold = x_min + length * threshold_ratio

    # かかと後端の点を抽出
    heel_mask = x_coords <= threshold
    if np.sum(heel_mask) > 0:
        heel_x = np.mean(x_coords[heel_mask])
        heel_y = np.mean(y_coords[heel_mask])
    else:
        # フォールバック: 最小X座標の点
        min_idx = np.argmin(x_coords)
        heel_x = x_coords[min_idx]
        heel_y = y_coords[min_idx]

    return (heel_x, heel_y)


def calculate_height(
    x: float, y: float,
    x_min: float, x_max: float,
    y_min_at_x: float, y_max_at_x: float,
    profiles: Dict,
    base_thickness: float,
    is_boundary: bool = False,
    arch_scale: float = 1.0,
    wall_offset_mm: float = 0.0,
    heel_cup_scale: float = 1.0,
    is_right_foot: bool = False,
    outline: np.ndarray = None
) -> float:
    """
    各頂点の高さを計算
    """
    length = x_max - x_min
    
    # X位置の正規化（0-100%）: 0%=踵(x_min)、100%=つま先(x_max)
    x_ratio = (x - x_min) / length * 100 if length > 0 else 50
    x_ratio = np.clip(x_ratio, 0, 100)
    
    # Y位置の正規化（0-1）
    # y_ratio = 0 → Y_min側
    # y_ratio = 1 → Y_max側
    local_width = y_max_at_x - y_min_at_x
    if local_width > 0.5:
        y_ratio = (y - y_min_at_x) / local_width
    else:
        y_ratio = 0.5
    y_ratio = np.clip(y_ratio, 0, 1)
    
    if is_right_foot:
        # 右足: flip_y後なのでそのまま
        arch_y_ratio = y_ratio
    else:
        # 左足: Y_min=内側なので反転
        arch_y_ratio = 1.0 - y_ratio
    
    # プロファイルから値を取得（壁にはオフセットを適用）
    inner_wall_base = float(profiles['inner_wall'](x_ratio))
    outer_wall_base = float(profiles['outer_wall'](x_ratio))
    
    # 壁高さにオフセットを適用
    if inner_wall_base > 0:
        inner_wall = max(0, inner_wall_base + wall_offset_mm)
    else:
        inner_wall = 0
    
    if outer_wall_base > 0:
        outer_wall = max(0, outer_wall_base + wall_offset_mm)
    else:
        outer_wall = 0
    
    heel_cup = float(profiles['heel_cup'](x_ratio)) * heel_cup_scale
    arch_outer = float(profiles['arch_outer'](x_ratio)) * arch_scale
    arch_inner = float(profiles['arch_inner'](x_ratio)) * arch_scale
    arch_transverse = float(profiles['arch_transverse'](x_ratio)) * arch_scale
    
    # ヒールカップ領域の動的決定
    landmark_settings = profiles.get('landmark_settings', {})
    medial_start = landmark_settings.get('arch_start', 15.0)
    lateral_start = landmark_settings.get('lateral_arch_start', 20.0)
    
    # Y位置に応じてヒールカップ領域を補間
    # arch_y_ratio: 0=外側, 1=内側
    heel_cup_region = lateral_start * (1 - arch_y_ratio) + medial_start * arch_y_ratio
    
    # 高さを計算
    height = base_thickness
    
    if is_boundary:
        # 輪郭上の点: 壁またはヒールカップの高さ

        # 通常の壁高さ（Y位置に応じて内壁・外壁を補間）
        normal_wall_height = outer_wall * (1 - arch_y_ratio) + inner_wall * arch_y_ratio

        # ヒールカップ領域の判定を輪郭形状に基づいて行う
        # かかと後端の中心点からの距離で判定（X座標だけでなく形状を考慮）
        heel_cup_region_mm = (heel_cup_region / 100.0) * length
        transition_zone_mm = (5.0 / 100.0) * length  # 5%をmm単位に

        if outline is not None:
            heel_center = _get_heel_center(outline, x_min)
            dist_from_heel_center = np.sqrt((x - heel_center[0])**2 + (y - heel_center[1])**2)
            in_heel_cup = dist_from_heel_center <= heel_cup_region_mm
            in_transition = (dist_from_heel_center > heel_cup_region_mm - transition_zone_mm and
                           dist_from_heel_center <= heel_cup_region_mm)
        else:
            # フォールバック: 従来のX座標ベースの判定
            dist_from_heel_center = (x_ratio / 100.0) * length
            in_heel_cup = x_ratio <= heel_cup_region
            in_transition = x_ratio > heel_cup_region - 5.0 and x_ratio <= heel_cup_region

        if in_heel_cup:
            # 均一化した壁高さ（内壁と外壁の平均）
            uniform_wall_height = (inner_wall + outer_wall) / 2.0

            # 領域境界付近でのスムージング
            if in_transition:
                t = (dist_from_heel_center - (heel_cup_region_mm - transition_zone_mm)) / transition_zone_mm
                t = np.clip(t, 0, 1)
                wall_height = uniform_wall_height * (1 - t) + normal_wall_height * t
            else:
                wall_height = uniform_wall_height

            # 壁とヒールカップの大きい方を使用
            wall_height = max(wall_height, heel_cup)
        else:
            wall_height = normal_wall_height

        height += wall_height
    else:
        # 内部の点: アーチの高さ
        # 縁からの距離に応じて壁→アーチへ遷移
        
        # Y方向：縁からの距離を計算（実際の距離、mm）
        local_width = y_max_at_x - y_min_at_x
        dist_from_outer_mm = y_ratio * local_width
        dist_from_inner_mm = (1.0 - y_ratio) * local_width
        
        # X方向：ヒールカップ領域では輪郭からの最短距離を使用
        # これにより、かかと後端の丸い形状に沿ったトランジションになる
        if x_ratio <= heel_cup_region and outline is not None:
            dist_from_heel_mm = _distance_to_outline(x, y, outline)
        else:
            dist_from_heel_mm = (x_ratio / 100.0) * length

        # ヒールカップ領域の処理
        heel_cup_region_mm = (heel_cup_region / 100.0) * length
        
        # Y方向遷移距離（基本値、mm） - 短縮して壁を鋭く立ち上げる
        base_y_transition_mm = 10.0

        # かかと後端（0-10%）では輪郭幅に応じてY方向遷移距離を制限
        # これにより狭い部分でも輪郭形状に沿った遷移になる
        if x_ratio <= 10.0 and local_width > 0:
            # 幅の35%を最大遷移距離とする（両側合計70%まで）
            max_y_transition = local_width * 0.35
            base_y_transition_mm = min(base_y_transition_mm, max_y_transition)

        # X方向遷移距離（ヒールカップ領域内のみ）
        x_transition_mm = 10.0 if x_ratio <= heel_cup_region else 0.0
        
        # 壁の高さ（内側・外側それぞれ）
        max_inner_wall = 10.0
        if inner_wall > 0:
            inner_wall_factor = min(1.0, inner_wall / max_inner_wall)
        else:
            inner_wall_factor = 0
        inner_transition_mm = base_y_transition_mm * inner_wall_factor
        
        max_outer_wall = 8.0
        if outer_wall > 0:
            outer_wall_factor = min(1.0, outer_wall / max_outer_wall)
        else:
            outer_wall_factor = 0
        outer_transition_mm = base_y_transition_mm * outer_wall_factor
        
        # 壁の高さ（Y位置に応じて補間）
        wall_height = outer_wall * (1 - arch_y_ratio) + inner_wall * arch_y_ratio
        
        # ヒールカップの高さを加算（内部の凹み）
        heel_cup_height = 0.0
        if x_ratio <= heel_cup_region:
            # 領域内で最大、境界に向かって0へ
            # 簡易的に中心から離れるほど浅くするロジックが必要だが
            # ここでは profiles['heel_cup'] を使う
            # ただし profiles['heel_cup'] はX依存のみ
            
            # X方向の減衰（領域端で0になるように）
            x_factor = 1.0
            if x_ratio > heel_cup_region * 0.5: # 前半はフラット、後半減衰
                 t = (x_ratio - heel_cup_region * 0.5) / (heel_cup_region * 0.5)
                 x_factor = 1.0 - t
                 
            # Y方向の減衰（中心で最大、縁で最小...ではなく縁は壁高さ）
            # ここでのheel_cup_heightは「底上げ」ではなく「凹み」として機能させたいが
            # 現在のロジックは「高さの加算」
            # ヒールカップは「縁が高く、中心が低い」
            # wall_height は縁の高さ。そこから中心に向かって低くなる（transitionで実現）
            # profiles['heel_cup'] は「縁の高さ」を定義している
            
            # なので、ここでは heel_cup_height は加算しない（transitionで自然に下がる）
            pass
        
        # アーチの高さを計算
        longitudinal_arch_height = 0.0
        transverse_arch_height = 0.0
        
        arch_settings = profiles['arch_settings']
        medial_y_start = arch_settings.get('medial_y_start', 65.0) / 100.0
        medial_y_end = arch_settings.get('medial_y_end', 100.0) / 100.0
        lateral_y_start = arch_settings.get('lateral_y_start', 0.0) / 100.0
        lateral_y_end = arch_settings.get('lateral_y_end', 25.0) / 100.0
        transverse_y_start = arch_settings.get('transverse_y_start', 25.0) / 100.0
        transverse_y_end = arch_settings.get('transverse_y_end', 65.0) / 100.0

        if arch_y_ratio >= medial_y_start:
            y_range = medial_y_end - medial_y_start
            if y_range > 0:
                inner_factor = min(1.0, (arch_y_ratio - medial_y_start) / y_range)
                longitudinal_arch_height = arch_inner * inner_factor
            else:
                longitudinal_arch_height = arch_inner
        elif arch_y_ratio <= lateral_y_end:
            y_range = lateral_y_end - lateral_y_start
            if y_range > 0:
                outer_factor = max(0.0, 1.0 - ((arch_y_ratio - lateral_y_start) / y_range))
                longitudinal_arch_height = arch_outer * outer_factor
            else:
                longitudinal_arch_height = arch_outer

        if arch_transverse > 0 and transverse_y_start <= arch_y_ratio <= transverse_y_end:
            center = (transverse_y_start + transverse_y_end) / 2
            half_range = (transverse_y_end - transverse_y_start) / 2
            if half_range > 0:
                center_dist = abs(arch_y_ratio - center)
                transverse_factor = max(0.0, 1.0 - (center_dist / half_range))
                transverse_factor = transverse_factor * transverse_factor * (3 - 2 * transverse_factor)
                transverse_arch_height = arch_transverse * transverse_factor
        
        arch_height = max(longitudinal_arch_height, transverse_arch_height)
        
        # ブレンド係数を計算
        y_blend = 1.0
        x_blend = 1.0
        blend = 1.0

        # ヒールカップ領域では輪郭からの最短距離を使用した統一トランジション
        # これにより、かかと後端の曲線形状に沿ったトランジションになる
        if x_ratio <= heel_cup_region and outline is not None:
            # 輪郭からの最短距離を使用
            dist_from_boundary = _distance_to_outline(x, y, outline)
            transition_offset = 2.0  # Heel cup: 2mm shelf
            transition_distance = base_y_transition_mm  # 遷移距離

            if dist_from_boundary < transition_offset:
                blend = 0.0  # 垂直区間（壁高さ100%）
            elif dist_from_boundary < transition_distance:
                raw_t = (dist_from_boundary - transition_offset) / (transition_distance - transition_offset)
                raw_t = min(1.0, max(0.0, raw_t))
                blend = raw_t * raw_t * raw_t  # t³カーブ
            else:
                blend = 1.0  # 中心（アーチ高さ）
        else:
            # 通常領域：Y方向とX方向を別々に計算
            # Y方向遷移（内側縁または外側縁、近い方）
            if x_ratio <= heel_cup_region + 5.0:
                t_off = (x_ratio - heel_cup_region) / 5.0 if x_ratio > heel_cup_region else 0.0
                transition_offset = 2.0 * (1 - t_off) + 1.0 * t_off
            else:
                transition_offset = 1.0  # Normal walls: 1mm shelf

            if dist_from_inner_mm < dist_from_outer_mm:
                if inner_transition_mm > transition_offset:
                    if dist_from_inner_mm < transition_offset:
                        y_blend = 0.0  # 垂直区間
                    else:
                        raw_t = min(1.0, (dist_from_inner_mm - transition_offset) / (inner_transition_mm - transition_offset))
                        y_blend = raw_t * raw_t * raw_t  # t³
            else:
                if outer_transition_mm > transition_offset:
                    if dist_from_outer_mm < transition_offset:
                        y_blend = 0.0  # 垂直区間
                    else:
                        raw_t = min(1.0, (dist_from_outer_mm - transition_offset) / (outer_transition_mm - transition_offset))
                        y_blend = raw_t * raw_t * raw_t  # t³

            # X方向遷移（ヒールカップ領域境界付近のみ）
            x_transition_offset = 1.0
            if x_transition_mm > x_transition_offset and dist_from_heel_mm < x_transition_mm:
                if dist_from_heel_mm < x_transition_offset:
                    x_blend = 0.0  # 垂直区間
                else:
                    raw_t = min(1.0, (dist_from_heel_mm - x_transition_offset) / (x_transition_mm - x_transition_offset))
                    x_blend = raw_t * raw_t * raw_t  # t³

            # 両方向のブレンドを組み合わせ（小さい方を採用）
            blend = min(y_blend, x_blend)
        
        # ヒールカップの高さを加算（内部の凹み）ではなく、ターゲット高さとして扱う
        # 中心点（blend=1）での目標高さを決定
        if x_ratio <= heel_cup_region:
            # ヒール領域: アーチ高さとヒールカップ高さの高い方
            # heel_cup変数はユーザー指定の高さ（スケーリング済み）
            target_center_height = max(arch_height, heel_cup)
        else:
            # アーチ領域: アーチ高さのみ
            target_center_height = arch_height
        
        # ブレンド適用
        # blend=0: 壁（高い）, blend=1: 中心（低い、またはアーチ）
        blended_height = wall_height * (1 - blend) + target_center_height * blend
        height += blended_height
    
    return height


def _smooth_boundary_z(top_vertices, n_boundary, x_min, x_max, window=7):
    """Smooth Z-values of boundary vertices along the outline path (XY preserved).
    Only applies in heel cup region (x_ratio <= 25%) with fade-out to 35%.
    """
    if n_boundary < window:
        return top_vertices
    z_vals = top_vertices[:n_boundary, 2].copy()
    smoothed = z_vals.copy()
    half = window // 2
    for i in range(n_boundary):
        indices = [(i + j) % n_boundary for j in range(-half, half + 1)]
        smoothed[i] = np.mean(z_vals[indices])
    length = x_max - x_min
    for i in range(n_boundary):
        x_ratio = (top_vertices[i, 0] - x_min) / length * 100 if length > 0 else 50
        if x_ratio <= 25:
            alpha = 1.0
        elif x_ratio <= 35:
            alpha = 1.0 - (x_ratio - 25) / 10.0
        else:
            alpha = 0.0
        top_vertices[i, 2] = z_vals[i] * (1 - alpha) + smoothed[i] * alpha
    return top_vertices


def _resample_outline_heel_region(outline, x_min, x_max, target_spacing_mm=0.5,
                                   heel_end_ratio=30.0, blend_ratio=5.0):
    """Resample outline with higher point density in the heel cup region.
    Uses linear interpolation between consecutive vertices.
    """
    n = len(outline)
    length = x_max - x_min
    if length <= 0:
        return outline
    new_points = []
    for i in range(n):
        p0 = outline[i]
        p1 = outline[(i + 1) % n]
        new_points.append(p0)
        seg_len = np.sqrt((p1[0] - p0[0])**2 + (p1[1] - p0[1])**2)
        mid_x = (p0[0] + p1[0]) / 2.0
        x_ratio = (mid_x - x_min) / length * 100.0
        if x_ratio <= heel_end_ratio:
            desired_spacing = target_spacing_mm
        elif x_ratio <= heel_end_ratio + blend_ratio:
            t = (x_ratio - heel_end_ratio) / blend_ratio
            desired_spacing = target_spacing_mm + t * (seg_len - target_spacing_mm)
            desired_spacing = min(desired_spacing, seg_len)
        else:
            desired_spacing = seg_len
        if desired_spacing < seg_len and desired_spacing > 0:
            n_sub = int(np.ceil(seg_len / desired_spacing))
            if n_sub > 1:
                for j in range(1, n_sub):
                    frac = j / n_sub
                    new_points.append(p0 + frac * (p1 - p0))
    return np.array(new_points)


# =============================================================================
# メッシュ生成
# =============================================================================

def generate_insole_mesh(
    outline: np.ndarray,
    base_thickness: float = 3.0,
    arch_scale: float = 1.0,
    wall_offset_mm: float = 0.0,
    heel_cup_scale: float = 1.0,
    grid_spacing: float = 1.0,
    arch_settings: dict = None,
    is_right_foot: bool = False,
    landmark_settings: dict = None,
    wall_params: dict = None,
    heel_cup_height: float = None
) -> trimesh.Trimesh:
    """
    ハイブリッド方式でインソールメッシュを生成
    
    Args:
        outline: 輪郭点配列
        base_thickness: ベース厚み (mm)
        arch_scale: アーチ高さの倍率
        wall_offset_mm: 壁高さオフセット (mm)
        heel_cup_scale: ヒールカップ倍率
        grid_spacing: グリッド間隔 (mm)
        arch_settings: アーチ設定辞書 (簡易版設定)
        is_right_foot: 右足の場合True（アーチの内側/外側を反転）
        landmark_settings: 骨ランドマーク設定辞書 (壁プロファイルに使用)
        wall_params: 壁パラメータ辞書 (内壁・外壁の高さ/位置制御)
        heel_cup_height: ヒールカップ高さ(mm) - 指定時はscaleより優先
    """
    print(f"[INFO] === MasaCAD v4.3 アーチ簡易設定対応 ===")
    print(f"[INFO] 足の側: {'右足' if is_right_foot else '左足'}")
    
    # ヒールカップ高さ(mm)が指定された場合、scaleを逆算
    if heel_cup_height is not None and heel_cup_height > 0:
        base_h = HEEL_CUP_PROFILE.get(0.0, 1.8)
        heel_cup_scale = heel_cup_height / base_h
        print(f"[INFO] ヒールカップ高さ指定: {heel_cup_height}mm (scale={heel_cup_scale:.2f})")
    
    # 壁パラメータ情報
    if wall_params:
        print(f"[INFO] 壁パラメータ: {wall_params}")

    # 重複点を除去
    if np.allclose(outline[0], outline[-1]):
        outline = outline[:-1]
    outline = _resample_outline_heel_region(
        outline, outline[:, 0].min(), outline[:, 0].max()
    )
    n_boundary = len(outline)
    print(f"[INFO] 輪郭点数: {n_boundary}")
    
    # プロファイル補間関数（アーチ設定とランドマーク設定を適用）
    profiles = create_profile_interpolators(arch_settings, landmark_settings, wall_params)
    
    # 輪郭範囲
    x_min, x_max = outline[:, 0].min(), outline[:, 0].max()
    y_min_global, y_max_global = outline[:, 1].min(), outline[:, 1].max()
    
    # Y範囲の補間関数
    f_y_min, f_y_max, _, _ = get_outline_y_bounds(outline)
    
    print(f"[INFO] 輪郭範囲: X={x_min:.1f}-{x_max:.1f}, Y={y_min_global:.1f}-{y_max_global:.1f}")
    
    # ========================================
    # STEP 1: 内部グリッド点を生成
    # ========================================
    print(f"[STEP 1] 内部グリッド生成...")
    
    # Use matplotlib.path for robust point-in-polygon
    outline_path = MplPath(outline)
    
    # Vectorized grid generation
    x_vals = np.arange(x_min + grid_spacing, x_max, grid_spacing)
    y_vals = np.arange(y_min_global + grid_spacing, y_max_global, grid_spacing)
    
    if len(x_vals) > 0 and len(y_vals) > 0:
        xx, yy = np.meshgrid(x_vals, y_vals)
        grid_candidates = np.column_stack([xx.ravel(), yy.ravel()])
        
        # Check inclusion
        mask = outline_path.contains_points(grid_candidates)
        interior_points = grid_candidates[mask]
    else:
        interior_points = np.empty((0, 2))

    print(f"[INFO] 内部点数: {len(interior_points)}")
    
    # ========================================
    # STEP 2: 全頂点を結合
    # ========================================
    print(f"[STEP 2] 頂点結合...")
    
    all_2d_points = np.vstack([outline, interior_points]) if len(interior_points) > 0 else outline
    n_total = len(all_2d_points)
    
    # 境界フラグ
    is_boundary = np.zeros(n_total, dtype=bool)
    is_boundary[:n_boundary] = True
    
    print(f"[INFO] 総頂点数: {n_total}")
    
    # ========================================
    # STEP 3: 上面の高さを計算
    # ========================================
    print(f"[STEP 3] 上面高さ計算...")
    
    top_vertices = []
    
    for i, pt in enumerate(all_2d_points):
        x, y = pt
        
        # このX位置でのY範囲
        y_min_local = float(f_y_min(x))
        y_max_local = float(f_y_max(x))
        
        z = calculate_height(
            x, y,
            x_min, x_max,
            y_min_local, y_max_local,
            profiles,
            base_thickness,
            is_boundary=is_boundary[i],
            arch_scale=arch_scale,
            wall_offset_mm=wall_offset_mm,
            heel_cup_scale=heel_cup_scale,
            is_right_foot=is_right_foot,
            outline=outline
        )
        
        top_vertices.append([x, y, z])
    
    top_vertices = np.array(top_vertices)
    # Dynamic Z-smoothing window based on resampled point density
    _avg_spacing = np.mean(np.sqrt(np.sum(np.diff(outline, axis=0)**2, axis=1)))
    _smooth_window = max(7, int(10.0 / _avg_spacing))
    if _smooth_window % 2 == 0:
        _smooth_window += 1
    top_vertices = _smooth_boundary_z(top_vertices, n_boundary, x_min, x_max, window=_smooth_window)

    # ========================================
    # STEP 4: 底面頂点（Z=0）
    # ========================================
    print(f"[STEP 4] 底面頂点生成...")
    
    bottom_vertices = np.column_stack([all_2d_points, np.zeros(n_total)])
    
    # ========================================
    # STEP 5: 三角形分割
    # ========================================
    print(f"[STEP 5] 三角形分割...")
    
    try:
        tri = Delaunay(all_2d_points)
        faces = tri.simplices
        
        # ポリゴン外部の三角形を除去
        valid_faces = []
        for face in faces:
            # 三角形の重心
            centroid = all_2d_points[face].mean(axis=0)
            if point_in_polygon(centroid, outline):
                valid_faces.append(face)
        
        top_faces = np.array(valid_faces)
        print(f"[INFO] 有効な面数: {len(top_faces)}")
        
    except Exception as e:
        print(f"[ERROR] 三角形分割失敗: {e}")
        raise
    
    # ========================================
    # STEP 6: 底面の面（法線反転）
    # ========================================
    print(f"[STEP 6] 底面面生成...")
    
    bottom_offset = n_total
    bottom_faces = []
    for face in top_faces:
        bottom_faces.append([
            face[0] + bottom_offset,
            face[2] + bottom_offset,
            face[1] + bottom_offset
        ])
    bottom_faces = np.array(bottom_faces)
    
    # ========================================
    # STEP 7: 側面（輪郭外周）
    # ========================================
    print(f"[STEP 7] 側面生成...")
    
    side_faces = []
    for i in range(n_boundary):
        next_i = (i + 1) % n_boundary
        
        t0, t1 = i, next_i
        b0, b1 = i + bottom_offset, next_i + bottom_offset
        
        side_faces.append([t0, b0, t1])
        side_faces.append([t1, b0, b1])
    
    side_faces = np.array(side_faces)
    
    # ========================================
    # STEP 8: メッシュ組み立て
    # ========================================
    print(f"[STEP 8] メッシュ組み立て...")
    
    all_vertices = np.vstack([top_vertices, bottom_vertices])
    all_faces = np.vstack([top_faces, bottom_faces, side_faces])
    
    mesh = trimesh.Trimesh(vertices=all_vertices, faces=all_faces)
    
    # ========================================
    # STEP 9: 検証・修復・スムージング
    # ========================================
    print(f"[STEP 9] 検証・修復・スムージング...")
    
    mesh.fix_normals()
    mesh.fill_holes()
    mesh.merge_vertices()
    mesh.update_faces(mesh.nondegenerate_faces())
    
    # 内部点のみスムージング（壁/輪郭点は除外、底面も除外）
    # Laplacianスムージング（2回適用）
    try:
        # 内部点のインデックス（輪郭点以外の上面点）
        # top_verticesの最初のn_boundary個は輪郭点
        # それ以降が内部点
        interior_start = n_boundary  # 内部点の開始インデックス
        interior_end = n_total  # 内部点の終了インデックス（上面のみ）
        
        # 内部点のインデックス（上面のみ）
        interior_indices = list(range(interior_start, interior_end))
        
        if len(interior_indices) > 0:
            vertices = mesh.vertices.copy()
            
            for iteration in range(1):  # 1回のみ（高速化）
                new_z = vertices[:, 2].copy()
                
                for idx in interior_indices:
                    # この頂点を含む面を検索
                    face_mask = np.any(mesh.faces == idx, axis=1)
                    neighbor_indices = np.unique(mesh.faces[face_mask].flatten())
                    neighbor_indices = neighbor_indices[neighbor_indices != idx]
                    
                    # 隣接する上面頂点のみ（底面は除外）
                    neighbor_top = neighbor_indices[neighbor_indices < n_total]
                    
                    if len(neighbor_top) > 0:
                        # 自分の値と隣接値の平均（ラプラシアンスムージング）
                        avg_z = np.mean(vertices[neighbor_top, 2])
                        new_z[idx] = 0.7 * vertices[idx, 2] + 0.3 * avg_z
                
                vertices[:, 2] = new_z
            
            mesh.vertices = vertices
            print(f"[INFO] 内部点スムージング完了（{len(interior_indices)}点）")
    except Exception as e:
        print(f"[WARN] スムージングスキップ: {e}")
    
    # サブディビジョンは無効化（壁の形状を維持するため）
    # 代わりにグリッド密度とLaplacianスムージングで滑らかさを実現
    
    # 検証
    print(f"\n[VALIDATION]")
    print(f"  watertight: {mesh.is_watertight}")
    print(f"  頂点数: {len(mesh.vertices)}")
    print(f"  面数: {len(mesh.faces)}")
    
    bounds = mesh.bounds
    print(f"  サイズ: X={bounds[1][0]-bounds[0][0]:.1f}, "
          f"Y={bounds[1][1]-bounds[0][1]:.1f}, Z={bounds[1][2]-bounds[0][2]:.1f} mm")
    
    # 底面平坦性
    z_min = mesh.vertices[:, 2].min()
    bottom_verts = mesh.vertices[mesh.vertices[:, 2] < z_min + 0.1]
    z_range = bottom_verts[:, 2].max() - bottom_verts[:, 2].min()
    print(f"  底面平坦性: Z範囲={z_range:.4f}mm {'[OK]' if z_range < 0.01 else '[WARN]'}")
    
    print(f"\n[INFO] === MasaCAD v4.2 生成完了 ===")
    
    return mesh


# =============================================================================
# 高レベルAPI
# =============================================================================

def generate_insole_from_outline(
    outline_csv_path: Optional[Path] = None, # Made optional
    outline_points: Optional[List[Dict[str, float]]] = None, # New argument
    flip_x: bool = False,
    flip_y: bool = False,
    base_thickness: float = 3.0,
    arch_scale: float = 1.0,
    wall_height_offset_mm: float = 0.0,
    heel_cup_scale: float = 1.0,
    grid_spacing: float = 1.0,
    arch_settings: dict = None,
    landmark_settings: dict = None,
    wall_params: dict = None,
    heel_cup_height: float = None,
    progress_callback: callable = None
) -> trimesh.Trimesh:
    """
    輪郭CSVまたは点群からインソールを生成
    """
    if progress_callback:
        progress_callback("Loading outline...", 5)
        
    if outline_points:
        # Use provided points
        outline_np = np.array([[p['x'], p['y']] for p in outline_points])
        
        if flip_x:
            outline_np[:, 0] = outline_np[:, 0].max() - outline_np[:, 0]
        if flip_y:
            outline_np[:, 1] = outline_np[:, 1].max() - outline_np[:, 1]
            
        outline_np[:, 0] -= outline_np[:, 0].min()
        outline_np[:, 1] -= outline_np[:, 1].min()
        
    elif outline_csv_path:
        outline_np = load_outline_csv(outline_csv_path, flip_x=flip_x, flip_y=flip_y)
    else:
        raise ValueError("Either outline_csv_path or outline_points must be provided")
    
    # flip_yがTrueの場合は右足として扱う
    is_right_foot = flip_y
    # 3. メッシュ生成
    if progress_callback:
        progress_callback("Generating insole mesh...", 20)
        
    mesh = generate_insole_mesh(
        outline=outline_np,
        base_thickness=base_thickness,
        arch_scale=arch_scale,
        wall_offset_mm=wall_height_offset_mm,
        heel_cup_scale=heel_cup_scale,
        grid_spacing=grid_spacing,
        arch_settings=arch_settings,
        is_right_foot=flip_y, # 反転されているか渡す（ランドマーク判定用）
        landmark_settings=landmark_settings,
        wall_params=wall_params,
        heel_cup_height=heel_cup_height
    )
    
    if progress_callback:
        progress_callback("Validating base mesh...", 40)
    
    return mesh


def export_mesh(mesh: trimesh.Trimesh, output_path: Path):
    """メッシュをファイルに出力"""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    if output_path.suffix.lower() == '.stl':
        mesh.export(output_path, file_type='stl')
    elif output_path.suffix.lower() == '.glb':
        mesh.export(output_path, file_type='glb')
    else:
        mesh.export(output_path)
    
    print(f"[INFO] エクスポート: {output_path} ({output_path.stat().st_size / 1024:.1f} KB)")



def _estimate_sample_step(xy_points: np.ndarray, fallback: float = 1.0) -> float:
    """Estimate grid step from sampled XY points."""
    if len(xy_points) < 2:
        return fallback
    
    def min_positive_step(values: np.ndarray) -> float:
        sorted_vals = np.sort(np.unique(values))
        diffs = np.diff(sorted_vals)
        positive_diffs = diffs[diffs > 1e-6]
        return np.min(positive_diffs) if len(positive_diffs) > 0 else fallback

    xs = xy_points[:, 0]
    ys = xy_points[:, 1]
    step_x = min_positive_step(xs)
    step_y = min_positive_step(ys)
    return max(0.1, min(step_x, step_y))


def _build_solid_from_height_maps(
    outline_points: np.ndarray,
    top_height_map: Dict[tuple, float],
    bottom_height_map: Dict[tuple, float],
    sample_step: Optional[float] = None
) -> trimesh.Trimesh:
    """
    Build a watertight solid mesh from outline and height maps.
    Optimized with vectorized operations.
    """
    if outline_points is None or len(outline_points) < 3:
        return trimesh.Trimesh()

    outline = np.array(outline_points, dtype=float)
    if np.allclose(outline[0], outline[-1]):
        outline = outline[:-1]
    if len(outline) < 3:
        return trimesh.Trimesh()

    xy_points = np.array(list(top_height_map.keys()), dtype=float)
    if len(xy_points) < 3:
        return trimesh.Trimesh()

    top_z = np.array([top_height_map[tuple(p)] for p in xy_points], dtype=float)
    bottom_z = np.array([bottom_height_map[tuple(p)] for p in xy_points], dtype=float)

    z_max = float(np.max(top_z))
    z_min = float(np.min(bottom_z))

    top_interp = LinearNDInterpolator(xy_points, top_z, fill_value=z_max)
    bottom_interp = LinearNDInterpolator(xy_points, bottom_z, fill_value=z_min)

    if sample_step is None:
        sample_step = _estimate_sample_step(xy_points)

    x_min, x_max = outline[:, 0].min(), outline[:, 0].max()
    y_min, y_max = outline[:, 1].min(), outline[:, 1].max()

    x_steps = int((x_max - x_min) / sample_step)
    y_steps = int((y_max - y_min) / sample_step)

    # Vectorized grid generation
    if x_steps > 0 and y_steps > 0:
        x_coords = np.arange(x_min + sample_step, x_max, sample_step)
        y_coords = np.arange(y_min + sample_step, y_max, sample_step)
        
        if x_coords.size > 0 and y_coords.size > 0:
            xx, yy = np.meshgrid(x_coords, y_coords)
            grid_points = np.column_stack([xx.ravel(), yy.ravel()])
            
            outline_path = MplPath(outline)
            mask = outline_path.contains_points(grid_points)
            interior_points = grid_points[mask]
        else:
            interior_points = np.empty((0, 2))
    else:
        interior_points = np.empty((0, 2))

    all_2d_points = (
        np.vstack([outline, interior_points]) if len(interior_points) > 0 else outline
    )
    n_boundary = len(outline)
    n_total = len(all_2d_points)

    # Vectorized height interpolation
    z_top_all = top_interp(all_2d_points)
    z_bottom_all = bottom_interp(all_2d_points)
    
    # Fill Nans just in case
    z_top_all = np.nan_to_num(z_top_all, nan=z_max)
    z_bottom_all = np.nan_to_num(z_bottom_all, nan=z_min)
    
    # Ensure z_top >= z_bottom
    z_top_all = np.maximum(z_top_all, z_bottom_all)
    
    top_vertices = np.column_stack([all_2d_points, z_top_all])
    bottom_vertices = np.column_stack([all_2d_points, z_bottom_all])

    try:
        tri = Delaunay(all_2d_points)
        faces = tri.simplices
        
        # Vectorized face validation
        centroids = all_2d_points[faces].mean(axis=1)
        outline_path_check = MplPath(outline)
        valid_mask = outline_path_check.contains_points(centroids)
        top_faces = faces[valid_mask]
        
    except Exception as e:
        print(f"[ERROR] Delaunay failed: {e}")
        return trimesh.Trimesh()

    bottom_offset = n_total
    # Flip winding for bottom faces: [0, 2, 1]
    bottom_faces = top_faces[:, [0, 2, 1]] + bottom_offset

    side_faces = []
    for i in range(n_boundary):
        next_i = (i + 1) % n_boundary
        t0, t1 = i, next_i
        b0, b1 = i + bottom_offset, next_i + bottom_offset
        side_faces.append([t0, b0, t1])
        side_faces.append([t1, b0, b1])
    side_faces = np.array(side_faces)

    all_vertices = np.vstack([top_vertices, bottom_vertices])
    all_faces = np.vstack([top_faces, bottom_faces, side_faces])
    
    mesh = trimesh.Trimesh(vertices=all_vertices, faces=all_faces)
    mesh.fix_normals()
    return mesh


def generate_hollow_shell(
    outline_points: np.ndarray,
    top_height_map: Dict[tuple, float],
    bottom_height_map: Dict[tuple, float],
    wall_thickness: float = 0.8,
    top_skin: float = 0.4,
    bottom_skin: float = 0.4,
    outer_mesh: trimesh.Trimesh = None,
    sample_step: float = 1.0
) -> Tuple[trimesh.Trimesh, trimesh.Trimesh]:
    """
    Generate a hollow shell and inner volume.
    """
    if outer_mesh is not None and len(outer_mesh.vertices) > 0:
        outer_solid = outer_mesh
        print(f"[HOLLOW-SHELL] Using provided mesh as outer solid ({len(outer_solid.vertices)} verts)")
    else:
        print(f"[HOLLOW-SHELL] Generating outer solid (step={sample_step})...")
        outer_solid = _build_solid_from_height_maps(
            outline_points, top_height_map, bottom_height_map, sample_step=sample_step
        )

    try:
        from shapely.geometry import Polygon
    except:
        return outer_solid, trimesh.Trimesh()

    outline = np.array(outline_points, dtype=float)
    if np.allclose(outline[0], outline[-1]):
        outline = outline[:-1]
    polygon = Polygon(outline)
    inner_polygon = polygon.buffer(-wall_thickness)

    if inner_polygon.is_empty:
        return outer_solid, trimesh.Trimesh()

    if inner_polygon.geom_type == "MultiPolygon":
        inner_polygon = max(inner_polygon.geoms, key=lambda p: p.area)

    inner_outline = np.array(inner_polygon.exterior.coords)

    inner_top = {}
    inner_bottom = {}
    for key, value in top_height_map.items():
        inner_top[key] = value - top_skin
    for key, value in bottom_height_map.items():
        inner_bottom[key] = value + bottom_skin

    min_gap = 0.05
    for key in inner_top.keys():
        if inner_top[key] < inner_bottom.get(key, inner_top[key]) + min_gap:
            inner_top[key] = inner_bottom.get(key, inner_top[key]) + min_gap

    print(f"[HOLLOW-SHELL] Generating inner solid (step={sample_step})...")
    inner_solid = _build_solid_from_height_maps(
        inner_outline, inner_top, inner_bottom, sample_step=sample_step
    )

    # Prefer manifold, fallback to blender
    try:
        hollow_shell = outer_solid.difference(inner_solid, engine="manifold")
        print(f"[HOLLOW-SHELL] manifold difference successful, watertight: {hollow_shell.is_watertight}")
    except Exception as e:
        print(f"[HOLLOW-SHELL] manifold failed: {e}, trying blender...")
        try:
            hollow_shell = outer_solid.difference(inner_solid, engine="blender")
            print(f"[HOLLOW-SHELL] blender difference successful")
        except Exception as e2:
            print(f"[HOLLOW-SHELL] blender also failed: {e2}, returning outer solid")
            hollow_shell = outer_solid

    return hollow_shell, inner_solid


# =============================================================================
# テスト
# =============================================================================

if __name__ == "__main__":
    print("=" * 60)
    print("MasaCAD v4.2 テスト")
    print("=" * 60)
    
    test_outline_path = PROJECT_ROOT / "patients" / "0001" / "outline.csv"
    
    if test_outline_path.exists():
        print(f"[BOOT] generate_insole_from_outline: {test_outline_path}")
        
        # Dummy progress callback for testing
        def test_progress_callback(message, percentage):
            print(f"Progress: {percentage}% - {message}")

        mesh = generate_insole_from_outline(
            test_outline_path,
            base_thickness=3.0,
            arch_scale=1.0, # Added arch_scale
            wall_height_offset_mm=0.0, # Added wall_height_offset_mm
            heel_cup_scale=1.0,
            progress_callback=test_progress_callback # Pass the callback
        )
        
        output_path = EXPORTS_DIR / "test_v4_insole.stl"
        export_mesh(mesh, output_path)
    else:
        print(f"[ERROR] テスト輪郭が見つかりません: {test_outline_path}")
