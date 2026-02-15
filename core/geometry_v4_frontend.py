"MasaCAD Core - Geometry Module v4.2\nハイブリッド方式：輪郭維持 + テンプレートプロファイル\n\n設計思想:\n- 輪郭CSVの閉じたループを正確に維持（端部が自然に閉じる）\n- 輪郭内部にグリッド頂点を追加\n- テンプレートから抽出したプロファイルで高さを制御\n- アーチ・ヒールカップ・壁が正確に再現される\n- 底面は完全に平坦（Z=0）\n\n座標系:\n- X: 0=つま先、max=踵\n- Y: 0=外側（小指側）、max=内側（土踏まず側）\n- Z: 0=底面、up=上面\n\n作成日: 2024-12-28\n"

import numpy as np
from scipy.interpolate import CubicSpline, interp1d, LinearNDInterpolator
from scipy.spatial import Delaunay
import trimesh
from matplotlib.path import Path as MplPath
import datetime
from typing import Dict, Optional, Tuple, List
from pathlib import Path

# プロジェクトルート
PROJECT_ROOT = Path(__file__).parent.parent.resolve()
EXPORTS_DIR = PROJECT_ROOT / "exports"

# バージョン情報
GEOMETRY_VERSION = "v4.3-arch-simple-2025-01-04"
print(f"[BOOT] geometry_v4 loaded: {GEOMETRY_VERSION}")

def log_debug(msg):
    try:
        with open(PROJECT_ROOT / "debug_frontend.log", "a", encoding="utf-8") as f:
            timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            f.write(f"[{timestamp}] {msg}\n")
    except Exception:
        pass

# =============================================================================
# 設計ルール（テンプレートから抽出）
# =============================================================================

# 座標系: X=0%=踵、X=100%=つま先（輪郭CSV基準）
# Y=0=外側、Y=1=内側

# 壁高さプロファイル（X位置% → (内壁高さmm, 外壁高さmm)）
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

DEFAULT_ARCH_SETTINGS = {
    'medial_start': 15.0,
    'medial_end': 70.0,
    'medial_peak': 43.0,
    'medial_height': 1.0,
    'lateral_start': 20.0,
    'lateral_end': 45.0,
    'lateral_peak': 32.5,
    'lateral_height': 0.5,
    'transverse_start': 43.0,
    'transverse_end': 75.0,
    'transverse_peak': 59.0,
    'transverse_height': 0.5,
    'medial_y_start': 65.0,
    'medial_y_end': 100.0,
    'lateral_y_start': 0.0,
    'lateral_y_end': 25.0,
    'transverse_y_start': 25.0,
    'transverse_y_end': 65.0,
    'grid_cell_heights': None,
}


def generate_arch_profile(arch_settings: dict = None, landmark_settings: dict = None) -> dict:
    settings = DEFAULT_ARCH_SETTINGS.copy()
    if arch_settings:
        settings.update(arch_settings)

    log_debug(f"[ARCH] Final arch settings: medial_h={settings.get('medial_height')}, lateral_h={settings.get('lateral_height')}, transverse_h={settings.get('transverse_height')}")
    
    if landmark_settings and not arch_settings:
        ray1 = landmark_settings.get('ray1_boundary')
        ray5 = landmark_settings.get('ray5_boundary')
        if ray1 is not None:
            settings['medial_y_start'] = ray1 - 5.0
            settings['transverse_y_end'] = ray1 + 2.5
        if ray5 is not None:
            settings['lateral_y_end'] = ray5 + 5.0
            settings['transverse_y_start'] = ray5 - 2.5

    grid_heights = settings.get('grid_cell_heights', {}) or {}

    key_points = set([0.0, 10.0, 100.0])
    key_points.add(settings['medial_start'])
    key_points.add(settings['medial_peak'])
    key_points.add(settings['medial_end'])
    key_points.add(settings['lateral_start'])
    key_points.add(settings['lateral_peak'])
    key_points.add(settings['lateral_end'])
    key_points.add(settings['transverse_start'])
    key_points.add(settings['transverse_peak'])
    key_points.add(settings['transverse_end'])
    
    lm_pos = {
        'arch_start': settings['medial_start'],
        'subtalar': (settings['medial_start'] + settings['medial_peak']) / 2,
        'navicular': settings['medial_peak'],
        'cuboid': settings['lateral_end'],
        'medial_cuneiform': (settings['medial_peak'] + settings['medial_end']) / 2,
        'metatarsal': settings['medial_end'],
        'lateral_arch_start': settings['lateral_start'],
    }
    
    grid_definitions = [
        {'id': 'medial_1', 'type': 'medial', 'start': lm_pos['arch_start'], 'end': lm_pos['subtalar']},
        {'id': 'medial_2', 'type': 'medial', 'start': lm_pos['subtalar'], 'end': lm_pos['navicular']},
        {'id': 'medial_3', 'type': 'medial', 'start': lm_pos['navicular'], 'end': lm_pos['medial_cuneiform']},
        {'id': 'medial_4', 'type': 'medial', 'start': lm_pos['medial_cuneiform'], 'end': lm_pos['metatarsal']},
        {'id': 'lateral_1', 'type': 'lateral', 'start': lm_pos['lateral_arch_start'], 'end': lm_pos['cuboid']},
        {'id': 'transverse_1', 'type': 'transverse', 'start': lm_pos['navicular'], 'end': (lm_pos['navicular'] + lm_pos['metatarsal'])/2},
        {'id': 'transverse_2', 'type': 'transverse', 'start': (lm_pos['navicular'] + lm_pos['metatarsal'])/2, 'end': lm_pos['metatarsal']},
        {'id': 'transverse_3', 'type': 'transverse', 'start': lm_pos['metatarsal'], 'end': lm_pos['metatarsal'] + 5},
    ]

    for x in [15.0, 25.0, 35.0, 45.0, 50.0, 55.0, 65.0, 70.0, 80.0, 90.0]:
        key_points.add(x)
    
    key_points = sorted(key_points)
    profile = {}
    
    for x in key_points:
        medial_h = _calculate_arch_height(x, settings['medial_start'], settings['medial_peak'], settings['medial_end'], settings['medial_height'])
        lateral_h = _calculate_arch_height(x, settings['lateral_start'], settings['lateral_peak'], settings['lateral_end'], settings['lateral_height'])
        transverse_h = _calculate_arch_height(x, settings['transverse_start'], settings['transverse_peak'], settings['transverse_end'], settings['transverse_height'])
        
        if grid_heights:
            for cell in grid_definitions:
                if cell['start'] <= x <= cell['end']:
                    cell_h = grid_heights.get(cell['id'], 0.0)
                    if cell_h > 0:
                        edge_dist = min(x - cell['start'], cell['end'] - x)
                        blend_range = 2.0
                        factor = 1.0
                        if edge_dist < blend_range:
                            factor = edge_dist / blend_range
                            factor = factor * factor * (3 - 2 * factor)
                        effective_h = cell_h * factor
                        if cell['type'] == 'medial': medial_h = max(medial_h, effective_h)
                        elif cell['type'] == 'lateral': lateral_h = max(lateral_h, effective_h)
                        elif cell['type'] == 'transverse': transverse_h = max(transverse_h, effective_h)
        
        profile[x] = (lateral_h, medial_h, transverse_h)
    
    return profile


def _calculate_arch_height(x: float, start: float, peak: float, end: float, max_height: float) -> float:
    if x <= start or x >= end: return 0.0
    if x <= peak:
        t = (x - start) / (peak - start)
        t = t * t * (3 - 2 * t)
        return max_height * t
    else:
        t = (x - peak) / (end - peak)
        t = t * t * (3 - 2 * t)
        return max_height * (1 - t)


ARCH_PROFILE = generate_arch_profile()


def generate_heel_cup_profile(landmark_settings: dict = None, height_mm: float = 1.8) -> dict:
    if landmark_settings is None: landmark_settings = {}
    medial_start = landmark_settings.get('arch_start', 15.0)
    lateral_start = landmark_settings.get('lateral_arch_start', 20.0)
    heel_end = (medial_start + lateral_start) / 2.0
    profile = {}
    steps = 20
    for i in range(steps + 1):
        x = (i / steps) * 100.0
        if x <= heel_end: val = height_mm
        elif x <= heel_end + 15.0:
            t = (x - heel_end) / 15.0
            val = height_mm * 0.5 * (1.0 + np.cos(t * np.pi))
        else: val = 0.0
        profile[x] = val
    return profile


def generate_wall_profile(landmark_settings: dict = None, wall_params: dict = None) -> dict:
    if landmark_settings is None: landmark_settings = {}
    if wall_params is None: wall_params = {}
    navicular = landmark_settings.get('navicular', 43.0)
    cuboid = landmark_settings.get('cuboid', 45.0)
    metatarsal = landmark_settings.get('metatarsal', 70.0)
    medial_start = landmark_settings.get('arch_start', 15.0)
    lateral_start = landmark_settings.get('lateral_arch_start', 20.0)
    target_inner_max = wall_params.get('medial_height', 8.0)
    target_outer_max = wall_params.get('lateral_height', 4.3)
    inner_peak_x = wall_params.get('medial_peak_x', navicular)
    outer_peak_x = wall_params.get('lateral_peak_x', 30.0)

    log_debug(f"[WALL] wall_params received: {wall_params}")
    log_debug(f"[WALL] target_inner_max={target_inner_max}, target_outer_max={target_outer_max}, inner_peak_x={inner_peak_x}, outer_peak_x={outer_peak_x}")
    DEFAULT_INNER_MAX = 8.0
    DEFAULT_OUTER_MAX = 4.3
    scale_inner = target_inner_max / DEFAULT_INNER_MAX if DEFAULT_INNER_MAX > 0 else 1.0
    scale_outer = target_outer_max / DEFAULT_OUTER_MAX if DEFAULT_OUTER_MAX > 0 else 1.0
    
    def smoothstep(t): return t * t * (3 - 2 * t)
    def cosine_interp(t): return 0.5 * (1.0 + np.cos(t * np.pi))
    
    profile = {}
    for x in range(0, 101, 2):
        x = float(x)
        # Inner
        if x <= medial_start: inner = 6.4 * scale_inner
        elif x <= inner_peak_x:
            t = (x - medial_start) / (inner_peak_x - medial_start)
            inner = (6.4 + (8.0 - 6.4) * smoothstep(t)) * scale_inner
        elif x <= metatarsal:
            t = (x - inner_peak_x) / (metatarsal - inner_peak_x)
            inner = 8.0 * cosine_interp(t) * scale_inner
        else: inner = 0.0
        # Outer
        if x <= lateral_start: outer = 5.9 * scale_outer
        elif x <= outer_peak_x:
            t = (x - lateral_start) / (outer_peak_x - lateral_start)
            outer = (5.9 * scale_outer) + (target_outer_max - 5.9 * scale_outer) * smoothstep(t)
        elif x <= cuboid:
            t = (x - outer_peak_x) / (cuboid - outer_peak_x)
            outer = target_outer_max * cosine_interp(t)
        else: outer = 0.0
        profile[x] = (round(inner, 2), round(outer, 2))
    return profile


def create_profile_interpolators(arch_settings: dict = None, landmark_settings: dict = None, wall_params: dict = None, arch_curves: dict = None):
    settings = DEFAULT_ARCH_SETTINGS.copy()
    if arch_settings: settings.update(arch_settings)
    
    wall_profile = generate_wall_profile(landmark_settings, wall_params)
    wall_x = sorted(wall_profile.keys())
    inner_walls = [wall_profile[x][0] for x in wall_x]
    outer_walls = [wall_profile[x][1] for x in wall_x]
    
    heel_profile_data = generate_heel_cup_profile(landmark_settings)
    heel_x = sorted(heel_profile_data.keys())
    heel_cup = [heel_profile_data[x] for x in heel_x]
    
    arch_profile = generate_arch_profile(settings, landmark_settings)
    arch_x = sorted(arch_profile.keys())
    arch_outer = [arch_profile[x][0] for x in arch_x]
    arch_inner = [arch_profile[x][1] for x in arch_x]
    arch_transverse = [arch_profile[x][2] for x in arch_x]
    
    custom_boundaries = {}
    if arch_curves:
        for curve_type, points in arch_curves.items():
            if points and len(points) > 1:
                if curve_type in ('heelBridge', 'lateralBridge', 'metatarsalBridge'):
                    # Bridge curves: densify via Catmull-Rom for smooth arch pad polygon
                    raw_pts = [[p['x'], p['y']] for p in points]
                    if len(raw_pts) >= 2:
                        dense_pts = _densify_open_curve(raw_pts)
                        custom_boundaries[curve_type] = dense_pts
                        log_debug(f"[DENSIFY_BRIDGE] {curve_type}: {len(raw_pts)} pts -> {len(dense_pts)} pts")
                    else:
                        custom_boundaries[curve_type] = raw_pts
                elif curve_type == 'transverse' or curve_type == 'transverseFlat':
                    # Transverse is a closed polygon, densify via Catmull-Rom for smooth boundary
                    poly_points = [[p['x'], p['y']] for p in points]
                    try:
                        dense_points = _densify_closed_polygon(poly_points)
                        custom_boundaries[curve_type] = MplPath(dense_points)
                        print(f"[DENSIFY] {curve_type}: {len(poly_points)} pts -> {len(dense_points)} pts")
                        with open("densify_debug.log", "a") as _f:
                            _f.write(f"[DENSIFY] {curve_type}: {len(poly_points)} -> {len(dense_points)}\n")
                    except Exception as e:
                        print(f"[WARN] Failed to create {curve_type} polygon: {e}")
                else:
                    # Medial/Lateral curves: densify with Catmull-Rom to match frontend display,
                    # then create interp1d from the dense points
                    raw_pts = [[p['x'], p['y']] for p in points]
                    if len(raw_pts) >= 2:
                        dense_pts = _densify_open_curve(raw_pts)
                        xs_sorted = [p[0] for p in dense_pts]
                        ys_sorted = [p[1] for p in dense_pts]
                    else:
                        xs_sorted = [p['x'] for p in points]
                        ys_sorted = [p['y'] for p in points]
                    if len(xs_sorted) > 1:
                        try:
                            interp_kind = 'cubic' if len(xs_sorted) > 3 else 'linear'
                            custom_boundaries[curve_type] = interp1d(
                                xs_sorted, ys_sorted,
                                kind=interp_kind,
                                bounds_error=False,
                                fill_value=np.nan
                            )
                        except Exception as e:
                            print(f"[WARN] Failed to create {curve_type} interpolator: {e}")
    
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
        'custom_boundaries': custom_boundaries
    }


# =============================================================================
# 輪郭処理
# =============================================================================

def load_outline_csv(csv_path: Path, flip_x: bool = False, flip_y: bool = False) -> np.ndarray:
    import pandas as pd
    csv_path = Path(csv_path)
    if not csv_path.exists(): raise FileNotFoundError(f"輪郭CSVが見つかりません: {csv_path}")
    df = pd.read_csv(csv_path)
    if 'x_mm' in df.columns and 'y_mm' in df.columns: outline = df[['x_mm', 'y_mm']].values
    elif 'x' in df.columns and 'y' in df.columns: outline = df[['x', 'y']].values
    else: outline = df.iloc[:, :2].values
    
    if flip_x: outline[:, 0] = outline[:, 0].max() - outline[:, 0]
    if flip_y: outline[:, 1] = outline[:, 1].max() - outline[:, 1]
    
    outline[:, 0] -= outline[:, 0].min()
    outline[:, 1] -= outline[:, 1].min()
    print(f"[INFO] 輪郭CSV読み込み: {csv_path.name}")
    print(f"[INFO] 輪郭点数: {len(outline)}")
    return outline


def get_outline_y_bounds(outline: np.ndarray) -> Tuple:
    x = outline[:, 0]
    y = outline[:, 1]
    x_min, x_max = x.min(), x.max()
    sample_x = np.linspace(x_min, x_max, 200)
    y_mins, y_maxs = [], []
    for sx in sample_x:
        tol = (x_max - x_min) / 100
        mask = np.abs(x - sx) < tol
        if np.sum(mask) > 0:
            y_mins.append(y[mask].min())
            y_maxs.append(y[mask].max())
        else:
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
    """点(x, y)から輪郭への最短距離を計算"""
    point = np.array([x, y])
    distances = np.sqrt(np.sum((outline[:, :2] - point) ** 2, axis=1))
    return float(np.min(distances))


def _densify_open_curve(points: list, subdivisions: int = 8) -> list:
    """Densify an open curve using Catmull-Rom spline interpolation.
    Converts N control points into smooth curve points.
    Endpoints are duplicated as phantom points for proper tangent calculation."""
    n = len(points)
    if n < 2:
        return points
    # Create extended array with phantom endpoints
    extended = [points[0]] + points + [points[-1]]
    result = []
    for i in range(1, len(extended) - 2):
        p0 = extended[i - 1]
        p1 = extended[i]
        p2 = extended[i + 1]
        p3 = extended[i + 2]
        for j in range(subdivisions):
            t = j / subdivisions
            t2 = t * t
            t3 = t2 * t
            x = 0.5 * ((2*p1[0]) + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3)
            y = 0.5 * ((2*p1[1]) + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3)
            result.append([x, y])
    # Add the final endpoint
    result.append(list(points[-1]))
    return result


def _densify_closed_polygon(points: list, subdivisions: int = 8) -> list:
    """Densify a closed polygon using Catmull-Rom spline interpolation.
    Converts N control points into N*subdivisions smooth polygon points."""
    n = len(points)
    if n < 3:
        return points
    result = []
    for i in range(n):
        p0 = points[(i - 1) % n]
        p1 = points[i]
        p2 = points[(i + 1) % n]
        p3 = points[(i + 2) % n]
        for j in range(subdivisions):
            t = j / subdivisions
            t2 = t * t
            t3 = t2 * t
            x = 0.5 * ((2*p1[0]) + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3)
            y = 0.5 * ((2*p1[1]) + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3)
            result.append([x, y])
    return result


def _distance_to_polygon_edge(x: float, y: float, polygon_path: MplPath) -> float:
    """ポリゴン境界までの最短距離を返す（線分投影ベース）"""
    verts = polygon_path.vertices
    n = len(verts)
    px, py = x, y
    min_dist_sq = float('inf')
    for i in range(n):
        ax, ay = verts[i]
        bx, by = verts[(i + 1) % n]
        dx, dy = bx - ax, by - ay
        len_sq = dx * dx + dy * dy
        if len_sq < 1e-12:
            dist_sq = (px - ax) ** 2 + (py - ay) ** 2
        else:
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / len_sq))
            proj_x = ax + t * dx
            proj_y = ay + t * dy
            dist_sq = (px - proj_x) ** 2 + (py - proj_y) ** 2
        if dist_sq < min_dist_sq:
            min_dist_sq = dist_sq
    return float(np.sqrt(min_dist_sq))


def _build_arch_pad_polygon(custom_boundaries: dict, f_y_min, f_y_max) -> Optional[MplPath]:
    """ブリッジ点と輪郭境界からアーチパッド輪郭ポリゴンを構築する。

    ループ: heelBridge → 外側輪郭(f_y_max) → lateralBridge → metatarsalBridge → 内側輪郭(f_y_min) → close
    """
    heel_bridge = custom_boundaries.get('heelBridge')
    lateral_bridge = custom_boundaries.get('lateralBridge')
    metatarsal_bridge = custom_boundaries.get('metatarsalBridge')

    if not heel_bridge or not lateral_bridge or not metatarsal_bridge:
        return None

    n_samples = 30
    polygon_points = []

    # 1. heelBridge (M0 -> L0)
    polygon_points.extend(heel_bridge)

    # 2. Outer outline: heelBridge last -> lateralBridge first (f_y_max)
    outer_start_x = heel_bridge[-1][0]
    outer_end_x = lateral_bridge[0][0]
    if abs(outer_end_x - outer_start_x) > 0.1:
        outer_xs = np.linspace(outer_start_x, outer_end_x, n_samples + 2)[1:-1]
        for ox in outer_xs:
            polygon_points.append([float(ox), float(f_y_max(ox))])

    # 3. lateralBridge (L4 -> B1 -> T4)
    polygon_points.extend(lateral_bridge)

    # 4. metatarsalBridge (T4 -> T3 -> T2 -> MB1 -> M7)
    polygon_points.extend(metatarsal_bridge)

    # 5. Inner outline: metatarsalBridge last -> heelBridge first (f_y_min, reversed)
    inner_start_x = metatarsal_bridge[-1][0]
    inner_end_x = heel_bridge[0][0]
    if abs(inner_end_x - inner_start_x) > 0.1:
        inner_xs = np.linspace(inner_start_x, inner_end_x, n_samples + 2)[1:-1]
        for ix in inner_xs:
            polygon_points.append([float(ix), float(f_y_min(ix))])

    if len(polygon_points) < 3:
        return None

    try:
        return MplPath(polygon_points)
    except Exception as e:
        print(f"[WARN] Failed to create arch pad polygon: {e}")
        return None


def _get_heel_center(outline: np.ndarray, x_min: float, threshold_ratio: float = 0.05) -> Tuple[float, float]:
    """かかと後端の中心点を計算"""
    x_coords = outline[:, 0]
    y_coords = outline[:, 1]
    length = x_coords.max() - x_min
    threshold = x_min + length * threshold_ratio
    heel_mask = x_coords <= threshold
    if np.sum(heel_mask) > 0:
        heel_x = np.mean(x_coords[heel_mask])
        heel_y = np.mean(y_coords[heel_mask])
    else:
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
    length = x_max - x_min
    x_ratio = (x - x_min) / length * 100 if length > 0 else 50
    x_ratio = np.clip(x_ratio, 0, 100)
    
    local_width = y_max_at_x - y_min_at_x
    if local_width > 0.5:
        y_ratio = (y - y_min_at_x) / local_width
    else:
        y_ratio = 0.5
    y_ratio = np.clip(y_ratio, 0, 1)
    
    # Frontend Alignment: Top(MinY)=Inner, Bot(MaxY)=Outer
    # Core Logic: 1.0=Inner
    arch_y_ratio = 1.0 - y_ratio
    
    inner_wall_base = float(profiles['inner_wall'](x_ratio))
    outer_wall_base = float(profiles['outer_wall'](x_ratio))
    
    inner_wall = max(0, inner_wall_base + wall_offset_mm) if inner_wall_base > 0 else 0
    outer_wall = max(0, outer_wall_base + wall_offset_mm) if outer_wall_base > 0 else 0
    
    heel_cup = float(profiles['heel_cup'](x_ratio)) * heel_cup_scale
    arch_outer = float(profiles['arch_outer'](x_ratio)) * arch_scale
    arch_inner = float(profiles['arch_inner'](x_ratio)) * arch_scale
    arch_transverse_raw = float(profiles['arch_transverse'](x_ratio)) * arch_scale
    # 横アーチX方向: プラトー拡大（高い範囲を広くする）
    max_trans_h = profiles['arch_settings'].get('transverse_height', 0.5) * arch_scale
    if arch_transverse_raw > 0 and max_trans_h > 0:
        arch_transverse = max_trans_h * (arch_transverse_raw / max_trans_h) ** 0.6
    else:
        arch_transverse = arch_transverse_raw

    landmark_settings = profiles.get('landmark_settings', {})
    medial_start = landmark_settings.get('arch_start', 15.0)
    lateral_start = landmark_settings.get('lateral_arch_start', 20.0)
    heel_cup_region = lateral_start * (1 - arch_y_ratio) + medial_start * arch_y_ratio
    
    height = base_thickness
    
    if is_boundary:
        normal_wall_height = outer_wall * (1 - arch_y_ratio) + inner_wall * arch_y_ratio

        # ヒールカップ領域の判定を輪郭形状に基づいて行う
        heel_cup_region_mm = (heel_cup_region / 100.0) * length
        transition_zone_mm = (10.0 / 100.0) * length  # 10%で滑らかに内壁へ移行

        if outline is not None:
            heel_center = _get_heel_center(outline, x_min)
            dist_from_heel_center = np.sqrt((x - heel_center[0])**2 + (y - heel_center[1])**2)
            in_heel_cup = dist_from_heel_center <= heel_cup_region_mm
            in_transition = (dist_from_heel_center > heel_cup_region_mm - transition_zone_mm and
                           dist_from_heel_center <= heel_cup_region_mm)
        else:
            dist_from_heel_center = (x_ratio / 100.0) * length
            in_heel_cup = x_ratio <= heel_cup_region
            in_transition = x_ratio > heel_cup_region - 5.0 and x_ratio <= heel_cup_region

        if in_heel_cup:
            uniform = (inner_wall + outer_wall) / 2.0
            if in_transition:
                t = (dist_from_heel_center - (heel_cup_region_mm - transition_zone_mm)) / transition_zone_mm
                t = np.clip(t, 0, 1)
                t = t * t * (3 - 2 * t)  # smoothstep for angular-free transition
                wall_height = uniform * (1 - t) + normal_wall_height * t
            else:
                wall_height = uniform
            wall_height = max(wall_height, heel_cup)
        else:
            wall_height = normal_wall_height
        height += wall_height
    else:
        dist_from_inner_mm = abs(y - y_min_at_x)
        dist_from_outer_mm = abs(y - y_max_at_x)

        custom_boundaries = profiles.get('custom_boundaries', {})

        # X方向：ヒールカップ領域では輪郭からの最短距離を使用
        if x_ratio <= heel_cup_region and outline is not None:
            dist_from_heel_mm = _distance_to_outline(x, y, outline)
        else:
            dist_from_heel_mm = (x_ratio / 100.0) * length

        # Y direction transition distance (固定10mm)
        # ヒールカップ後端では輪郭幅に応じて制限
        transition_distance_mm = 10.0
        if x_ratio <= 10.0 and local_width > 0:
            max_y_transition = local_width * 0.35
            transition_distance_mm = min(transition_distance_mm, max_y_transition)

        # X direction transition distance (only within heel cup region)
        x_transition_mm = 10.0 if x_ratio <= heel_cup_region else 0.0

        wall_height = outer_wall * (1 - arch_y_ratio) + inner_wall * arch_y_ratio
        
        longitudinal_arch_height = 0.0
        transverse_arch_height = 0.0
        
        arch_settings = profiles['arch_settings']
        use_custom_medial = 'medial' in custom_boundaries and 'medialFlat' in custom_boundaries
        use_custom_lateral = 'lateral' in custom_boundaries and 'lateralFlat' in custom_boundaries
        
        if use_custom_medial or use_custom_lateral:
            medial_h, lateral_h = 0.0, 0.0
            medial_height_mm = arch_inner
            lateral_height_mm = arch_outer

            # Track whether custom boundary returned valid (non-NaN) result
            medial_custom_valid = False
            lateral_custom_valid = False

            if use_custom_medial:
                try:
                    y_out = float(custom_boundaries['medial'](x))
                    y_in = float(custom_boundaries['medialFlat'](x))
                    if not (np.isnan(y_out) or np.isnan(y_in)):
                        medial_custom_valid = True
                        denom = y_in - y_out
                        if abs(denom) > 0.01:
                            t = (y - y_out) / denom
                            if 0 <= t <= 1: medial_h = medial_height_mm * (t * t * (3 - 2 * t))
                            elif t > 1: medial_h = medial_height_mm
                except: pass

            if use_custom_lateral:
                try:
                    y_out = float(custom_boundaries['lateral'](x))
                    y_in = float(custom_boundaries['lateralFlat'](x))
                    if not (np.isnan(y_out) or np.isnan(y_in)):
                        lateral_custom_valid = True
                        denom = y_in - y_out
                        if abs(denom) > 0.01:
                            t = (y - y_out) / denom
                            if 0 <= t <= 1: lateral_h = lateral_height_mm * (t * t * (3 - 2 * t))
                            elif t > 1: lateral_h = lateral_height_mm
                except: pass

            # Fallback to percentage-based calculation when custom boundary returns NaN
            if not use_custom_medial or not medial_custom_valid:
                medial_y_start = arch_settings.get('medial_y_start', 65.0)/100
                medial_y_end = arch_settings.get('medial_y_end', 100.0)/100
                if arch_y_ratio >= medial_y_start:
                    if (medial_y_end - medial_y_start) > 0:
                        fallback_h = arch_inner * min(1.0, (arch_y_ratio - medial_y_start)/(medial_y_end - medial_y_start))
                    else: fallback_h = arch_inner
                    medial_h = max(medial_h, fallback_h)

            if not use_custom_lateral or not lateral_custom_valid:
                lateral_y_start = arch_settings.get('lateral_y_start', 0.0)/100
                lateral_y_end = arch_settings.get('lateral_y_end', 25.0)/100
                if arch_y_ratio <= lateral_y_end:
                    if (lateral_y_end - lateral_y_start) > 0:
                        fallback_h = arch_outer * max(0.0, 1.0 - (arch_y_ratio - lateral_y_start)/(lateral_y_end - lateral_y_start))
                    else: fallback_h = arch_outer
                    lateral_h = max(lateral_h, fallback_h)

            longitudinal_arch_height = max(medial_h, lateral_h)
        else:
            medial_y_start = arch_settings.get('medial_y_start', 65.0)/100
            medial_y_end = arch_settings.get('medial_y_end', 100.0)/100
            lateral_y_start = arch_settings.get('lateral_y_start', 0.0)/100
            lateral_y_end = arch_settings.get('lateral_y_end', 25.0)/100

            medial_h = 0.0
            lateral_h = 0.0
            if arch_y_ratio >= medial_y_start:
                if (medial_y_end - medial_y_start) > 0:
                    medial_h = arch_inner * min(1.0, (arch_y_ratio - medial_y_start)/(medial_y_end - medial_y_start))
                else: medial_h = arch_inner
            if arch_y_ratio <= lateral_y_end:
                if (lateral_y_end - lateral_y_start) > 0:
                    lateral_h = arch_outer * max(0.0, 1.0 - (arch_y_ratio - lateral_y_start)/(lateral_y_end - lateral_y_start))
                else: lateral_h = arch_outer
            longitudinal_arch_height = max(medial_h, lateral_h)

        # 3. Transverse Arch
        if 'transverse' in custom_boundaries:
            # ポリゴン内: Y方向のみのフォールオフ（X方向はarch_transverseベルカーブで処理済み）
            if custom_boundaries['transverse'].contains_point((x, y)):
                # 現在のX位置でのポリゴンY範囲を求める（断面プロファイルと同じ手法）
                verts = custom_boundaries['transverse'].vertices
                intersections = []
                n_verts = len(verts)
                for i in range(n_verts):
                    x1, y1 = verts[i]
                    x2, y2 = verts[(i + 1) % n_verts]
                    if (x1 <= x < x2) or (x2 <= x < x1):
                        if abs(x2 - x1) > 0.001:
                            t_seg = (x - x1) / (x2 - x1)
                            intersections.append(y1 + (y2 - y1) * t_seg)

                if len(intersections) >= 2:
                    y_min_poly = min(intersections)
                    y_max_poly = max(intersections)
                    center_y = (y_min_poly + y_max_poly) / 2.0
                    half_y = (y_max_poly - y_min_poly) / 2.0
                    if half_y > 0.01:
                        f = 1.0 - abs(y - center_y) / half_y
                        f = max(0.0, min(1.0, f))
                    else:
                        f = 1.0
                else:
                    f = 1.0

                # Y方向プラトー拡大 + ダブルスムースステップ
                f = f ** 0.6  # 高い範囲を広げる
                s = f * f * (3 - 2 * f)
                transverse_arch_height = arch_transverse * (s * s * (3 - 2 * s))
            else:
                transverse_arch_height = 0.0
        else:
            # Legacy default logic
            transverse_y_start = arch_settings.get('transverse_y_start', 25.0)/100
            transverse_y_end = arch_settings.get('transverse_y_end', 65.0)/100
            if arch_transverse > 0 and transverse_y_start <= arch_y_ratio <= transverse_y_end:
                center = (transverse_y_start + transverse_y_end) / 2
                half = (transverse_y_end - transverse_y_start) / 2
                if half > 0:
                    dist = abs(arch_y_ratio - center)
                    f = max(0.0, 1.0 - dist/half)
                    f = f ** 0.6  # Y方向プラトー拡大
                    s = f * f * (3 - 2 * f)
                    transverse_arch_height = arch_transverse * (s * s * (3 - 2 * s))
        
        arch_height = max(longitudinal_arch_height, transverse_arch_height)

        # Micro-height floor for arch pad area (prevents dip to 0mm between arches)
        arch_pad_outline = profiles.get('arch_pad_outline')
        if arch_pad_outline is not None and arch_pad_outline.contains_point((x, y)):
            micro_height_x = max(arch_inner, arch_outer, arch_transverse)
            if micro_height_x > 0:
                max_arch_h = max(
                    profiles['arch_settings'].get('medial_height', 1.0) * arch_scale,
                    profiles['arch_settings'].get('lateral_height', 0.5) * arch_scale,
                    0.01
                )
                normalized = min(1.0, micro_height_x / max_arch_h)
                micro_height = 0.4 * normalized

                dist_to_edge = _distance_to_polygon_edge(x, y, arch_pad_outline)
                falloff_dist = 3.0
                if dist_to_edge < falloff_dist:
                    t = dist_to_edge / falloff_dist
                    micro_height *= t * t * (3 - 2 * t)

                arch_height = max(arch_height, micro_height)

        # Blend calculation - unified distance-based approach
        transition_offset = 0.5

        # Compute both distance metrics
        dist_from_edge = min(dist_from_inner_mm, dist_from_outer_mm)
        dist_from_boundary = _distance_to_outline(x, y, outline) if outline is not None else dist_from_edge

        # Blend distance metrics: gradually shift from outline-distance to edge-distance
        # This prevents angular transitions at the heel cup / wall junction
        blend_zone = 8.0
        if x_ratio <= heel_cup_region - blend_zone:
            effective_dist = dist_from_boundary
        elif x_ratio <= heel_cup_region + blend_zone:
            mix = (x_ratio - (heel_cup_region - blend_zone)) / (2.0 * blend_zone)
            mix = np.clip(mix, 0, 1)
            mix = mix * mix * (3 - 2 * mix)  # smoothstep
            effective_dist = dist_from_boundary * (1 - mix) + dist_from_edge * mix
        else:
            effective_dist = dist_from_edge

        # Unified blend from effective distance (smoothstep curve)
        if effective_dist < transition_offset:
            blend = 0.0
        elif effective_dist < transition_distance_mm:
            raw_t = (effective_dist - transition_offset) / (transition_distance_mm - transition_offset)
            raw_t = min(1.0, max(0.0, raw_t))
            blend = raw_t * raw_t * (3 - 2 * raw_t)  # smoothstep
        else:
            blend = 1.0

        # X direction additional blend (forward transition from heel cup)
        if x_transition_mm > 0 and dist_from_heel_mm < x_transition_mm:
            if dist_from_heel_mm < transition_offset:
                x_blend = 0.0
            else:
                raw_t = (dist_from_heel_mm - transition_offset) / (x_transition_mm - transition_offset)
                raw_t = min(1.0, max(0.0, raw_t))
                x_blend = raw_t * raw_t * (3 - 2 * raw_t)  # smoothstep
            blend = min(blend, x_blend)

        target_center_height = arch_height
        height += wall_height * (1 - blend) + target_center_height * blend
    
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
    heel_cup_height: float = None,
    arch_curves: dict = None
) -> trimesh.Trimesh:
    print(f"[INFO] === MasaCAD v4.3 (Frontend) ===")
    if heel_cup_height: heel_cup_scale = heel_cup_height / HEEL_CUP_PROFILE.get(0.0, 1.8)
    
    if np.allclose(outline[0], outline[-1]): outline = outline[:-1]
    outline = _resample_outline_heel_region(
        outline, outline[:, 0].min(), outline[:, 0].max()
    )
    n_boundary = len(outline)
    profiles = create_profile_interpolators(arch_settings, landmark_settings, wall_params, arch_curves)
    f_y_min, f_y_max, x_min, x_max = get_outline_y_bounds(outline)

    # Build arch pad outline polygon from bridge points
    custom_boundaries = profiles.get('custom_boundaries', {})
    arch_pad_polygon = _build_arch_pad_polygon(custom_boundaries, f_y_min, f_y_max)
    if arch_pad_polygon:
        profiles['arch_pad_outline'] = arch_pad_polygon
        log_debug(f"[ARCH_PAD] Polygon built with {len(arch_pad_polygon.vertices)} vertices")

    # Grid
    outline_path = MplPath(outline)
    x_vals = np.arange(x_min + grid_spacing, x_max, grid_spacing)
    y_global_min, y_global_max = outline[:,1].min(), outline[:,1].max()
    y_vals = np.arange(y_global_min + grid_spacing, y_global_max, grid_spacing)
    interior_points = np.empty((0, 2))
    if len(x_vals)>0 and len(y_vals)>0:
        xx, yy = np.meshgrid(x_vals, y_vals)
        cands = np.column_stack([xx.ravel(), yy.ravel()])
        interior_points = cands[outline_path.contains_points(cands)]
    
    all_2d = np.vstack([outline, interior_points]) if len(interior_points) > 0 else outline
    n_total = len(all_2d)
    is_boundary_flags = np.zeros(n_total, dtype=bool)
    is_boundary_flags[:n_boundary] = True
    
    top_vertices = []
    for i, pt in enumerate(all_2d):
        x, y = pt
        z = calculate_height(
            x, y, x_min, x_max, float(f_y_min(x)), float(f_y_max(x)),
            profiles, base_thickness, is_boundary=is_boundary_flags[i],
            arch_scale=arch_scale, wall_offset_mm=wall_offset_mm, heel_cup_scale=heel_cup_scale,
            is_right_foot=is_right_foot, outline=outline
        )
        top_vertices.append([x, y, z])
    top_vertices = np.array(top_vertices)
    # Dynamic Z-smoothing window based on resampled point density
    _avg_spacing = np.mean(np.sqrt(np.sum(np.diff(outline, axis=0)**2, axis=1)))
    _smooth_window = max(7, int(10.0 / _avg_spacing))
    if _smooth_window % 2 == 0:
        _smooth_window += 1
    top_vertices = _smooth_boundary_z(top_vertices, n_boundary, x_min, x_max, window=_smooth_window)
    bottom_vertices = np.column_stack([all_2d, np.zeros(n_total)])
    
    tri = Delaunay(all_2d)
    valid_faces = [f for f in tri.simplices if point_in_polygon(all_2d[f].mean(axis=0), outline)]
    top_faces = np.array(valid_faces)
    
    bottom_faces = top_faces[:, [0, 2, 1]] + n_total
    side_faces = []
    for i in range(n_boundary):
        ni = (i + 1) % n_boundary
        side_faces.append([i, i+n_total, ni])
        side_faces.append([ni, i+n_total, ni+n_total])
    side_faces = np.array(side_faces)
    
    all_verts = np.vstack([top_vertices, bottom_vertices])
    all_faces = np.vstack([top_faces, bottom_faces, side_faces])
    mesh = trimesh.Trimesh(vertices=all_verts, faces=all_faces)
    
    mesh.fix_normals()
    mesh.fill_holes()
    mesh.merge_vertices()
    
    # Smoothing
    try:
        interior_indices = list(range(n_boundary, n_total))
        if interior_indices:
            v = mesh.vertices.copy()
            new_z = v[:, 2].copy()
            for idx in interior_indices:
                mask = np.any(mesh.faces == idx, axis=1)
                neighbors = np.unique(mesh.faces[mask].flatten())
                neighbors = neighbors[(neighbors != idx) & (neighbors < n_total)]
                if len(neighbors) > 0:
                    new_z[idx] = 0.7 * v[idx, 2] + 0.3 * np.mean(v[neighbors, 2])
            v[:, 2] = new_z
            mesh.vertices = v
    except: pass
    
    return mesh


def generate_insole_from_outline(
    outline_csv_path: Optional[Path] = None,
    outline_points: Optional[List[Dict[str, float]]] = None,
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
    arch_curves: dict = None,
    progress_callback: callable = None
) -> trimesh.Trimesh:
    log_debug("Frontend Gen Called")

    if outline_points:
        outline_np = np.array([[p['x'], p['y']] for p in outline_points])
        if flip_x: outline_np[:, 0] = outline_np[:, 0].max() - outline_np[:, 0]
        if flip_y: outline_np[:, 1] = outline_np[:, 1].max() - outline_np[:, 1]
        outline_np[:, 0] -= outline_np[:, 0].min()
        outline_np[:, 1] -= outline_np[:, 1].min()
    elif outline_csv_path:
        outline_np = load_outline_csv(outline_csv_path, flip_x=flip_x, flip_y=flip_y)
    else:
        raise ValueError("No outline provided")

    return generate_insole_mesh(
        outline=outline_np,
        base_thickness=base_thickness,
        arch_scale=arch_scale,
        wall_offset_mm=wall_height_offset_mm,
        heel_cup_scale=heel_cup_scale,
        grid_spacing=grid_spacing,
        arch_settings=arch_settings,
        is_right_foot=flip_y,
        landmark_settings=landmark_settings,
        wall_params=wall_params,
        heel_cup_height=heel_cup_height,
        arch_curves=arch_curves
    )

def export_mesh(mesh: trimesh.Trimesh, output_path: Path):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.suffix.lower() == '.stl': mesh.export(output_path, file_type='stl')
    elif output_path.suffix.lower() == '.glb': mesh.export(output_path, file_type='glb')
    else: mesh.export(output_path)
