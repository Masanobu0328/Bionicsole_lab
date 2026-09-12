"MasaCAD Core - Geometry Module v4.2\nハイブリッド方式：輪郭維持 + テンプレートプロファイル\n\n設計思想:\n- 輪郭点列の閉じたループを正確に維持（端部が自然に閉じる）\n- 輪郭内部にグリッド頂点を追加\n- テンプレートから抽出したプロファイルで高さを制御\n- アーチ・ヒールカップ・壁が正確に再現される\n- 底面は完全に平坦（Z=0）\n\n座標系:\n- X: 0=踵、max=つま先\n- Y: 0=内側（土踏まず側）、max=外側（小指側）〔右足基準〕\n- Z: 0=底面、up=上面\n\n作成日: 2024-12-28\n"

import math
import numpy as np
from scipy.interpolate import PchipInterpolator, interp1d, LinearNDInterpolator
from scipy.spatial import Delaunay, cKDTree
import trimesh
from matplotlib.path import Path as MplPath
import datetime
from typing import Dict, Optional, Tuple, List
from pathlib import Path

# プロジェクトルート
PROJECT_ROOT = Path(__file__).parent.parent.resolve()
EXPORTS_DIR = PROJECT_ROOT / "exports"

# バージョン情報
GEOMETRY_VERSION = "v4.5-bionicsol-right-reference-2026-09-04"
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

# 座標系: X=0%=踵、X=100%=つま先（輪郭点列基準）
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
# How the wall height falls off toward the interior: wall * (1 - t)**POWER,
# where t runs from the rim to WALL_DISH_REACH_MM inboard. Was a smoothstep,
# which crested just inboard of the rim instead of dishing.
#
# The two are coupled on purpose. The slope at the rim is POWER * wall / reach,
# so stretching the reach alone would also flatten the entry. Scaling POWER
# with the reach keeps the entry angle fixed and only lengthens the tail, which
# is the knob that matters: "same angle in, reaching further and more gently".
WALL_DISH_REACH_MM = 10.0
WALL_DISH_OFFSET_MM = 0.5        # full-height rim right at the edge
# Entry slope per mm of wall height, taken at the end of that offset. The
# falloff runs over (reach - offset), not over reach, so scaling the exponent
# by reach alone does not actually hold the entry angle. Holding this does.
WALL_DISH_ENTRY_SLOPE = 2.0 / 9.5



def _wall_falloff_power(reach_mm: float = None) -> float:
    if reach_mm is None:
        reach_mm = WALL_DISH_REACH_MM
    span = max(1e-6, reach_mm - WALL_DISH_OFFSET_MM)
    return WALL_DISH_ENTRY_SLOPE * span

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


def generate_arch_profile(arch_settings: dict = None, landmark_settings: dict = None,
                          detail_spans: dict = None) -> dict:
    settings = DEFAULT_ARCH_SETTINGS.copy()
    if arch_settings:
        settings.update(arch_settings)
    detail_spans = detail_spans or {}

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

    # 描いた曲線の端も節点にする。ここを外すと、詳細スプラインが端まで持っている高さを
    # プロファイル側のサンプリングが取りこぼす。
    for span in detail_spans.values():
        key_points.add(float(span[0]))
        key_points.add(float(span[1]))

    # 詳細設定スプライン（有効な場合はベルカーブを置き換え）
    detail_spline = _build_detail_spline(settings, landmark_settings, detail_spans.get('medial'))
    transverse_detail_spline = _build_transverse_detail_spline(
        settings, landmark_settings, detail_spans.get('transverse')
    )

    # ランドマーク別高さのスプラインは、この疎な key_points で一度サンプリングされてから
    # 再補間される。スプライン自身のノットが key_points に無いと、ダイヤルした高さが
    # そのまま出ずに前後で波打つ。ノットと、その区間の細かいグリッドを足しておく。
    for spline in (detail_spline, transverse_detail_spline):
        if spline is None:
            continue
        knots = np.asarray(spline.x, dtype=float)
        for knot in knots:
            key_points.add(float(knot))
        for value in np.arange(float(knots[0]), float(knots[-1]), 1.0):
            key_points.add(float(value))

    key_points = sorted(key_points)
    profile = {}

    medial_detail_range = detail_spans.get('medial') or (settings['medial_start'], settings['medial_end'])
    transverse_detail_range = detail_spans.get('transverse') or (settings['transverse_start'], settings['transverse_end'])

    for x in key_points:
        if detail_spline is not None:
            if medial_detail_range[0] <= x <= medial_detail_range[1]:
                raw = float(detail_spline(x))
                medial_h = max(0.0, raw)
            else:
                medial_h = 0.0
        else:
            medial_h = _calculate_arch_height(x, settings['medial_start'], settings['medial_peak'], settings['medial_end'], settings['medial_height'])
        lateral_h = _calculate_arch_height(x, settings['lateral_start'], settings['lateral_peak'], settings['lateral_end'], settings['lateral_height'])
        if transverse_detail_spline is not None:
            if transverse_detail_range[0] <= x <= transverse_detail_range[1]:
                transverse_h = max(0.0, float(transverse_detail_spline(x)))
            else:
                transverse_h = 0.0
        else:
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


BAND_PLATEAU_DROP = 0.15
BAND_T_REF = 6.0
# Where a band does most of its falling. The raw exponential drops hardest at the
# solid boundary and eases toward the dashed one, which is backwards: it leaves the
# middle of the band riding high (0.613 of peak at the midpoint), and a medial arch
# that high swamps the transverse arch. Raising t to this power flips the curvature
# without moving the value at the dashed line - the drop is steep just inside the
# dashed boundary and lands tangentially on the solid one.
#   q      t=0.25  t=0.5  t=0.75   slope at solid   slope at dashed
#   1.0     0.378  0.613   0.759        1.896            0.285
#   2.0     0.112  0.378   0.656        0.001            0.569
#
# Split medial from lateral: the lateral arch is short and its band is narrow, so it
# has little height to give away and keeps the original shape (bias 1.0). Only the
# medial band, which is tall enough to swamp the transverse arch, is reshaped.
MEDIAL_BAND_DROP_BIAS = 2.0
LATERAL_BAND_DROP_BIAS = 1.0


def _band_profile_height(t: float, max_height: float,
                         plateau_drop: float = BAND_PLATEAU_DROP,
                         drop_bias: float = None) -> float:
    """アーチ帯の断面高さ。外側境界(t=0)からFlat境界(t=1)を経て内側(t>1)へ。

    以前は 0<=t<=1 を smoothstep、t>1 を最大高さで平坦にしていたが、smoothstep は
    両端で傾きが 0 になるため t=1 で曲線が一度水平になり、そこに目に見える棚が
    できていた。さらに t>1 が完全な平坦域になるため上から見ると台形になっていた。

    継ぎ目の無い単一の指数曲線に置き換える。外側境界で最も急、内側へ行くほど
    連続的に緩くなり、傾きが 0 になる点も平坦域も生じない。

        t=0 -> 0.000  t=0.5 -> 0.613  t=1 -> 0.850  t=2 -> 0.978  t=3 -> 0.997

    NOTE: this shape was requested explicitly and verified against the cross-section
    profile. Do not replace it with a smoothstep - that reintroduces the shelf at t=1.
    """
    if t <= 0.0:
        return 0.0
    d = min(max(float(plateau_drop), 1e-6), 0.99)
    # The bias moves where the fall happens; see MEDIAL_BAND_DROP_BIAS. The same
    # expression covers t>1, so the curve stays smooth across the dashed boundary
    # and no shelf appears there.
    bias = MEDIAL_BAND_DROP_BIAS if drop_bias is None else float(drop_bias)
    bias = min(max(bias, 1.0), 4.0)
    biased = float(t) ** bias if bias != 1.0 else float(t)
    capped = min(biased, BAND_T_REF)
    return max_height * (1.0 - d ** capped) / (1.0 - d ** BAND_T_REF)


def _longitudinal_span_factor(x: float, span) -> float:
    """アーチの高さのX方向包絡線を、描いた曲線自身の範囲から作る。

    以前はパーセンテージ設定 (medial_start/peak/end) 由来のベルカーブを使っていたが、
    描いた曲線と別管理なので両者が食い違い、帯の端で高さがゼロに落ちなかった。
    """
    if not span:
        return 0.0
    start, end = float(span[0]), float(span[1])
    width = end - start
    if width <= 0.0 or x < start or x > end:
        return 0.0
    ramp = 0.15 * width
    if ramp <= 0.0:
        return 1.0
    ratio = min(1.0, min(x - start, end - x) / ramp)
    return ratio * ratio * (3.0 - 2.0 * ratio)


def _custom_band_height(
    x: float, y: float, outer_interp, inner_interp, peak: float,
    clamp_outer: bool = False, drop_bias: float = None
) -> float:
    """実線境界とFlat(破線)境界の間の帯の高さ。

    実線のX範囲外では PCHIP が NaN を返す。それは「そこにアーチは無い＝フラット」
    という意味なので、必ずゼロを返すこと。ここで別の高さ計算にフォールバックすると
    L4より前方に幻のアーチが生える。

    一方 Flat(破線)側は端の値へクランプする。破線が実線より短い区間で NaN にすると、
    実線はまだ有効なのに高さだけ突然ゼロに落ちて、上から見たとき垂直な崖になる。
    """
    if peak <= 0.0:
        return 0.0
    try:
        # The medial carrier continues past T1 to its drawn forward boundary.
        # Clamp instead of extrapolating because PCHIP can swing sharply there.
        outer_knots = getattr(outer_interp, 'x', None)
        x_outer = x
        if clamp_outer and outer_knots is not None:
            x_outer = min(max(x, float(outer_knots[0])), float(outer_knots[-1]))
        y_out = float(outer_interp(x_outer))
        # Flat 境界は外挿せずクランプ（ArchPad Lab の extrapolate_endpoints=True 相当）
        knots = getattr(inner_interp, 'x', None)
        x_inner = x if knots is None else min(max(x, float(knots[0])), float(knots[-1]))
        y_in = float(inner_interp(x_inner))
    except Exception:
        return 0.0
    if np.isnan(y_out) or np.isnan(y_in):
        return 0.0
    denom = y_in - y_out
    if abs(denom) <= 0.01:
        return 0.0
    return _band_profile_height((y - y_out) / denom, peak, drop_bias=drop_bias)


def _polygon_centroid(points: np.ndarray) -> np.ndarray:
    """閉曲線の面積重心。面積がほぼ0のときは平均点にフォールバック。"""
    following = np.roll(points, -1, axis=0)
    cross = points[:, 0] * following[:, 1] - following[:, 0] * points[:, 1]
    area_twice = float(cross.sum())
    if abs(area_twice) <= 1e-9:
        return points.mean(axis=0)
    return np.asarray([
        np.sum((points[:, 0] + following[:, 0]) * cross) / (3.0 * area_twice),
        np.sum((points[:, 1] + following[:, 1]) * cross) / (3.0 * area_twice),
    ])


def _build_radial_dome(outer_points: list, inner_points: list) -> Optional[dict]:
    """横アーチ用の放射ドームを前計算する（角度→外周半径のテーブル）。

    calculate_height は頂点ごとに呼ばれるので、重心と角度ソートは一度だけ行い、
    実行時は np.interp のルックアップだけで済ませる。
    """
    outer = np.asarray(outer_points, dtype=float)
    inner = np.asarray(inner_points, dtype=float)
    if len(outer) < 3 or len(inner) < 3:
        return None
    center = 0.5 * (_polygon_centroid(outer) + _polygon_centroid(inner))
    vectors = outer - center
    angles = np.mod(np.arctan2(vectors[:, 1], vectors[:, 0]), 2.0 * np.pi)
    radii = np.linalg.norm(vectors, axis=1)
    order = np.argsort(angles)
    angles, radii = angles[order], radii[order]
    unique_angles, inverse = np.unique(np.round(angles, 10), return_inverse=True)
    if len(unique_angles) < 3:
        return None
    unique_radii = np.bincount(inverse, weights=radii) / np.bincount(inverse)
    return {
        'center': center,
        # 周期境界をまたぐ補間のため、前後に1点ずつ折り返して持たせる
        'angles': np.concatenate((unique_angles[-1:] - 2.0 * np.pi, unique_angles, unique_angles[:1] + 2.0 * np.pi)),
        'radii': np.concatenate((unique_radii[-1:], unique_radii, unique_radii[:1])),
    }


def _radial_dome_ratio(dome: dict, x: float, y: float) -> float:
    """ドーム中心からの正規化半径 (中心=1, 外周=0)。外側は0。"""
    dx = x - dome['center'][0]
    dy = y - dome['center'][1]
    angle = np.mod(np.arctan2(dy, dx), 2.0 * np.pi)
    outer_radius = float(np.interp(angle, dome['angles'], dome['radii']))
    if outer_radius <= 0.01:
        return 0.0
    t = (outer_radius - float(np.hypot(dx, dy))) / outer_radius
    if t <= 0.0:
        return 0.0
    t = min(1.0, t)
    return t * t * (3.0 - 2.0 * t)


def _build_detail_spline(settings: dict, landmark_settings: dict = None, span_pct=None):
    """詳細設定が有効な場合、内側アーチ用のPCHIPを構築して返す。
    制御点: [(start,0), (subtalar,h0), (navicular,h1), (cuneiform,h2), (m5,h3), (end,0)]
    landmark_settings が渡された場合は実際のランドマーク位置を使用（フロントエンドの表示と一致）。

    span_pct は描いた内側アーチ曲線自身のX範囲(%)。パーセンテージ設定の
    medial_start/medial_end とは食い違うことがあり、その差の分だけ
    「パッドはあるのに高さがゼロ」の帯ができるため、曲線側を正とする。
    """
    if not settings.get('medial_detail_enabled'):
        return None
    detail_heights = settings.get('medial_detail_heights', [])
    if len(detail_heights) < 4:
        return None
    ms = settings['medial_start']
    mp = settings['medial_peak']
    me = settings['medial_end']
    curve_me = me
    if span_pct:
        ms, me = float(span_pct[0]), float(span_pct[1])
        if len(span_pct) > 2:
            curve_me = float(span_pct[2])
        else:
            curve_me = me

    lm = landmark_settings or {}
    subtalar_x  = lm.get('subtalar',          (ms + mp) / 2)
    navicular_x = lm.get('navicular',          mp)
    cuneiform_x = lm.get('medial_cuneiform',   (mp + curve_me) / 2)
    metatarsal  = lm.get('metatarsal',         curve_me)
    m5_x        = (cuneiform_x + (metatarsal + 1.0)) / 2  # フロントエンドと同じ計算

    xs = [ms, subtalar_x, navicular_x, cuneiform_x, m5_x, me]
    ys = [0.0, float(detail_heights[0]), float(detail_heights[1]),
          float(detail_heights[2]), float(detail_heights[3]), 0.0]
    try:
        return PchipInterpolator(xs, ys, extrapolate=False)
    except Exception as e:
        log_debug(f"[DETAIL_SPLINE] Failed: {e}")
        return None


def _build_transverse_detail_spline(settings: dict, landmark_settings: dict = None, span_pct=None):
    """横アーチ詳細設定が有効な場合、PCHIPを構築して返す。
    制御点: [(start,0), (nav,h0), (cun,h1), (mt,h2), (met,h3), (end,0)]
    landmark_settings が渡された場合は実際のランドマーク位置を使用。
    span_pct は描いた横アーチ曲線自身のX範囲(%)。内側と同様に曲線側を正とする。
    """
    if not settings.get('transverse_detail_enabled'):
        return None
    detail_heights = settings.get('transverse_detail_heights', [])
    if len(detail_heights) < 4:
        return None
    ts = settings['transverse_start']
    te = settings['transverse_end']
    if span_pct:
        ts, te = float(span_pct[0]), float(span_pct[1])
    tr = max(1.0, te - ts)

    def clamp(v):
        return max(ts + 0.5, min(te - 0.5, v))

    lm = landmark_settings or {}
    nav_x = clamp(lm.get('navicular',        ts + tr * 0.15))
    cun_x = clamp(lm.get('medial_cuneiform', ts + tr * 0.45))
    met_raw = lm.get('metatarsal', ts + tr * 0.85)
    mt_x  = clamp((cun_x + clamp(met_raw)) / 2)
    met_x = clamp(met_raw)

    xs = [ts, nav_x, cun_x, mt_x, met_x, te]
    ys = [0.0, float(detail_heights[0]), float(detail_heights[1]),
          float(detail_heights[2]), float(detail_heights[3]), 0.0]

    # xs が狭義単調増加でなければスキップ
    if not all(xs[i] < xs[i + 1] for i in range(len(xs) - 1)):
        log_debug(f"[TRANSVERSE_DETAIL_SPLINE] xs not strictly increasing: {xs}")
        return None
    try:
        return PchipInterpolator(xs, ys, extrapolate=False)
    except Exception as e:
        log_debug(f"[TRANSVERSE_DETAIL_SPLINE] Failed: {e}")
        return None


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


def _shape_preserving_curve_points(curve_type: str, raw_pts: list) -> list:
    """Return monotone-X controls, with the ArchPad M3-M4 fairing apex."""
    points = [list(point) for point in raw_pts]
    if curve_type == 'medial' and len(points) >= 5:
        m3 = points[3]
        m4 = points[4]
        if m4[0] > m3[0] + 1e-8:
            points.insert(4, [
                0.5 * (m3[0] + m4[0]),
                # Normalized Bionicsol coordinates increase toward the lateral
                # side.  Positive Y produces the intended smooth outer apex.
                0.5 * (m3[1] + m4[1]) + 0.75,
            ])
    monotone = []
    for point in points:
        if not monotone or point[0] > monotone[-1][0] + 1e-8:
            monotone.append(point)
    return monotone


def create_profile_interpolators(arch_settings: dict = None, landmark_settings: dict = None, wall_params: dict = None, arch_curves: dict = None, outline_x_range=None, pad_params: dict = None):
    settings = DEFAULT_ARCH_SETTINGS.copy()
    if arch_settings: settings.update(arch_settings)

    medial_carrier_forward_zero_x = None
    if arch_curves:
        bridge = arch_curves.get('metatarsalBridge')
        if bridge and len(bridge) >= 1:
            try:
                t2 = bridge[0]
                medial_carrier_forward_zero_x = float(
                    t2.get('x') if isinstance(t2, dict) else t2[0]
                )
            except (KeyError, TypeError, ValueError, IndexError):
                pass

    # ランドマーク別高さ(詳細設定)のスプラインは、描いた曲線自身のX範囲に張る。
    # arch_settings の medial_start/end とは食い違うことがあり、その差の分だけ
    # 「パッドはあるのに高さがゼロ」の帯が MF5/MB1 側にできてしまう。
    detail_spans = {}
    if arch_curves and outline_x_range:
        x_origin, x_end = float(outline_x_range[0]), float(outline_x_range[1])
        span_len = x_end - x_origin
        if span_len > 0:
            for key, curve_name in (('medial', 'medial'), ('transverse', 'transverse')):
                points = arch_curves.get(curve_name)
                if points and len(points) > 1:
                    xs = [float(p['x']) for p in points]
                    span_end = max(xs)
                    original_span_end = span_end
                    if key == 'medial':
                        if medial_carrier_forward_zero_x is not None:
                            # T2 is forward of T1. Keeping T1 as the carrier end made
                            # a hard vertical cutoff before the tail could reach the boundary.
                            span_end = max(
                                span_end, medial_carrier_forward_zero_x
                            )
                    detail_spans[key] = (
                        (min(xs) - x_origin) / span_len * 100.0,
                        (span_end - x_origin) / span_len * 100.0,
                    )
                    if key == 'medial' and span_end > original_span_end:
                        # Preserve the old end for intermediate landmark defaults. Moving
                        # those knots would alter the established arch behind the tail.
                        detail_spans[key] += (
                            (original_span_end - x_origin) / span_len * 100.0,
                        )
    
    wall_profile = generate_wall_profile(landmark_settings, wall_params)
    wall_x = sorted(wall_profile.keys())
    inner_walls = [wall_profile[x][0] for x in wall_x]
    outer_walls = [wall_profile[x][1] for x in wall_x]
    
    heel_profile_data = generate_heel_cup_profile(landmark_settings)
    heel_x = sorted(heel_profile_data.keys())
    heel_cup = [heel_profile_data[x] for x in heel_x]
    
    arch_profile = generate_arch_profile(settings, landmark_settings, detail_spans)
    arch_x = sorted(arch_profile.keys())
    arch_outer = [arch_profile[x][0] for x in arch_x]
    arch_inner = [arch_profile[x][1] for x in arch_x]
    arch_transverse = [arch_profile[x][2] for x in arch_x]
    
    custom_boundaries = {}
    custom_spans = {}       # 実線曲線が実際に描かれているX範囲(mm)。高さの包絡線はここから作る
    dense_closed = {}       # 横アーチの放射ドーム構築用
    raw_bridges = {}  # Keep raw bridge control points for arch pad polygon smoothing
    if arch_curves:
        for curve_type, points in arch_curves.items():
            # arch_curves also carries scalars alongside the curves - schemaVersion is
            # an int - so anything that is not a list of points is skipped here rather
            # than reaching len() and raising.
            if not isinstance(points, (list, tuple)):
                continue
            if points and len(points) > 1:
                if curve_type in ('heelBridge', 'lateralBridge', 'metatarsalBridge'):
                    # Store raw control points for arch pad polygon (Catmull-Rom applied to whole polygon)
                    raw_pts = [[p['x'], p['y']] for p in points]
                    raw_bridges[curve_type] = raw_pts
                    # Also store densified version for other uses
                    if len(raw_pts) >= 2:
                        dense_pts = _densify_open_curve(raw_pts)
                        custom_boundaries[curve_type] = dense_pts
                        log_debug(f"[DENSIFY_BRIDGE] {curve_type}: {len(raw_pts)} pts -> {len(dense_pts)} pts")
                    else:
                        custom_boundaries[curve_type] = raw_pts
                elif curve_type == 'transverse' or curve_type == 'transverseFlat':
                    # Transverse is a closed polygon, densify via Catmull-Rom for smooth boundary
                    poly_points = [[p['x'], p['y']] for p in points]
                    if curve_type == 'transverse':
                        # The arch pad loop needs T3 raw to bridge lateralBridge(->T4) and
                        # metatarsalBridge(T2->), which otherwise short-cut past it.
                        raw_bridges['transverse'] = poly_points
                    try:
                        dense_points = _densify_closed_polygon(poly_points)
                        dense_closed[curve_type] = dense_points
                        custom_boundaries[curve_type] = MplPath(dense_points)
                        print(f"[DENSIFY] {curve_type}: {len(poly_points)} pts -> {len(dense_points)} pts")
                        with open("densify_debug.log", "a") as _f:
                            _f.write(f"[DENSIFY] {curve_type}: {len(poly_points)} -> {len(dense_points)}\n")
                    except Exception as e:
                        print(f"[WARN] Failed to create {curve_type} polygon: {e}")
                else:
                    # Longitudinal boundaries use PCHIP so they cannot overshoot or wave
                    # between anatomical control points.
                    raw_pts = [[p['x'], p['y']] for p in points]
                    mono_pts = _shape_preserving_curve_points(curve_type, raw_pts)
                    if len(mono_pts) > 1:
                        try:
                            xs_sorted = [p[0] for p in mono_pts]
                            ys_sorted = [p[1] for p in mono_pts]
                            # Keep the boundary itself non-extrapolating. The medial caller
                            # clamps it only while the drawn forward tail is active;
                            # lateral callers still treat an out-of-range boundary as absent.
                            custom_boundaries[curve_type] = PchipInterpolator(
                                xs_sorted, ys_sorted, extrapolate=False
                            )
                            if curve_type in ('medial', 'lateral'):
                                custom_spans[curve_type] = (xs_sorted[0], xs_sorted[-1])
                            log_debug(f"[INTERP_OK] {curve_type}: PCHIP with {len(mono_pts)} pts")
                        except Exception as e:
                            log_debug(f"[INTERP_FAIL] {curve_type}: {e}")
                            print(f"[WARN] Failed to create {curve_type} interpolator: {e}")
    
    transverse_dome = None
    if 'transverse' in dense_closed and 'transverseFlat' in dense_closed:
        try:
            transverse_dome = _build_radial_dome(
                dense_closed['transverse'], dense_closed['transverseFlat']
            )
        except Exception as e:
            log_debug(f"[DOME_FAIL] transverse: {e}")

    kind = 'cubic' if len(wall_x) > 3 else 'linear'
    # アーチのX方向プロファイルだけは PCHIP を使う。節点が疎で不均等なので、
    # cubic spline だと節点間でオーバーシュートして層の輪郭がうねる。
    def _arch_interp(values, sample_x=None):
        xs = arch_x if sample_x is None else sample_x
        if len(xs) > 3:
            return PchipInterpolator(xs, values, extrapolate=True)
        return interp1d(xs, values, kind='linear', fill_value='extrapolate')

    arch_inner_interp = _arch_interp(arch_inner)
    arch_inner_original = None
    medial_span = detail_spans.get('medial')
    if (
        medial_span and len(medial_span) > 2
        and settings.get('medial_detail_enabled')
    ):
        # Extending the last PCHIP knot slightly changes its earlier derivative.
        # Keep the original carrier available so x <= 140 mm stays bit-for-bit stable.
        original_spans = dict(detail_spans)
        original_spans['medial'] = (medial_span[0], medial_span[2])
        original_profile = generate_arch_profile(
            settings, landmark_settings, original_spans
        )
        original_x = sorted(original_profile.keys())
        original_inner = [original_profile[value][1] for value in original_x]
        arch_inner_original = _arch_interp(original_inner, original_x)

    medial_forward_boundary = _build_medial_forward_boundary(arch_curves)
    carrier_blend_end_x = 140.0
    if medial_carrier_forward_zero_x is not None:
        carrier_blend_end_x = max(
            140.0,
            medial_carrier_forward_zero_x - MEDIAL_FORWARD_TAIL_MM,
        )

    return {
        'inner_wall': interp1d(wall_x, inner_walls, kind=kind, fill_value='extrapolate'),
        'outer_wall': interp1d(wall_x, outer_walls, kind=kind, fill_value='extrapolate'),
        'heel_cup': interp1d(heel_x, heel_cup, kind=kind, fill_value='extrapolate'),
        'arch_outer': _arch_interp(arch_outer),
        'arch_inner': arch_inner_interp,
        'arch_inner_original': arch_inner_original,
        'medial_carrier_blend_end_x': carrier_blend_end_x,
        'medial_carrier_forward_zero_x': medial_carrier_forward_zero_x,
        'arch_transverse': _arch_interp(arch_transverse),
        'arch_settings': settings,
        'landmark_settings': landmark_settings or {},
        'custom_boundaries': custom_boundaries,
        'custom_spans': custom_spans,
        'transverse_dome': transverse_dome,
        'pad_thickness': (pad_params or {}).get('pad_thickness', PAD_THICKNESS_MM),
        'pad_edge_thickness': (pad_params or {}).get('pad_edge_thickness', PAD_EDGE_THICKNESS_MM),
        'pad_taper_width': (pad_params or {}).get('pad_taper_width', PAD_TAPER_WIDTH_MM),
        'raw_bridges': raw_bridges,
        'medial_forward_boundary': medial_forward_boundary
    }


# =============================================================================
# 輪郭処理
# =============================================================================

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
    # Distance to the nearest VERTEX, not to the nearest segment. That is an
    # approximation, but the outline is resampled to ~0.5mm here, so the two
    # agree to well under the mesh resolution: switching to exact segment
    # distance left the measured rim-band width identical (spread 0.75mm either
    # way, itself at the probe resolution) and doubled generation from 37s to
    # 76s, because this runs once per interior grid point.
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


def _build_medial_forward_boundary(arch_curves: dict = None):
    """Sample x_end(y) along M7 -> MF5 -> T1 -> T2 -> T3."""
    if not arch_curves:
        return None
    bridge = arch_curves.get('metatarsalBridge')
    transverse = arch_curves.get('transverse')
    if not bridge or len(bridge) < 3 or not transverse or len(transverse) < 4:
        return None

    def _xy(point):
        if isinstance(point, dict):
            return [float(point['x']), float(point['y'])]
        return [float(point[0]), float(point[1])]

    try:
        # T1 belongs to the transverse curve. The optional bridge copy can
        # drift because the rest of the engine no longer keeps it authoritative.
        chain = [
            _xy(bridge[-1]),       # M7
            _xy(bridge[-2]),       # MF5
            _xy(transverse[1]),    # T1
            _xy(bridge[0]),        # T2
            _xy(transverse[3]),    # T3
        ]
        dense = np.asarray(_densify_open_curve(chain), dtype=float)
    except (KeyError, TypeError, ValueError, IndexError):
        return None
    if dense.ndim != 2 or dense.shape[1] < 2:
        return None
    dense = dense[np.isfinite(dense[:, :2]).all(axis=1)]
    if len(dense) < 2:
        return None

    # np.interp needs ascending y. The production M7-MF5-T1-T2 chain is
    # monotone in y after densification, so this ordering preserves the notch.
    dense = dense[np.argsort(dense[:, 1], kind='stable')]
    keep = np.r_[True, np.diff(dense[:, 1]) > 1e-9]
    dense = dense[keep]
    if len(dense) < 2:
        return None
    return {
        'y': dense[:, 1],
        'x': dense[:, 0],
    }


def _medial_forward_carrier_x(
    x: float, y: float, boundary, x_ref: Optional[float]
) -> Optional[float]:
    """Warp only the medial carrier tail so it reaches zero on the chain."""
    if not boundary or x_ref is None:
        return x
    try:
        ys = np.asarray(boundary['y'], dtype=float)
        xs = np.asarray(boundary['x'], dtype=float)
    except (KeyError, TypeError, ValueError):
        return x
    if len(ys) < 2 or len(xs) != len(ys):
        return x

    # Clamp outside the chain so its endpoint clearance continues smoothly.
    y_sample = float(np.clip(y, ys[0], ys[-1]))
    x_end = float(np.interp(y_sample, ys, xs))
    x_knee = float(x_ref) - MEDIAL_FORWARD_TAIL_MM

    # Test the chain first: if a future chain falls behind the knee, the arch
    # must still end there instead of surviving because x is in the fixed zone.
    if x >= x_end:
        return None
    if x <= x_knee:
        return x
    tail_span = x_end - x_knee
    if tail_span <= 0.0:
        return None

    # An amplitude taper was tried here and cut a measured 1.4 mm pit at MF5.
    # Remapping the carrier's natural tail changes its length without removing
    # amplitude, while the band's plan-view lookup continues to use the true x.
    u = (x - x_knee) / tail_span
    return x_knee + u * (float(x_ref) - x_knee)


CLOSED_CURVE_SUBDIVISIONS = 24

# Arch pad body, matching the ArchPad Lab settings actually in use: the pad carries this
# much thickness through its core and tapers to the edge thickness at the rim.
PAD_THICKNESS_MM = 0.8
PAD_EDGE_THICKNESS_MM = 0.2
# Only a fallback now: the pad normally ramps across its own full depth.
PAD_TAPER_WIDTH_MM = 3.0
MEDIAL_FORWARD_TAIL_MM = 20.0


def _densify_closed_polygon(points: list, subdivisions: int = CLOSED_CURVE_SUBDIVISIONS) -> list:
    """Densify a closed polygon using Catmull-Rom spline interpolation.
    Converts N control points into N*subdivisions smooth polygon points.

    ArchPad Lab samples closed curves at 24 per span. At 8 the transverse ellipse came out
    with angular gaps up to 13.6 deg, and the radial dome interpolates its outer radius
    linearly between those samples - so the height contours showed visible facets from above.
    """
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


def _distance_to_polygon_edge(x: float, y: float, polygon_region: dict) -> float:
    """Return the shortest distance to a prepared closed polygon boundary."""
    offsets = np.array([x, y]) - polygon_region['segment_starts']
    segment_vectors = polygon_region['segment_vectors']
    length_sq = polygon_region['segment_length_sq']
    projections = np.divide(
        np.einsum('ij,ij->i', offsets, segment_vectors),
        length_sq,
        out=np.zeros_like(length_sq),
        where=length_sq > 1e-12
    )
    projections = np.clip(projections, 0.0, 1.0)
    residuals = offsets - projections[:, None] * segment_vectors
    return float(np.sqrt(np.min(np.einsum('ij,ij->i', residuals, residuals))))


def _nearest_polygon_edge(x: float, y: float, polygon_region: dict):
    """Shortest distance to a prepared closed polygon, plus where along it that lands.

    Returns (distance, first vertex index of the closest edge, position in [0, 1] along
    it). The position lets a per-vertex quantity be interpolated along the edge rather
    than snapped to whichever endpoint happens to be nearer, which would make that
    quantity jump from one query point to the next.
    """
    offsets = np.array([x, y]) - polygon_region['segment_starts']
    segment_vectors = polygon_region['segment_vectors']
    length_sq = polygon_region['segment_length_sq']
    projections = np.divide(
        np.einsum('ij,ij->i', offsets, segment_vectors),
        length_sq,
        out=np.zeros_like(length_sq),
        where=length_sq > 1e-12
    )
    projections = np.clip(projections, 0.0, 1.0)
    residuals = offsets - projections[:, None] * segment_vectors
    distance_sq = np.einsum('ij,ij->i', residuals, residuals)
    index = int(np.argmin(distance_sq))
    return float(np.sqrt(distance_sq[index])), index, float(projections[index])


def _hermite_position(p0, p1, m0, m1, parameter):
    t = float(parameter)
    t2, t3 = t * t, t * t * t
    return ((2*t3 - 3*t2 + 1)*p0 + (t3 - 2*t2 + t)*m0
            + (-2*t3 + 3*t2)*p1 + (t3 - t2)*m1)


def _hermite_derivative(p0, p1, m0, m1, parameter):
    t = float(parameter)
    return ((6*t*t - 6*t)*p0 + (3*t*t - 4*t + 1)*m0
            + (-6*t*t + 6*t)*p1 + (3*t*t - 2*t)*m1)


def _metatarsal_fairing(transverse, bridge):
    """ArchPad fairing controls for T2 -> T1 -> MF5 -> M7.

    T1 is a single shared anatomical point: it is transverse[1], the medial curve's
    last point, and (in legacy 4-point bridges) metatarsalBridge[1] under the name
    MB1. It is read from the transverse curve alone so the duplicate cannot drift.
    Bridges of 3 points (T2, MF5, M7) and legacy 4-point bridges both work.

    The rim passes through T1 exactly. It used to be pulled 14% toward MF5 to round
    that corner off, but the drawn chain only turns 12.2deg there - not a corner -
    and the shift moved the rim 1.09mm off the point the user placed. The real corner
    is the 63.7deg one at T2, coming off the transverse ellipse, and `departure`
    is what eases that one.
    """
    if len(transverse) < 4 or len(bridge) < 3:
        return None
    t0 = np.asarray(transverse[0], dtype=float)
    t3 = np.asarray(transverse[3], dtype=float)
    t2 = np.asarray(bridge[0], dtype=float)
    mb1 = np.asarray(transverse[1], dtype=float)
    mf5 = np.asarray(bridge[-2], dtype=float)
    m7 = np.asarray(bridge[-1], dtype=float)
    ellipse_t2_tangent = 0.5 * (mb1 - t3)
    ellipse_mb1_tangent = 0.5 * (t0 - t2)
    fraction = 0.525
    departure = _hermite_position(
        t2, mb1, ellipse_t2_tangent, ellipse_mb1_tangent, fraction
    )
    t2_departure_tangent = fraction * ellipse_t2_tangent
    departure_tangent = fraction * _hermite_derivative(
        t2, mb1, ellipse_t2_tangent, ellipse_mb1_tangent, fraction
    )
    blend = mb1
    m7_tangent = 0.5 * (m7 - mf5)
    first_rhs = 6.0 * (mf5 - departure) - 2.0 * departure_tangent
    second_rhs = 6.0 * (m7 - blend) - 2.0 * m7_tangent
    blend_tangent = (8.0 * first_rhs - 2.0 * second_rhs) / 60.0
    mf5_tangent = (-2.0 * first_rhs + 8.0 * second_rhs) / 60.0
    return {
        'departure': departure,
        'blend': blend,
        't2_incoming': ellipse_t2_tangent,
        't2_outgoing': t2_departure_tangent,
        'departure_tangent': departure_tangent,
        'blend_tangent': blend_tangent,
        'mf5_tangent': mf5_tangent,
    }


def _sample_closed_fair_curve(points, overrides=None, corners=(), subdivisions=8):
    controls = np.asarray(points, dtype=float)
    count = len(controls)
    if count < 3:
        return controls
    overrides = overrides or {}
    corner_set = set(corners)
    result = []
    for index in range(count):
        following = (index + 1) % count
        p1, p2 = controls[index], controls[following]
        p0 = p1 if index in corner_set else controls[(index - 1) % count]
        p3 = p2 if following in corner_set else controls[(index + 2) % count]
        start_override = overrides.get(index)
        end_override = overrides.get(following)
        tangent_start = (
            np.asarray(start_override.get('outgoing'), dtype=float)
            if isinstance(start_override, dict) and start_override.get('outgoing') is not None
            else np.asarray(start_override, dtype=float)
            if start_override is not None and not isinstance(start_override, dict)
            else 0.5 * (p2 - p0)
        )
        tangent_end = (
            np.asarray(end_override.get('incoming'), dtype=float)
            if isinstance(end_override, dict) and end_override.get('incoming') is not None
            else np.asarray(end_override, dtype=float)
            if end_override is not None and not isinstance(end_override, dict)
            else 0.5 * (p3 - p1)
        )
        if index in corner_set:
            tangent_start = 0.5 * (p2 - p1)
        if following in corner_set:
            tangent_end = 0.5 * (p2 - p1)
        for step in range(subdivisions):
            result.append(_hermite_position(
                p1, p2, tangent_start, tangent_end, step / subdivisions
            ))
    return np.asarray(result)


def _build_arch_pad_region(custom_boundaries: dict, f_y_min, f_y_max, raw_bridges: dict = None) -> Optional[dict]:
    """Build the prepared closed polygon used by the arch pad micro floor."""
    heel_bridge = (raw_bridges or {}).get('heelBridge') or custom_boundaries.get('heelBridge')
    lateral_bridge = (raw_bridges or {}).get('lateralBridge') or custom_boundaries.get('lateralBridge')
    metatarsal_bridge = (raw_bridges or {}).get('metatarsalBridge') or custom_boundaries.get('metatarsalBridge')

    if not heel_bridge or not lateral_bridge or not metatarsal_bridge:
        return None

    # Bionicsol right-foot reference: medial outline is MinY, lateral is MaxY.
    n_samples = 15
    control_points = []

    # 1. heelBridge (M0 -> L0)
    control_points.extend(heel_bridge)

    # 2. Lateral outline: heelBridge last -> lateralBridge first (f_y_max)
    outer_start_x = heel_bridge[-1][0]
    outer_end_x = lateral_bridge[0][0]
    if abs(outer_end_x - outer_start_x) > 0.1:
        outer_xs = np.linspace(outer_start_x, outer_end_x, n_samples + 2)[1:-1]
        for ox in outer_xs:
            control_points.append([float(ox), float(f_y_max(ox))])

    # 3. lateralBridge (L4 -> B1 -> T4)
    control_points.extend(lateral_bridge)

    # 4. transverse T3, bridging lateralBridge's end (T4) to metatarsalBridge's start (T2).
    #    Without it the loop cuts the corner straight from T4 to T2, which shows up as a
    #    kink on the toe side of the arch pad outline.
    transverse_pts = (raw_bridges or {}).get('transverse')
    if transverse_pts and len(transverse_pts) >= 5:
        control_points.append(list(transverse_pts[3]))

    # 5. Follow the transverse ellipse out of T2, then fair through MF5 to M7.
    t2_index = len(control_points)
    fairing = _metatarsal_fairing(transverse_pts or [], metatarsal_bridge)
    if fairing is not None:
        control_points.extend([
            list(metatarsal_bridge[0]),
            list(fairing['departure']),
            list(fairing['blend']),
            list(metatarsal_bridge[-2]),
            list(metatarsal_bridge[-1]),
        ])
    else:
        control_points.extend(metatarsal_bridge)

    # 6. Medial outline: metatarsalBridge last -> heelBridge first (f_y_min, reversed)
    inner_start_x = metatarsal_bridge[-1][0]
    inner_end_x = heel_bridge[0][0]
    if abs(inner_end_x - inner_start_x) > 0.1:
        inner_xs = np.linspace(inner_start_x, inner_end_x, n_samples + 2)[1:-1]
        for ix in inner_xs:
            control_points.append([float(ix), float(f_y_min(ix))])

    if len(control_points) < 3:
        return None

    try:
        overrides = {}
        if fairing is not None:
            overrides = {
                t2_index: {
                    'incoming': fairing['t2_incoming'],
                    'outgoing': fairing['t2_outgoing'],
                },
                t2_index + 1: fairing['departure_tangent'],
                t2_index + 2: fairing['blend_tangent'],
                t2_index + 3: fairing['mf5_tangent'],
            }
        m7_index = t2_index + (4 if fairing is not None else len(metatarsal_bridge) - 1)
        subdivisions = 8
        boundary_points = _sample_closed_fair_curve(
            control_points,
            overrides=overrides,
            corners=(0, len(heel_bridge) - 1, m7_index),
            subdivisions=subdivisions,
        )
        if len(boundary_points) < 3:
            return None

        segment_starts = boundary_points
        segment_vectors = np.roll(boundary_points, -1, axis=0) - boundary_points
        segment_length_sq = np.einsum(
            'ij,ij->i', segment_vectors, segment_vectors
        )
        bounds_min = boundary_points.min(axis=0)
        bounds_max = boundary_points.max(axis=0)
        log_debug(
            f"[ARCH_PAD_REGION] {len(control_points)} ctrl -> "
            f"{len(boundary_points)} boundary points"
        )

        region = {
            'path': MplPath(boundary_points),
            'boundary_points': boundary_points,
            'segment_starts': segment_starts,
            'segment_vectors': segment_vectors,
            'segment_length_sq': segment_length_sq,
            'bounds': (
                float(bounds_min[0]),
                float(bounds_min[1]),
                float(bounds_max[0]),
                float(bounds_max[1])
            )
        }
        # How deep the pad gets. The pad body ramps from its edge value to full thickness
        # across this whole depth, so the contours are offsets of the pad outline itself -
        # following the L4/B1/T4 line on the lateral side and the heel bridge at the back -
        # instead of levelling off a few millimetres in.
        field = _build_pad_depth_field(region)
        region['depth_field'] = field
        region['max_depth'] = field['max_depth'] if field else 0.0
        # How strongly the pad's rim step stands, as a value carried ON the rim itself.
        #
        # This used to be a distance to the raw T2-MB1-MF5-M7 polyline. That polyline is not
        # the rim: 16 of its 25 densified points lie INSIDE the pad, so the fade drew a 3mm
        # groove along its straight segments a millimetre or two in from the edge - a second,
        # ghost outline. Worse, it touches the rim exactly at MF5, so it flattened the step
        # precisely at the notch the user draws there.
        #
        # Carrying the weight along the rim's own arc length fixes both: there is no interior
        # line to leave a trace, and the notch at MF5 keeps a full step. Only the immediate
        # neighbourhood of T2 - where the pad runs into the transverse ellipse and the arch has
        # already dropped to zero, so the step would be the only thing left standing - is faded.
        region['rim_edge_weight'] = _rim_step_weight(
            boundary_points,
            None if fairing is None else t2_index * subdivisions,
        )
        return region
    except Exception as e:
        print(f"[WARN] Failed to build arch pad region: {e}")
        return None


PAD_FIELD_CELL_MM = 0.4
PAD_FIELD_SIGMA_MM = 1.2
PAD_FIELD_BLEND_START_MM = 1.0
PAD_FIELD_BLEND_END_MM = 3.0


def _build_pad_depth_field(region: dict) -> Optional[dict]:
    """Depth-inside-the-pad as a smooth grid.

    Straight distance-to-outline is only C0: its gradient flips sign across the polygon's
    medial axis, so using it over the pad's whole depth draws the skeleton onto the surface
    as a visible crease. Smoothing the field removes that, but plain smoothing also pulls the
    rim down and loses the exact outline offset there. So the smoothed field is blended in
    only past PAD_FIELD_BLEND_START_MM, leaving the rim exact and the interior smooth.

    Gridding it also makes lookups O(1) instead of measuring against every boundary segment.
    """
    from scipy.ndimage import gaussian_filter

    x0, y0, x1, y1 = region['bounds']
    if x1 <= x0 or y1 <= y0:
        return None
    cell = PAD_FIELD_CELL_MM
    margin = 4.0
    xs = np.arange(x0 - margin, x1 + margin + cell, cell)
    ys = np.arange(y0 - margin, y1 + margin + cell, cell)
    grid_x, grid_y = np.meshgrid(xs, ys)
    points = np.column_stack((grid_x.ravel(), grid_y.ravel()))

    inside = region['path'].contains_points(points)
    starts = region['segment_starts']
    vectors = region['segment_vectors']
    length_sq = region['segment_length_sq']

    depth = np.zeros(len(points), dtype=float)
    interior = np.flatnonzero(inside)
    for begin in range(0, len(interior), 4096):
        idx = interior[begin:begin + 4096]
        offsets = points[idx][:, None, :] - starts[None, :, :]
        projections = np.divide(
            np.einsum('ijk,jk->ij', offsets, vectors), length_sq[None, :],
            out=np.zeros((len(idx), len(vectors))), where=length_sq[None, :] > 1e-12
        )
        projections = np.clip(projections, 0.0, 1.0)
        residuals = offsets - projections[:, :, None] * vectors[None, :, :]
        depth[idx] = np.sqrt(np.einsum('ijk,ijk->ij', residuals, residuals).min(axis=1))

    depth = depth.reshape(grid_x.shape)
    smoothed = gaussian_filter(depth, sigma=PAD_FIELD_SIGMA_MM / cell, mode='nearest')
    weight = np.clip(
        (depth - PAD_FIELD_BLEND_START_MM) / (PAD_FIELD_BLEND_END_MM - PAD_FIELD_BLEND_START_MM),
        0.0, 1.0,
    )
    weight = weight * weight * (3.0 - 2.0 * weight)
    blended = depth + weight * (smoothed - depth)
    blended[~inside.reshape(grid_x.shape)] = 0.0

    return {
        'origin': (float(xs[0]), float(ys[0])),
        'cell': cell,
        'values': blended,
        'max_depth': float(blended.max()),
    }


# Arc length, measured along the rim itself, over which the rim step returns to full
# strength on either side of T2. T2 is roughly 15.9mm of chord from T1, so the step is
# back at full well before the MF5 notch.
PAD_RIM_STEP_FADE_MM = 8.0

# Distance inside the rim over which the pad's edge step builds up. Set to about one
# triangulation feature spacing so the edge still reads as a crisp line, while making
# the height a continuous function of position - which is what stops vertices sitting
# exactly on the rim from getting a random answer out of the inside/outside test.
PAD_RIM_GATE_MM = 0.25

# How far inside the rim the per-rim-point step weight is allowed to matter. Beyond
# this the weight is forced back to full strength, so a fade applied at one spot on
# the rim cannot reach into the pad's interior along a nearest-point wedge.
PAD_RIM_WEIGHT_COLLAR_MM = 3.0


def _rim_step_weight(
    boundary_points: np.ndarray, t2_boundary_index: Optional[int]
) -> np.ndarray:
    """Per-rim-point strength of the pad's edge step, 0 at T2 rising to 1 away from it.

    Indexed to match boundary_points, so an interior query point can read the weight of
    its nearest rim point. Distance is measured the short way round the closed rim, so
    the ramp is symmetric about T2 and never jumps.
    """
    weight = np.ones(len(boundary_points), dtype=float)
    if t2_boundary_index is None or len(boundary_points) < 3:
        return weight
    steps = np.hypot(*(np.roll(boundary_points, -1, axis=0) - boundary_points).T)
    arc = np.concatenate(([0.0], np.cumsum(steps)))
    perimeter = arc[-1]
    along = np.abs(arc[:-1] - arc[t2_boundary_index % len(boundary_points)])
    along = np.minimum(along, perimeter - along)
    t = np.clip(along / PAD_RIM_STEP_FADE_MM, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _distance_to_polyline(x: float, y: float, points: np.ndarray) -> float:
    """Shortest distance from a point to an open polyline."""
    starts = points[:-1]
    vectors = points[1:] - starts
    length_sq = np.einsum('ij,ij->i', vectors, vectors)
    offsets = np.array([x, y]) - starts
    projections = np.divide(
        np.einsum('ij,ij->i', offsets, vectors), length_sq,
        out=np.zeros_like(length_sq), where=length_sq > 1e-12
    )
    residuals = offsets - np.clip(projections, 0.0, 1.0)[:, None] * vectors
    return float(np.sqrt(np.einsum('ij,ij->i', residuals, residuals).min()))


def _sample_pad_depth(field: dict, x: float, y: float) -> float:
    """Bilinear lookup into the pad depth grid."""
    ox, oy = field['origin']
    cell = field['cell']
    values = field['values']
    fx = (x - ox) / cell
    fy = (y - oy) / cell
    ix, iy = int(np.floor(fx)), int(np.floor(fy))
    if ix < 0 or iy < 0 or ix + 1 >= values.shape[1] or iy + 1 >= values.shape[0]:
        return 0.0
    tx, ty = fx - ix, fy - iy
    top = values[iy, ix] * (1 - tx) + values[iy, ix + 1] * tx
    bottom = values[iy + 1, ix] * (1 - tx) + values[iy + 1, ix + 1] * tx
    return float(top * (1 - ty) + bottom * ty)


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
    outline: np.ndarray = None,
    wall_dish_reach_mm: float = None,
    medial_band_drop_bias: float = None,
    lateral_band_drop_bias: float = None
) -> float:
    if wall_dish_reach_mm is None:
        wall_dish_reach_mm = WALL_DISH_REACH_MM
    length = x_max - x_min
    x_ratio = (x - x_min) / length * 100 if length > 0 else 50
    x_ratio = np.clip(x_ratio, 0, 100)
    
    local_width = y_max_at_x - y_min_at_x
    if local_width > 0.5:
        y_ratio = (y - y_min_at_x) / local_width
    else:
        y_ratio = 0.5
    y_ratio = np.clip(y_ratio, 0, 1)
    
    # Bionicsol right-foot reference: MinY=inner/medial, MaxY=outer/lateral.
    # Core logic continues to use 1.0 for the inner/medial side.
    arch_y_ratio = 1.0 - y_ratio
    
    inner_wall_base = float(profiles['inner_wall'](x_ratio))
    outer_wall_base = float(profiles['outer_wall'](x_ratio))
    
    inner_wall = max(0, inner_wall_base + wall_offset_mm) if inner_wall_base > 0 else 0
    outer_wall = max(0, outer_wall_base + wall_offset_mm) if outer_wall_base > 0 else 0
    
    heel_cup = float(profiles['heel_cup'](x_ratio)) * heel_cup_scale
    arch_outer = float(profiles['arch_outer'](x_ratio)) * arch_scale
    def _medial_carrier_at(x_sample: float) -> float:
        sample_ratio = (x_sample - x_min) / length * 100 if length > 0 else 50
        sample_ratio = float(np.clip(sample_ratio, 0, 100))
        carrier = float(profiles['arch_inner'](sample_ratio)) * arch_scale
        arch_inner_original = profiles.get('arch_inner_original')
        if arch_inner_original is None:
            return carrier

        original_value = float(arch_inner_original(sample_ratio)) * arch_scale
        blend_end_x = float(profiles.get('medial_carrier_blend_end_x', 140.0))
        if x_sample <= 140.0:
            return original_value
        if blend_end_x > 140.0 and x_sample < blend_end_x:
            # Reach the extended carrier before its forward warp begins. A
            # smoothstep avoids trading the old T1 line for a blend-start line.
            carrier_t = (x_sample - 140.0) / (blend_end_x - 140.0)
            carrier_t = carrier_t * carrier_t * (3.0 - 2.0 * carrier_t)
            return (
                original_value * (1.0 - carrier_t)
                + carrier * carrier_t
            )
        return carrier

    arch_inner = _medial_carrier_at(x)
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

    # 壁の左右ブレンド。arch_y_ratio をそのまま重みに使うと、足幅全体にわたる線形補間に
    # なるため、背の高い内側壁が反対側（外側）の縁まで染み出して細いリムを作る。
    # 切り替えを足幅の中央 30-70% に閉じ込める。そこは輪郭から十分離れていて blend=1、
    # つまり壁の項が必ずゼロになる領域なので、縁付近の壁の形は一切変わらない。
    _wall_mix = min(1.0, max(0.0, (arch_y_ratio - 0.3) / 0.4))
    _wall_mix = _wall_mix * _wall_mix * (3 - 2 * _wall_mix)
    normal_wall_height = outer_wall * (1 - _wall_mix) + inner_wall * _wall_mix

    height = base_thickness
    
    if is_boundary:
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
            t = (dist_from_heel_center
                 - (heel_cup_region_mm - transition_zone_mm)) / transition_zone_mm
            t = float(np.clip(t, 0, 1))
            t = t * t * (3 - 2 * t)  # smoothstep for angular-free transition
            wall_height = uniform * (1 - t) + normal_wall_height * t
            # Fade the cup term out over the SAME ramp. Clipping it at the
            # region circle instead dropped (heel_cup - normal_wall_height) in a
            # single step along that circle, which reads from above as a corner
            # where the contours cross the heelBridge line.
            wall_height = max(wall_height, heel_cup * (1.0 - t))
        else:
            wall_height = normal_wall_height
        height += wall_height
    else:
        dist_from_inner_mm = abs(y - y_max_at_x)
        dist_from_outer_mm = abs(y - y_min_at_x)

        custom_boundaries = profiles.get('custom_boundaries', {})

        # X方向：ヒールカップ領域では輪郭からの最短距離を使用
        if x_ratio <= heel_cup_region and outline is not None:
            dist_from_heel_mm = _distance_to_outline(x, y, outline)
        else:
            dist_from_heel_mm = (x_ratio / 100.0) * length

        # Y direction transition distance
        # ヒールカップ後端では輪郭幅に応じて制限
        transition_distance_mm = wall_dish_reach_mm
        if x_ratio <= 10.0 and local_width > 0:
            max_y_transition = local_width * 0.35
            transition_distance_mm = min(transition_distance_mm, max_y_transition)

        # X direction transition distance (only within heel cup region)
        x_transition_mm = wall_dish_reach_mm if x_ratio <= heel_cup_region else 0.0

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
            t = (dist_from_heel_center
                 - (heel_cup_region_mm - transition_zone_mm)) / transition_zone_mm
            t = float(np.clip(t, 0, 1))
            t = t * t * (3 - 2 * t)  # smoothstep for angular-free transition
            wall_height = uniform * (1 - t) + normal_wall_height * t
            # Fade the cup term out over the SAME ramp. Clipping it at the
            # region circle instead dropped (heel_cup - normal_wall_height) in a
            # single step along that circle, which reads from above as a corner
            # where the contours cross the heelBridge line.
            wall_height = max(wall_height, heel_cup * (1.0 - t))
        else:
            wall_height = normal_wall_height


        longitudinal_arch_height = 0.0
        transverse_arch_height = 0.0
        
        arch_settings = profiles['arch_settings']
        use_custom_medial = 'medial' in custom_boundaries and 'medialFlat' in custom_boundaries
        use_custom_lateral = 'lateral' in custom_boundaries and 'lateralFlat' in custom_boundaries
        
        if use_custom_medial or use_custom_lateral:
            medial_h, lateral_h = 0.0, 0.0
            custom_spans = profiles.get('custom_spans', {})

            # 高さの山は、描いた曲線自身のX範囲から作る。詳細設定(ランドマーク別高さ)が
            # 有効なときだけ、そのスプラインが山の形を決める。
            if use_custom_medial:
                if arch_settings.get('medial_detail_enabled'):
                    medial_x_eval = _medial_forward_carrier_x(
                        x, y,
                        profiles.get('medial_forward_boundary'),
                        profiles.get('medial_carrier_forward_zero_x'),
                    )
                    medial_peak = (
                        0.0 if medial_x_eval is None
                        else _medial_carrier_at(medial_x_eval)
                    )
                else:
                    medial_peak = (
                        arch_settings.get('medial_height', 1.0) * arch_scale
                        * _longitudinal_span_factor(x, custom_spans.get('medial'))
                    )
                medial_h = _custom_band_height(
                    x, y, custom_boundaries['medial'], custom_boundaries['medialFlat'],
                    medial_peak, clamp_outer=True, drop_bias=medial_band_drop_bias
                )

            if use_custom_lateral:
                lateral_peak = (
                    arch_settings.get('lateral_height', 0.5) * arch_scale
                    * _longitudinal_span_factor(x, custom_spans.get('lateral'))
                )
                lateral_h = _custom_band_height(
                    x, y, custom_boundaries['lateral'], custom_boundaries['lateralFlat'],
                    lateral_peak,
                    drop_bias=(LATERAL_BAND_DROP_BIAS if lateral_band_drop_bias is None
                               else lateral_band_drop_bias)
                )

            # 曲線が無い側だけ、従来のパーセンテージ計算で補う。曲線がある側は
            # 範囲外を必ずフラットのままにする（ここで補うとL4より前方にアーチが生える）。
            if not use_custom_medial:
                medial_y_start = arch_settings.get('medial_y_start', 65.0)/100
                medial_y_end = arch_settings.get('medial_y_end', 100.0)/100
                if arch_y_ratio >= medial_y_start:
                    if (medial_y_end - medial_y_start) > 0:
                        medial_h = arch_inner * min(1.0, (arch_y_ratio - medial_y_start)/(medial_y_end - medial_y_start))
                    else: medial_h = arch_inner

            if not use_custom_lateral:
                lateral_y_start = arch_settings.get('lateral_y_start', 0.0)/100
                lateral_y_end = arch_settings.get('lateral_y_end', 25.0)/100
                if arch_y_ratio <= lateral_y_end:
                    if (lateral_y_end - lateral_y_start) > 0:
                        lateral_h = arch_outer * max(0.0, 1.0 - (arch_y_ratio - lateral_y_start)/(lateral_y_end - lateral_y_start))
                    else: lateral_h = arch_outer

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

        longitudinal_arch_height = (
            max(0.0, medial_h) ** 6 + max(0.0, lateral_h) ** 6
        ) ** (1.0 / 6.0)

        # 3. Transverse Arch
        transverse_dome = profiles.get('transverse_dome')
        if transverse_dome is not None:
            # 実線と破線(Flat)の両ポリゴンの重心を中心にした放射ドーム。X方向を無関係な
            # ベルカーブで、Y方向をX列ごとの縦テントで別々に作ると、頂点が両者の交点に
            # できてしまい円が変な方向に寄る。角度ごとの外周半径で正規化すれば
            # 同心円状の綺麗な層になる。
            if arch_settings.get('transverse_detail_enabled'):
                transverse_peak = arch_transverse_raw
            else:
                transverse_peak = arch_settings.get('transverse_height', 0.5) * arch_scale
            if transverse_peak > 0:
                transverse_arch_height = transverse_peak * _radial_dome_ratio(transverse_dome, x, y)
        elif 'transverse' in custom_boundaries:
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

                # Rounded dome without a flat crown.
                s = f * f * (3 - 2 * f)
                transverse_arch_height = arch_transverse * s
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
                    s = f * f * (3 - 2 * f)
                    transverse_arch_height = arch_transverse * s
        
        # Smooth maximum prevents a ridge where longitudinal and transverse arches overlap.
        blend_power = 6.0
        arch_height = (
            max(0.0, longitudinal_arch_height) ** blend_power
            + max(0.0, transverse_arch_height) ** blend_power
        ) ** (1.0 / blend_power)

        # Arch pad body. ArchPad Lab builds the pad as a solid of its own - full thickness
        # through the core, tapering to the edge thickness across taper_width at the rim -
        # and ADDS the arch on top of it (meshgen.py: top = base + arch). Bionic Sole used to
        # have only a 0.4mm floor combined with max(), so wherever the arch rose above 0.4mm
        # the pad body contributed nothing at all and the pad had no substance of its own.
        arch_pad_region = profiles.get('arch_pad_region')
        if arch_pad_region is not None:
            pad_x_min, pad_y_min, pad_x_max, pad_y_max = arch_pad_region['bounds']
            in_pad_bounds = (
                pad_x_min <= x <= pad_x_max and
                pad_y_min <= y <= pad_y_max
            )
            if (
                in_pad_bounds
                and arch_pad_region['path'].contains_point((x, y))
            ):
                pad_core = float(profiles.get('pad_thickness', PAD_THICKNESS_MM))
                pad_edge = float(profiles.get('pad_edge_thickness', PAD_EDGE_THICKNESS_MM))
                # Ramp across the pad's whole depth, not a fixed band at the rim. A fixed band
                # put a shoulder a few millimetres in and left everything beyond it a flat
                # plateau; spreading it over the full depth makes the pad rise evenly from its
                # outline to its deepest point.
                depth = float(arch_pad_region.get('max_depth') or 0.0)
                if depth <= 0.0:
                    depth = float(profiles.get('pad_taper_width', PAD_TAPER_WIDTH_MM))
                if pad_core > 0.0:
                    field = arch_pad_region.get('depth_field')
                    dist_to_edge = (
                        _sample_pad_depth(field, x, y) if field
                        else _distance_to_polygon_edge(x, y, arch_pad_region)
                    )
                    # How strongly the rim step stands here, read off the nearest rim point.
                    # See _rim_step_weight: the weight lives on the rim, so it cannot leave a
                    # ghost outline in the pad's interior the way a separate fade line did.
                    # Exact distance to the rim, and where along it the closest point sits.
                    # The gridded depth field is too coarse for both jobs here: its 0.4mm
                    # cells are wider than the 0.27mm rim vertex spacing, so reading the step
                    # off it left a 0.088mm ripple of its own.
                    rim_dist, rim_edge, rim_t = _nearest_polygon_edge(x, y, arch_pad_region)
                    edge_here = pad_edge
                    rim_weight = arch_pad_region.get('rim_edge_weight')
                    if rim_weight is not None and pad_edge > 0.0:
                        following = (rim_edge + 1) % len(rim_weight)
                        weight_here = float(
                            rim_weight[rim_edge] * (1.0 - rim_t)
                            + rim_weight[following] * rim_t
                        )
                        # Confine the weight to a collar. An interior point takes its
                        # weight from the nearest rim point, and the cell of points
                        # nearest a rim CORNER is a wedge running deep inland - so the
                        # fade at T2 was carving a wedge-shaped 0.19mm hollow pointing
                        # inward from T2, measured 6mm wide and reaching x=152, right
                        # into the transverse arch's forward corner. The step only ever
                        # needs to be shaped at the edge itself; past the collar the
                        # weight is irrelevant because `ramp` has taken over.
                        collar = 1.0 - _smoothstep(rim_dist / PAD_RIM_WEIGHT_COLLAR_MM)
                        edge_here = pad_edge * (1.0 - (1.0 - weight_here) * collar)
                    ramp = 1.0 if depth <= 0.0 else min(1.0, max(0.0, dist_to_edge / depth))
                    pad_body = edge_here + (pad_core - edge_here) * ramp
                    # The step at the rim is a genuine discontinuity, and the triangulation
                    # puts vertices exactly ON the rim to resolve it. A point sitting exactly
                    # on a polygon edge has no well-defined inside/outside, so contains_point
                    # answered at random: of 1622 rim vertices only 38.7% came back inside, and
                    # the answer flipped 807 times between neighbours 0.27mm apart. That drew a
                    # 0.2mm sawtooth around the whole outline. Gating on the distance inside
                    # instead makes those vertices agree - they all land mid-step - so the edge
                    # reads as one clean line.
                    if PAD_RIM_GATE_MM > 0.0:
                        pad_body *= min(1.0, rim_dist / PAD_RIM_GATE_MM)
                    arch_height += pad_body

        # Blend calculation - unified distance-based approach
        transition_offset = WALL_DISH_OFFSET_MM

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

        # Unified blend from effective distance.
        # The wall falls off as (1 - t)**_wall_falloff_power(), not 1 - smoothstep(t).
        # Smoothstep is flat at BOTH ends, so the surface left the rim
        # horizontally and crested a millimetre or two inboard - the heel sat on
        # a convex lip instead of down in a dish. The power curve leaves the rim
        # at a real slope and flattens only where it meets the floor, which is
        # the same shape the bottom fillet uses.
        if effective_dist < transition_offset:
            blend = 0.0
        elif effective_dist < transition_distance_mm:
            raw_t = (effective_dist - transition_offset) / (transition_distance_mm - transition_offset)
            raw_t = min(1.0, max(0.0, raw_t))
            blend = 1.0 - (1.0 - raw_t) ** _wall_falloff_power(wall_dish_reach_mm)
        else:
            blend = 1.0

        # X direction additional blend (forward transition from heel cup)
        if x_transition_mm > 0 and dist_from_heel_mm < x_transition_mm:
            if dist_from_heel_mm < transition_offset:
                x_blend = 0.0
            else:
                raw_t = (dist_from_heel_mm - transition_offset) / (x_transition_mm - transition_offset)
                raw_t = min(1.0, max(0.0, raw_t))
                x_blend = 1.0 - (1.0 - raw_t) ** _wall_falloff_power(wall_dish_reach_mm)
            blend = min(blend, x_blend)

        # The wall stays a boundary feature (blend confines it to the outline), but the arch
        # is no longer faded out alongside it. The old crossfade replaced the arch with the
        # wall near the edge, so toward the toe - where the medial wall has already run out -
        # the strip along the medial edge collapsed to the base while the arch was still
        # 1mm+ a few millimetres further in. Smooth max keeps the taller of the two: the wall
        # still dominates where it is tall, and the arch now carries through to the edge
        # where the wall is gone.
        wall_term = wall_height * (1 - blend)
        height += (
            max(0.0, wall_term) ** 6.0 + max(0.0, arch_height) ** 6.0
        ) ** (1.0 / 6.0)
    
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
    signed_area = 0.5 * np.sum(
        outline[:, 0] * np.roll(outline[:, 1], -1)
        - np.roll(outline[:, 0], -1) * outline[:, 1]
    )
    orientation = 1.0 if signed_area >= 0.0 else -1.0
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
                    segment = p1 - p0
                    outward = orientation * np.array([segment[1], -segment[0]]) / seg_len
                    offset = target_spacing_mm * 2e-3 * 4.0 * frac * (1.0 - frac)
                    new_points.append(
                        p0 + frac * segment + offset * outward
                    )
    return np.array(new_points)


# =============================================================================
# ユーティリティ: 輪郭のリサンプル（点数合わせ）
# =============================================================================

def _resample_to_match(outline: np.ndarray, target_count: int) -> np.ndarray:
    """Resample a closed outline to have exactly target_count points."""
    n = len(outline)
    if n == target_count:
        return outline

    # Compute cumulative arc length
    diffs = np.diff(outline, axis=0)
    seg_lengths = np.sqrt(np.sum(diffs**2, axis=1))
    cum_length = np.concatenate([[0], np.cumsum(seg_lengths)])
    total_length = cum_length[-1]
    if total_length <= 0:
        return outline[:target_count] if n >= target_count else outline

    # Interpolate at evenly spaced arc lengths
    target_lengths = np.linspace(0, total_length, target_count, endpoint=False)
    from scipy.interpolate import interp1d
    fx = interp1d(cum_length, outline[:, 0], kind='linear', fill_value='extrapolate')
    fy = interp1d(cum_length, outline[:, 1], kind='linear', fill_value='extrapolate')
    return np.column_stack([fx(target_lengths), fy(target_lengths)])


def _resample_heel_region_paired(top_outline: np.ndarray, bottom_outline: np.ndarray,
                                   x_min: float, x_max: float,
                                   target_spacing_mm: float = 0.5,
                                   heel_end_ratio: float = 30.0,
                                   blend_ratio: float = 5.0):
    """Resample BOTH top and bottom outlines using the SAME insertion pattern.

    When N points are inserted between top[i] and top[i+1] in the heel region,
    the same N points are inserted between bottom[i] and bottom[i+1] at the
    same fractional positions. This preserves index correspondence: top[k] <-> bottom[k].
    """
    n = len(top_outline)
    assert len(bottom_outline) == n, "Top and bottom must have the same number of points"
    length = x_max - x_min
    if length <= 0:
        return top_outline, bottom_outline
    signed_area = 0.5 * np.sum(
        top_outline[:, 0] * np.roll(top_outline[:, 1], -1)
        - np.roll(top_outline[:, 0], -1) * top_outline[:, 1]
    )
    orientation = 1.0 if signed_area >= 0.0 else -1.0

    new_top = []
    new_bot = []
    for i in range(n):
        p0t = top_outline[i];    p1t = top_outline[(i + 1) % n]
        p0b = bottom_outline[i]; p1b = bottom_outline[(i + 1) % n]
        new_top.append(p0t)
        new_bot.append(p0b)
        # Use TOP outline segment to decide how many sub-points to insert
        seg_len = np.sqrt(np.sum((p1t - p0t) ** 2))
        mid_x = (p0t[0] + p1t[0]) / 2.0
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
                    top_segment = p1t - p0t
                    outward = (
                        orientation * np.array([top_segment[1], -top_segment[0]])
                        / seg_len
                    )
                    offset = target_spacing_mm * 2e-3 * 4.0 * frac * (1.0 - frac)
                    new_top.append(
                        p0t + frac * top_segment + offset * outward
                    )
                    new_bot.append(
                        p0b + frac * (p1b - p0b) + offset * outward
                    )
    return np.array(new_top), np.array(new_bot)


# =============================================================================
# 底面輪郭の自動計算
# =============================================================================

def _compute_auto_bottom_outline(
    outline: np.ndarray,
    arch_settings: dict,
    offset_mm: float = 5.0
) -> np.ndarray:
    """Compute bottom outline by offsetting medial side inward in arch region.

    Args:
        outline: Top outline points (N, 2) array
        arch_settings: Dict with medial_start, medial_end, medial_peak (percentages)
        offset_mm: Maximum inward offset in mm for medial side

    Returns:
        Bottom outline (N, 2) array with medial arch region pulled inward
    """
    if arch_settings is None:
        return outline.copy()

    f_y_min, f_y_max, x_min, x_max = get_outline_y_bounds(outline)
    foot_length = x_max - x_min
    if foot_length <= 0:
        return outline.copy()

    medial_start = arch_settings.get('medial_start', 15.0)
    medial_end = arch_settings.get('medial_end', 70.0)
    medial_peak = arch_settings.get('medial_peak', 43.0)

    bottom = outline.copy()

    for i in range(len(bottom)):
        x, y = bottom[i]
        x_ratio = (x - x_min) / foot_length * 100.0

        # Only affect medial side in arch region
        if x_ratio < medial_start or x_ratio > medial_end:
            continue

        # Check if this point is on the medial (low Y) side
        y_max_at_x = float(f_y_max(x))
        y_min_at_x = float(f_y_min(x))
        width_at_x = y_max_at_x - y_min_at_x
        if width_at_x <= 0:
            continue

        # Only affect points near the medial edge (lowest 20% of width)
        medial_threshold = y_min_at_x + width_at_x * 0.2
        if y > medial_threshold:
            continue

        # Smoothstep blend: 0 at start/end, 1 at peak
        if x_ratio <= medial_peak:
            t = (x_ratio - medial_start) / max(medial_peak - medial_start, 0.01)
        else:
            t = (medial_end - x_ratio) / max(medial_end - medial_peak, 0.01)
        t = max(0.0, min(1.0, t))
        # Smoothstep
        blend = t * t * (3.0 - 2.0 * t)

        # Offset inward (increase Y from the medial edge)
        bottom[i, 1] = y + offset_mm * blend

    return bottom


# =============================================================================
# メッシュ生成
# =============================================================================

def _sample_polyline_by_spacing(points: np.ndarray, spacing: float, closed: bool = False) -> np.ndarray:
    """Sample a polyline so no generated segment is longer than spacing."""
    points = np.asarray(points, dtype=float)
    if len(points) < 2:
        return points.copy()

    segment_count = len(points) if closed else len(points) - 1
    sampled = []
    for i in range(segment_count):
        start = points[i]
        end = points[(i + 1) % len(points)]
        length = float(np.linalg.norm(end - start))
        steps = max(1, int(np.ceil(length / spacing)))
        for step in range(steps):
            sampled.append(start + (end - start) * (step / steps))
    if not closed:
        sampled.append(points[-1])
    return np.asarray(sampled, dtype=float)


def _sample_function_by_spacing(
    function: callable,
    x_start: float,
    x_end: float,
    spacing: float
) -> np.ndarray:
    """Evaluate a Y(X) curve and then enforce spacing along its XY arc."""
    sample_count = max(2, int(np.ceil((x_end - x_start) / spacing)) + 1)
    sample_xs = np.linspace(x_start, x_end, sample_count)
    sample_ys = np.asarray(function(sample_xs), dtype=float)
    polyline = np.column_stack([sample_xs, sample_ys])
    polyline = polyline[np.isfinite(polyline).all(axis=1)]
    return _sample_polyline_by_spacing(polyline, spacing)


def _deduplicate_feature_points(
    points: np.ndarray,
    existing_points: np.ndarray,
    tolerance: float
) -> np.ndarray:
    """Keep feature points separated from existing points and from each other."""
    if len(points) == 0:
        return np.empty((0, 2), dtype=float)

    finite_points = np.asarray(points, dtype=float)
    finite_points = finite_points[np.isfinite(finite_points).all(axis=1)]
    if len(finite_points) == 0:
        return np.empty((0, 2), dtype=float)

    if len(existing_points) > 0:
        distances, _ = cKDTree(existing_points).query(finite_points, k=1)
        finite_points = finite_points[distances >= tolerance]

    accepted = []
    buckets = {}
    for point in finite_points:
        cell = tuple(np.floor(point / tolerance).astype(np.int64))
        is_duplicate = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for accepted_idx in buckets.get((cell[0] + dx, cell[1] + dy), ()):
                    if np.linalg.norm(point - accepted[accepted_idx]) < tolerance:
                        is_duplicate = True
                        break
                if is_duplicate:
                    break
            if is_duplicate:
                break
        if not is_duplicate:
            accepted_idx = len(accepted)
            accepted.append(point)
            buckets.setdefault(cell, []).append(accepted_idx)

    return np.asarray(accepted, dtype=float).reshape(-1, 2)


def _boundary_containment_radius(outline: np.ndarray) -> float:
    """Return a small outward tolerance based on boundary segment spacing."""
    segments = np.roll(outline, -1, axis=0) - outline
    lengths = np.linalg.norm(segments, axis=1)
    positive_lengths = lengths[lengths > 1e-9]
    if len(positive_lengths) == 0:
        return 1e-9
    return max(float(np.min(positive_lengths)) * 1e-4, 1e-9)


def _filter_points_away_from_boundary(
    points: np.ndarray,
    outline: np.ndarray,
    grid_spacing: float
) -> np.ndarray:
    """Drop lattice points that are too close to their nearest outline segment."""
    if len(points) == 0 or len(outline) < 2:
        return points

    segment_starts = outline
    segment_vectors = np.roll(outline, -1, axis=0) - outline
    segment_length_sq = np.einsum(
        'ij,ij->i', segment_vectors, segment_vectors
    )
    segment_lengths = np.sqrt(segment_length_sq)
    valid_segments = segment_length_sq > 1e-12
    if not np.any(valid_segments):
        return points

    segment_starts = segment_starts[valid_segments]
    segment_vectors = segment_vectors[valid_segments]
    segment_length_sq = segment_length_sq[valid_segments]
    segment_lengths = segment_lengths[valid_segments]

    keep = np.ones(len(points), dtype=bool)
    chunk_size = 1024
    for start in range(0, len(points), chunk_size):
        chunk = points[start:start + chunk_size]
        offsets = chunk[:, None, :] - segment_starts[None, :, :]
        projections = np.einsum(
            'csi,si->cs', offsets, segment_vectors
        ) / segment_length_sq[None, :]
        projections = np.clip(projections, 0.0, 1.0)
        residuals = offsets - projections[:, :, None] * segment_vectors[None, :, :]
        distance_sq = np.einsum('csi,csi->cs', residuals, residuals)
        nearest_segments = np.argmin(distance_sq, axis=1)
        nearest_distances = np.sqrt(
            distance_sq[np.arange(len(chunk)), nearest_segments]
        )
        local_clearance = np.minimum(
            segment_lengths[nearest_segments] * 0.25,
            float(grid_spacing) * 0.25
        )
        keep[start:start + len(chunk)] = nearest_distances >= local_clearance

    return points[keep]


def _remove_degenerate_mesh_faces(mesh: trimesh.Trimesh) -> int:
    """Remove repeated-index and zero-area faces after vertex merging."""
    if len(mesh.faces) == 0:
        return 0

    sorted_faces = np.sort(mesh.faces, axis=1)
    repeated_indices = np.any(
        sorted_faces[:, 1:] == sorted_faces[:, :-1], axis=1
    )
    areas = mesh.area_faces
    degenerate = repeated_indices | ~np.isfinite(areas) | (areas <= 1e-12)
    removed = int(np.count_nonzero(degenerate))
    if removed:
        mesh.update_faces(~degenerate)
        mesh.remove_unreferenced_vertices()
    return removed


def _inward_offset_ring(
    region: dict, distance: float, spacing: float = 0.0
) -> np.ndarray:
    """Boundary points pushed `distance` into the polygon, with the folds dropped.

    An inward offset folds over wherever the rim turns tighter than `distance` - this
    outline has a 167deg near-cusp at L0 and a 104deg corner at M7 - and a folded point
    lands on the wrong side or too close to the rim. Rather than trying to untangle it,
    every offset point is checked against the exact distance field and the strays are
    simply discarded; the grid covers those few gaps.
    """
    boundary = region['boundary_points']
    if len(boundary) < 3 or distance <= 0.0:
        return np.empty((0, 2), dtype=float)
    if spacing > 0.0:
        boundary = _sample_polyline_by_spacing(boundary, spacing, closed=True)
        if len(boundary) < 3:
            return np.empty((0, 2), dtype=float)
    tangents = np.roll(boundary, -1, axis=0) - np.roll(boundary, 1, axis=0)
    lengths = np.hypot(tangents[:, 0], tangents[:, 1])
    usable = lengths > 1e-9
    normals = np.zeros_like(tangents)
    normals[usable, 0] = -tangents[usable, 1] / lengths[usable]
    normals[usable, 1] = tangents[usable, 0] / lengths[usable]
    candidates = boundary + normals * distance
    # Orient by test rather than by winding: whichever sign puts more points inside wins.
    if np.count_nonzero(region['path'].contains_points(candidates)) < len(boundary) / 2:
        candidates = boundary - normals * distance
    keep = usable & region['path'].contains_points(candidates)
    if not np.any(keep):
        return np.empty((0, 2), dtype=float)
    exact = np.array([
        _distance_to_polygon_edge(px, py, region) for px, py in candidates[keep]
    ])
    survivors = candidates[keep][
        (exact > distance * 0.5) & (exact < distance * 1.5)
    ]
    return survivors


def _sample_triangulation_features(
    profiles: dict,
    outline: np.ndarray,
    outline_path: MplPath,
    grid_spacing: float
) -> Tuple[np.ndarray, float]:
    """Sample height-field boundaries as explicit triangulation vertices."""
    feature_spacing = float(grid_spacing) * 0.45
    if feature_spacing <= 0:
        return np.empty((0, 2), dtype=float), feature_spacing

    sampled_groups = []
    arch_pad_region = profiles.get('arch_pad_region')
    if arch_pad_region:
        sampled_groups.append(
            _sample_polyline_by_spacing(
                arch_pad_region['boundary_points'],
                feature_spacing,
                closed=True
            )
        )
        # A second ring PAD_RIM_GATE_MM inside the first. The pad's edge step is built
        # across exactly that distance, so these two rings bracket it: without the inner
        # one the step's upper edge lands on whichever grid points happen to fall nearby
        # and the outline reads as a wobble at the 0.6mm grid scale instead of a line.
        inner_ring = _inward_offset_ring(
            arch_pad_region, PAD_RIM_GATE_MM, feature_spacing
        )
        if len(inner_ring) >= 3:
            sampled_groups.append(inner_ring)

    custom_boundaries = profiles.get('custom_boundaries', {})
    for curve_name in ('medial', 'medialFlat', 'lateral', 'lateralFlat'):
        curve = custom_boundaries.get(curve_name)
        curve_xs = getattr(curve, 'x', None)
        if curve is None or curve_xs is None or len(curve_xs) < 2:
            continue
        x_start = float(np.min(curve_xs))
        x_end = float(np.max(curve_xs))
        sampled_groups.append(
            _sample_function_by_spacing(curve, x_start, x_end, feature_spacing)
        )

    for curve_name in ('transverse', 'transverseFlat'):
        polygon = custom_boundaries.get(curve_name)
        if isinstance(polygon, MplPath) and len(polygon.vertices) >= 3:
            sampled_groups.append(
                _sample_polyline_by_spacing(polygon.vertices, feature_spacing, closed=True)
            )

    if not sampled_groups:
        return np.empty((0, 2), dtype=float), feature_spacing

    feature_points = np.vstack(sampled_groups)
    feature_points = feature_points[np.isfinite(feature_points).all(axis=1)]
    feature_points = feature_points[outline_path.contains_points(feature_points)]
    feature_points = _filter_points_away_from_boundary(
        feature_points, outline, grid_spacing
    )
    dedup_tolerance = feature_spacing * 0.25
    feature_points = _deduplicate_feature_points(
        feature_points, outline, dedup_tolerance
    )
    return feature_points, feature_spacing


# --- Rounded bottom edge (heel fillet) -------------------------------------
# The flat bottom meets the side wall at a hard 90 degree corner. A quarter
# circle of radius r replaces the lowest r mm of that corner. The top surface is
# never touched.
#
# The fillet is a HEIGHT FIELD on the existing bottom polygon, not an offset
# polygon: a bottom vertex whose distance to the rim is d sits at
#     z(d) = r - sqrt(r^2 - (r - d)^2)   for d < r,   z = 0 beyond.
# Insetting the rim by r directly (offsetting each vertex along its inward
# normal) self-intersects wherever the local curvature radius is smaller than r
# — measured at 1 crossing for r=2mm and 21 for r=6mm on a real outline — which
# tore holes in the mesh. Distances are exact, so folds cannot occur.
BOTTOM_ROUNDING_RINGS = 6           # extra vertex rings that resolve the arc
BOTTOM_ROUNDING_WALL_FULL_MM = 1.5  # minimum wall height for a full-size fillet
BOTTOM_ROUNDING_MAX_FRACTION = 0.7  # cap r against the local rim height
# The fillet turns through the LOCAL WALL ANGLE, not always 90 degrees. Where
# the wall is vertical (heel, lateral, forefoot) that is the usual quarter
# circle. Where the bottom outline is pulled inside the top one for shoe
# clearance the wall leaves the floor at ~15 degrees, so the fillet is a 15
# degree arc: it just breaks the corner and the ramp continues. Forcing a
# quarter circle there produced a third stage - a steep bump, then the ramp -
# and it ate the thin medial shelf.
BOTTOM_ROUNDING_SMOOTH_MM = 14.0       # smooth the radius along the rim over this
                                       # arc length, so the heel-to-arch and
                                       # arch-to-flat transitions are gradual

# --- Side wall over a wide bottom-to-top offset --------------------------
# A straight loft across a wide offset runs almost parallel to the arch above
# it, which leaves the medial edge paper thin over its whole width. Instead the
# wall stays shallow for most of the run and then climbs steeply to the rim.
# The practitioner's drawn bottom outline is used exactly as drawn.
CLEARANCE_HOLD_TO_ARCH_START = False
CLEARANCE_ARCH_RAMP_PCT = 8.0

# --- Side wall between the two rims --------------------------------------
# One continuous curve, not a stack of stages:
#     z(q) = base_z + (rim_z - base_z) * q**p        q = 0 at the bottom rim
# It leaves the floor tangentially (p > 1), reaches the rim exactly, and stays
# low for most of the run so material is kept under the arch. p >= 3 gives a C2
# join with the flat bottom. Earlier this was a two-stage 15/60 degree profile
# plus a min() ceiling clamp with a running minimum; each of those is a C0
# feature and, landing at different x, they read as a dip/bulge along the edge.
WALL_POWER_MIN = 3.0
WALL_POWER_MAX = 14.0
WALL_POWER_DILATE_MM = 10.0   # widen the requirement before smoothing, so the
WALL_POWER_SMOOTH_MM = 6.0    # smoothed exponent still clears the top surface
# A curve tangent to the floor leaves at 0 degrees, so an angle-aware bottom
# fillet derived from it collapses the moment any clearance opens - the heel
# round vanished within ~2mm of offset and the corner read as square. Blend the
# ramp against a STRAIGHT wall instead: straight where the rims nearly coincide
# (so the quarter round survives), pure ramp once the clearance is open.
WALL_STRAIGHT_BLEND_MM = 12.0
# The fillet angle and the straight/ramp mix are driven by the bottom-to-top
# offset, which follows the drawn outline and can change by >1mm per mm of rim.
# Smooth the copy used for those ANGLES only - the loft still uses the drawn
# outline exactly - otherwise the inner edge of the flat bottom wanders in and
# out by several mm and reads as lumpy from below.
WALL_MIX_SMOOTH_MM = 10.0
# Never go to a PURE ramp. A power curve with p>1 is tangent to the floor, so
# the surface stayed within 0.2mm of it for 8.5mm past the drawn bottom rim -
# one print layer, so the slicer cannot tell it from the flat bottom and the
# outline drawn in step 2 does not appear on the part. Keeping a straight term
# gives the wall a real departure angle (0.7 -> about 8 degrees, 0.2mm reached
# 1.4mm out) while most of the smooth tail survives.
WALL_RAMP_MIX_MAX = 0.7

# Minimum angle, from horizontal, at which the underside leaves the flat bottom.
#
# The wall has to climb a fixed rise (the base thickness, ~6mm) across whatever
# horizontal run the drawn clearance gives it, so a single curve from rim to rim
# cannot be steep at the bottom: even a dead straight wall only makes atan(6/20) =
# 16.8deg where the clearance opens to 20mm, and the eased curve fell to 5.2deg
# there. That left the thick part of the medial edge running too far out and the
# insole would not seat in the shoe.
#
# So the wall is built in two stages again, as it was originally: a straight first
# stage leaving the floor at this angle, then the existing eased curve taking over
# to land on the top rim. They are combined with a smooth maximum, so the handover
# is a curve rather than a crease. Where the clearance is narrow the wall is
# already steeper than this and the first stage never binds.
WALL_FIRST_STAGE_DEG = 15.0
# Sharpness of the handover between the two stages. Higher is a tighter corner.
WALL_STAGE_BLEND_POWER = 6.0
# Most of the climb the straight first stage is allowed to claim. Where the drawn
# clearance is wide enough, a steep first stage would reach the top rim's height
# before the rim and the second stage would vanish, leaving a flat shelf along the
# edge. Capping the angle per rim point keeps a real second stage everywhere: the
# limit is atan(WALL_FIRST_STAGE_MAX_SHARE * rise / offset), which on this design
# binds below the 15deg slider maximum wherever the clearance is wide and the wall
# is low, and not at all where the clearance is narrow.
WALL_FIRST_STAGE_MAX_SHARE = 0.8

MIN_WALL_CLEARANCE_MM = 2.0
# ...ramped in over this depth from the rim. Applying the full clearance right
# up to the last layer (0.3mm from the rim on a narrow offset) leaves a
# clearance-tall vertical lip along the edge; ramping spreads that closure.
WALL_CLEARANCE_RAMP_MM = 1.5


def _distance_to_polygon_edges(
    points: np.ndarray, polygon: np.ndarray
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Exact distance from each point to a closed polygon's edges.

    Returns (distance, index of the closest edge's first vertex, position along
    that edge in [0, 1]). The position lets callers interpolate a per-vertex
    quantity along the edge instead of snapping to one endpoint, which would
    make the result jump wherever that quantity varies quickly.
    """
    starts = polygon
    vectors = np.roll(polygon, -1, axis=0) - polygon
    length_sq = np.einsum('ij,ij->i', vectors, vectors)
    length_sq = np.where(length_sq < 1e-12, 1.0, length_sq)
    best_d = np.empty(len(points))
    best_i = np.empty(len(points), dtype=int)
    best_t = np.empty(len(points))
    chunk = 2048
    for start in range(0, len(points), chunk):
        block = points[start:start + chunk]
        offsets = block[:, None, :] - starts[None, :, :]
        t = np.clip(
            np.einsum('ijk,jk->ij', offsets, vectors) / length_sq, 0.0, 1.0
        )
        residuals = offsets - t[:, :, None] * vectors[None, :, :]
        dist = np.sqrt(np.einsum('ijk,ijk->ij', residuals, residuals))
        nearest = np.argmin(dist, axis=1)
        rows = np.arange(len(block))
        best_d[start:start + chunk] = dist[rows, nearest]
        best_i[start:start + chunk] = nearest
        best_t[start:start + chunk] = t[rows, nearest]
    return best_d, best_i, best_t


def _polygon_inward_normals(polygon: np.ndarray) -> np.ndarray:
    """Unit normals pointing into the interior of a closed polygon (N, 2)."""
    tangents = np.roll(polygon, -1, axis=0) - np.roll(polygon, 1, axis=0)
    lengths = np.linalg.norm(tangents, axis=1)
    lengths[lengths < 1e-12] = 1.0
    tangents = tangents / lengths[:, None]
    normals = np.column_stack([-tangents[:, 1], tangents[:, 0]])
    x, y = polygon[:, 0], polygon[:, 1]
    signed_area2 = float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))
    if signed_area2 < 0.0:  # clockwise winding -> flip
        normals = -normals
    return normals


def _smoothstep(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _bottom_rounding_radii(
    wall_z: np.ndarray,
    base_thickness: float,
    radius_mm: float,
) -> np.ndarray:
    """Per-boundary fillet radius, faded in where there is a wall to round.

    How far the arc actually turns is set separately by the local wall angle,
    so a shallow ramp gets a shallow break rather than a quarter circle.
    """
    if radius_mm <= 0.0:
        return np.zeros(len(wall_z))
    # Fade in over a fixed wall height. Scaling this distance by the requested
    # radius makes the result non-monotonic in the radius (a larger slider value
    # rounds LESS where the wall is short); the rim-height cap below already
    # enforces "a fillet needs wall to sit against".
    wall_height = np.maximum(0.0, wall_z - base_thickness)
    radii = radius_mm * _smoothstep(wall_height / BOTTOM_ROUNDING_WALL_FULL_MM)
    return np.minimum(radii, wall_z * BOTTOM_ROUNDING_MAX_FRACTION)


def _smooth_along_rim(
    values: np.ndarray, polygon: np.ndarray, window_mm: float
) -> np.ndarray:
    """Circular moving average of a per-rim-vertex quantity over arc length.

    The radius is driven by the bottom-to-top offset, which can ramp from zero
    to 20mm within a few rim points where the shoe clearance starts. Without
    this the fillet collapses over that short run and the heel-to-arch and
    arch-to-flat transitions read as a crease.
    """
    n = len(values)
    if n < 5 or window_mm <= 0.0:
        return values
    spacing = float(np.mean(
        np.linalg.norm(np.roll(polygon, -1, axis=0) - polygon, axis=1)
    ))
    if spacing <= 1e-9:
        return values
    half = max(1, int(round(window_mm / spacing / 2.0)))
    width = min(2 * half + 1, n)
    kernel = np.hanning(width + 2)[1:-1]
    kernel = kernel / kernel.sum()
    padded = np.concatenate([values[-half:], values, values[:half]])
    smoothed = np.convolve(padded, kernel, mode='same')[half:half + n]
    # Never let smoothing push a radius above what the local rim can carry.
    return np.minimum(smoothed, values.max())


def _wall_ramp_mix(edge_offset: np.ndarray) -> np.ndarray:
    """0 = straight wall (rims coincide), WALL_RAMP_MIX_MAX = mostly ramp."""
    return WALL_RAMP_MIX_MAX * _smoothstep(edge_offset / WALL_STRAIGHT_BLEND_MM)


def _wall_z(
    fraction: float,
    base_z: np.ndarray,
    rim_z: np.ndarray,
    power: np.ndarray,
    ramp_mix: np.ndarray,
    edge_offset: np.ndarray = None,
    first_stage_deg: float = None,
) -> np.ndarray:
    """Side-wall height at `fraction` of the horizontal run from rim to rim.

    Two stages, combined with a smooth maximum: a straight climb out of the floor
    at first_stage_deg, and the eased curve that lands on the top rim. See
    WALL_FIRST_STAGE_DEG for why one curve cannot do both.
    """
    rise = np.maximum(0.0, rim_z - base_z)
    q = max(fraction, 0.0)
    eased = rise * ((1.0 - ramp_mix) * q + ramp_mix * np.power(q, power))
    if edge_offset is None:
        return base_z + eased
    angle = WALL_FIRST_STAGE_DEG if first_stage_deg is None else float(first_stage_deg)
    if angle <= 0.0:
        return base_z + eased
    # Per rim point, never let the straight stage claim more than its share of the
    # climb - otherwise it reaches full height before the rim and the second stage
    # disappears into a flat shelf. See WALL_FIRST_STAGE_MAX_SHARE.
    slope = np.minimum(
        math.tan(math.radians(angle)),
        WALL_FIRST_STAGE_MAX_SHARE * rise / np.maximum(edge_offset, 1e-9),
    )
    first = np.minimum(rise, slope * edge_offset * q)
    n = WALL_STAGE_BLEND_POWER
    blended = np.power(
        np.power(np.maximum(first, 0.0), n) + np.power(np.maximum(eased, 0.0), n),
        1.0 / n,
    )
    return base_z + np.minimum(rise, blended)


def _wall_start_angle(
    edge_offset: np.ndarray,
    base_z: np.ndarray,
    rim_z: np.ndarray,
    ramp_mix: np.ndarray,
) -> np.ndarray:
    """Angle (radians, from horizontal) the wall leaves the floor at.

    Only the straight term contributes: the ramp term is tangent to the floor.
    The bottom fillet turns through this angle, so it stays a quarter round
    where the rims coincide and fades to a light break as clearance opens.
    """
    rise = np.maximum(0.0, rim_z - base_z)
    straight = rise * (1.0 - ramp_mix)
    eased_angle = np.arctan2(straight, np.maximum(edge_offset, 1e-9))
    # The straight first stage sets a floor on the departure angle wherever the
    # eased curve would leave more gently - subject to the same per-point cap the
    # loft applies, so the fillet is told the angle the wall actually leaves at.
    first_slope = np.minimum(
        math.tan(math.radians(max(0.0, WALL_FIRST_STAGE_DEG))),
        WALL_FIRST_STAGE_MAX_SHARE * rise / np.maximum(edge_offset, 1e-9),
    )
    return np.maximum(eased_angle, np.arctan(first_slope))


def _wall_power_from_ceiling(
    edge_offset: np.ndarray,
    base_z: np.ndarray,
    rim_z: np.ndarray,
    ceilings: List[np.ndarray],
    fractions: List[float],
    polygon: np.ndarray,
    ramp_mix: np.ndarray,
) -> np.ndarray:
    """Smallest exponent per rim index that keeps the wall under the ceiling.

    q**p <= (ceiling - base) / (rim - base)  =>  p >= log(ratio) / log(q).
    Taken as a smooth majorant along the rim (dilate, then smooth) instead of
    clamping z afterwards, because a min() on z is what put creases in the
    surface in the first place.
    """
    required = np.full(len(rim_z), WALL_POWER_MIN)
    rise = np.maximum(1e-6, rim_z - base_z)
    for ceiling, q in zip(ceilings, fractions):
        if not (0.0 < q < 1.0):
            continue
        ratio = np.clip((ceiling - base_z) / rise, 1e-6, 1.0)
        # z/rise = (1-w)q + w q**p  <=  ratio
        headroom = ratio - (1.0 - ramp_mix) * q
        with np.errstate(divide='ignore', invalid='ignore'):
            target = np.clip(headroom / np.maximum(ramp_mix, 1e-6), 1e-6, 1.0)
            need = np.log(target) / math.log(q)
        need = np.where(headroom > 0, need, WALL_POWER_MAX)
        required = np.maximum(required, np.nan_to_num(need, nan=WALL_POWER_MIN))
    required = np.clip(required, WALL_POWER_MIN, WALL_POWER_MAX)

    spacing = float(np.mean(
        np.linalg.norm(np.roll(polygon, -1, axis=0) - polygon, axis=1)
    ))
    if spacing > 1e-9 and len(required) > 8:
        half = max(1, int(round(WALL_POWER_DILATE_MM / spacing / 2.0)))
        padded = np.concatenate([required[-half:], required, required[:half]])
        dilated = np.array([
            padded[i:i + 2 * half + 1].max() for i in range(len(required))
        ])
        required = _smooth_along_rim(dilated, polygon, WALL_POWER_SMOOTH_MM)
    return np.clip(required, WALL_POWER_MIN, WALL_POWER_MAX)


def generate_insole_mesh(
    outline: np.ndarray,
    base_thickness: float = 3.0,
    arch_scale: float = 1.0,
    wall_offset_mm: float = 0.0,
    heel_cup_scale: float = 1.0,
    grid_spacing: float = 0.6,
    arch_settings: dict = None,
    is_right_foot: bool = False,
    landmark_settings: dict = None,
    wall_params: dict = None,
    heel_cup_height: float = None,
    arch_curves: dict = None,
    bottom_outline: np.ndarray = None,
    progress_callback: callable = None,
    pad_params: dict = None,
    bottom_rounding_mm: float = 0.0,
    wall_dish_reach_mm: float = None,
    medial_band_drop_bias: float = None,
    lateral_band_drop_bias: float = None,
    wall_first_stage_deg: float = None
) -> trimesh.Trimesh:
    import time as _t
    _t_start = _t.time()
    def _log_t(msg):
        print(f"[TIMING +{_t.time()-_t_start:.2f}s] {msg}", flush=True)
    def _progress(msg, pct):
        if progress_callback:
            try: progress_callback(msg, pct)
            except: pass
    _log_t(f"=== MasaCAD v4.3 (Frontend) === outline_pts={len(outline)}")
    _progress("Preparing outline...", 5)
    if heel_cup_height: heel_cup_scale = heel_cup_height / HEEL_CUP_PROFILE.get(0.0, 1.8)

    if np.allclose(outline[0], outline[-1]): outline = outline[:-1]

    # Process bottom outline if provided — BEFORE heel resampling so we can apply
    # the same insertion pattern to both outlines simultaneously.
    has_bottom_outline = bottom_outline is not None and len(bottom_outline) > 0
    if has_bottom_outline:
        if np.allclose(bottom_outline[0], bottom_outline[-1]):
            bottom_outline = bottom_outline[:-1]
        # Match point counts first (both should already be 450 from frontend densification)
        if len(bottom_outline) != len(outline):
            bottom_outline = _resample_to_match(bottom_outline, len(outline))
        # Apply heel densification to BOTH outlines simultaneously with the SAME insertion pattern.
        # This guarantees top[i] and bottom[i] always correspond to the same position on the insole.
        x_min_pre = outline[:, 0].min()
        x_max_pre = outline[:, 0].max()
        outline, bottom_outline = _resample_heel_region_paired(
            outline, bottom_outline, x_min_pre, x_max_pre
        )
        # Snap near-identical points to top to create clean vertical walls
        SNAP_THRESHOLD = 1.0  # mm
        diffs = np.sqrt(np.sum((bottom_outline - outline) ** 2, axis=1))
        snap_mask = diffs < SNAP_THRESHOLD
        bottom_outline[snap_mask] = outline[snap_mask]
        n_snapped = int(snap_mask.sum())
        print(f"[INFO] Bottom outline: {len(bottom_outline)} points (paired heel resample), {n_snapped} snapped to top")

        # Hold the clearance closed until the arch starts (see the note on
        # CLEARANCE_HOLD_TO_ARCH_START).
        arch_start_pct = None
        if landmark_settings:
            arch_start_pct = landmark_settings.get('arch_start')
        if (CLEARANCE_HOLD_TO_ARCH_START and arch_start_pct is not None
                and CLEARANCE_ARCH_RAMP_PCT > 0.0):
            span = outline[:, 0].max() - outline[:, 0].min()
            if span > 0:
                x_pct = (outline[:, 0] - outline[:, 0].min()) / span * 100.0
                open_frac = _smoothstep(
                    (x_pct - float(arch_start_pct)) / CLEARANCE_ARCH_RAMP_PCT
                )
                held = int(np.count_nonzero(open_frac < 0.999))
                bottom_outline = (
                    outline + (bottom_outline - outline) * open_frac[:, None]
                )
                print(f"[INFO] Clearance held to arch_start "
                      f"{float(arch_start_pct):.1f}% over "
                      f"{CLEARANCE_ARCH_RAMP_PCT:.0f}% of length "
                      f"({held}/{len(bottom_outline)} rim pts damped)")
    else:
        outline = _resample_outline_heel_region(
            outline, outline[:, 0].min(), outline[:, 0].max()
        )

    n_boundary = len(outline)
    _log_t(f"after heel resample: outline={n_boundary} pts")
    _progress("Building profiles...", 10)
    profiles = create_profile_interpolators(
        arch_settings, landmark_settings, wall_params, arch_curves,
        outline_x_range=(outline[:, 0].min(), outline[:, 0].max()),
        pad_params=pad_params,
    )
    _log_t("profiles built")
    f_y_min, f_y_max, x_min, x_max = get_outline_y_bounds(outline)
    _log_t("y bounds built")

    # Build the prepared closed polygon for the arch pad floor and feature line.
    custom_boundaries = profiles.get('custom_boundaries', {})
    raw_bridges = profiles.get('raw_bridges', {})
    arch_pad_region = _build_arch_pad_region(
        custom_boundaries, f_y_min, f_y_max, raw_bridges=raw_bridges
    )
    if arch_pad_region:
        profiles['arch_pad_region'] = arch_pad_region
    _log_t("arch pad region built")

    # Grid (use top outline = wider)
    outline_path = MplPath(outline)
    x_vals = np.arange(x_min + grid_spacing, x_max, grid_spacing)
    y_global_min, y_global_max = outline[:,1].min(), outline[:,1].max()
    y_vals = np.arange(y_global_min + grid_spacing, y_global_max, grid_spacing)
    interior_points = np.empty((0, 2))
    if len(x_vals)>0 and len(y_vals)>0:
        xx, yy = np.meshgrid(x_vals, y_vals)
        cands = np.column_stack([xx.ravel(), yy.ravel()])
        interior_points = cands[outline_path.contains_points(cands)]
        interior_points = _filter_points_away_from_boundary(
            interior_points, outline, grid_spacing
        )
    _log_t(f"grid built: {len(interior_points)} interior pts")

    feature_points, feature_spacing = _sample_triangulation_features(
        profiles, outline, outline_path, grid_spacing
    )
    if len(feature_points) > 0 and len(interior_points) > 0:
        dedup_tolerance = feature_spacing * 0.25
        distances, _ = cKDTree(feature_points).query(interior_points, k=1)
        interior_points = interior_points[distances >= dedup_tolerance]
    _log_t(
        f"feature curves built: {len(feature_points)} pts "
        f"(spacing={feature_spacing:.3f}mm)"
    )

    point_groups = [outline]
    if len(feature_points) > 0:
        point_groups.append(feature_points)
    if len(interior_points) > 0:
        point_groups.append(interior_points)
    all_2d = np.vstack(point_groups)
    n_total = len(all_2d)
    _log_t(f"all_2d total: {n_total} pts")
    _progress("Calculating heights...", 20)
    is_boundary_flags = np.zeros(n_total, dtype=bool)
    is_boundary_flags[:n_boundary] = True

    top_vertices = []
    _progress_chunk = max(1, n_total // 20)  # 20 updates total during the loop
    for i, pt in enumerate(all_2d):
        x, y = pt
        z = calculate_height(
            x, y, x_min, x_max, float(f_y_min(x)), float(f_y_max(x)),
            profiles, base_thickness, is_boundary=is_boundary_flags[i],
            arch_scale=arch_scale, wall_offset_mm=wall_offset_mm, heel_cup_scale=heel_cup_scale,
            is_right_foot=is_right_foot, outline=outline,
            wall_dish_reach_mm=wall_dish_reach_mm,
            medial_band_drop_bias=medial_band_drop_bias,
            lateral_band_drop_bias=lateral_band_drop_bias
        )
        top_vertices.append([x, y, z])
        if (i + 1) % _progress_chunk == 0:
            # Map height-calc range to 20-70%
            pct = 20 + int(50 * (i + 1) / n_total)
            _progress(f"Calculating heights {i+1}/{n_total}...", pct)
            _log_t(f"calculate_height progress: {i+1}/{n_total}")
    _log_t(f"calculate_height done: {n_total} pts")
    _progress("Building mesh topology...", 75)
    top_vertices = np.array(top_vertices)
    # Dynamic Z-smoothing window based on resampled point density
    _avg_spacing = np.mean(np.sqrt(np.sum(np.diff(outline, axis=0)**2, axis=1)))
    _smooth_window = max(7, int(10.0 / _avg_spacing))
    if _smooth_window % 2 == 0:
        _smooth_window += 1
    top_vertices = _smooth_boundary_z(top_vertices, n_boundary, x_min, x_max, window=_smooth_window)
    _log_t("smoothed boundary z")

    if not has_bottom_outline and bottom_rounding_mm > 0.0:
        # A rounded bottom edge needs an independent bottom ring, so route through
        # the separate-outline path with a bottom outline identical to the top.
        # Done here (after all resampling) so the top surface stays untouched.
        bottom_outline = outline.copy()
        has_bottom_outline = True

    if not has_bottom_outline:
        # Original behavior: bottom uses same XY as top, Z=0
        bottom_vertices = np.column_stack([all_2d, np.zeros(n_total)])

        tri = Delaunay(all_2d)
        _log_t(f"delaunay done: {len(tri.simplices)} faces")
        # Vectorized triangle centroid containment test (C-level via MplPath)
        centroids = all_2d[tri.simplices].mean(axis=1)
        face_mask = outline_path.contains_points(
            centroids, radius=_boundary_containment_radius(outline)
        )
        top_faces = tri.simplices[face_mask]
        _log_t(f"face filter (vectorized) done: {len(top_faces)} valid faces")

        bottom_faces = top_faces[:, [0, 2, 1]] + n_total
        side_faces = []
        for i in range(n_boundary):
            ni = (i + 1) % n_boundary
            side_faces.append([i, i+n_total, ni])
            side_faces.append([ni, i+n_total, ni+n_total])
        side_faces = np.array(side_faces)

        all_verts = np.vstack([top_vertices, bottom_vertices])
        all_faces = np.vstack([top_faces, bottom_faces, side_faces])
    else:
        # Separate bottom outline: bottom boundary uses bottom_outline XY, Z=0
        # Feature points describe top-surface ridges, so the independent flat
        # bottom intentionally keeps only its uniform interior grid.
        # Rounded bottom edge. The rim polygon is left exactly where it is; the
        # fillet is a height field over the bottom face (see the notes on
        # BOTTOM_ROUNDING_RINGS). The rim itself rises to z = r, which is where
        # the side loft now starts.
        wall_z_boundary = top_vertices[:n_boundary, 2]
        edge_offset = np.linalg.norm(outline - bottom_outline, axis=1)
        fillet_radii = _bottom_rounding_radii(
            wall_z_boundary, base_thickness, bottom_rounding_mm
        )
        fillet_radii = _smooth_along_rim(
            fillet_radii, bottom_outline, BOTTOM_ROUNDING_SMOOTH_MM
        )
        # Re-cap against a SMOOTHED rim height. Capping against the raw rim
        # after smoothing puts the kink straight back in, which shows up as the
        # inner edge of the flat bottom wandering.
        fillet_radii = np.minimum(
            fillet_radii,
            _smooth_along_rim(
                wall_z_boundary, bottom_outline, BOTTOM_ROUNDING_SMOOTH_MM
            ) * BOTTOM_ROUNDING_MAX_FRACTION
        )
        # The arc turns through the local wall angle, so it lands tangent to the
        # wall instead of always standing the rim up vertically. The exponent is
        # refined below once the ceiling is known; the start angle barely moves
        # with it, so a first pass at WALL_POWER_MIN is enough here.
        wall_power = np.full(n_boundary, WALL_POWER_MIN)
        angle_offset = _smooth_along_rim(
            edge_offset, bottom_outline, WALL_MIX_SMOOTH_MM
        )
        ramp_mix = _wall_ramp_mix(angle_offset)
        fillet_turn = _wall_start_angle(
            angle_offset, np.zeros(n_boundary), wall_z_boundary, ramp_mix
        )
        fillet_run = fillet_radii * np.sin(fillet_turn)     # horizontal reach
        fillet_lift = fillet_radii * (1.0 - np.cos(fillet_turn))  # rise at the rim
        has_fillet = bool(np.any(fillet_run > 1e-6))
        wall_base_z = fillet_lift if has_fillet else np.zeros(n_boundary)

        bottom_outline_path = MplPath(bottom_outline)
        bottom_interior_mask = np.ones(len(interior_points), dtype=bool)
        if len(interior_points) > 0:
            bottom_interior_mask = bottom_outline_path.contains_points(interior_points)
        bottom_interior = interior_points[bottom_interior_mask] if len(interior_points) > 0 else np.empty((0, 2))
        bottom_interior = _filter_points_away_from_boundary(
            bottom_interior, bottom_outline, grid_spacing
        )

        if has_fillet:
            # Extra vertex rings so the arc is resolved near the rim, where the
            # uniform grid is too coarse and the surface is nearly vertical.
            # These are ordinary interior points: a ring that folds on itself in
            # a tight corner just produces duplicates, which are deduplicated.
            inward_normals = _polygon_inward_normals(bottom_outline)
            ring_candidates = []
            for ring in range(BOTTOM_ROUNDING_RINGS):
                theta = fillet_turn * (ring / BOTTOM_ROUNDING_RINGS)
                depth = fillet_run - fillet_radii * np.sin(theta)
                ring_candidates.append(bottom_outline + inward_normals * depth[:, None])
            ring_points = np.vstack(ring_candidates)
            ring_points = ring_points[
                bottom_outline_path.contains_points(ring_points)
            ]
            if len(ring_points) > 0:
                keep_dist, _, _ = _distance_to_polygon_edges(
                    ring_points, bottom_outline
                )
                ring_points = ring_points[keep_dist > 0.05]
            if len(ring_points) > 0:
                # Deduplicate against each other and against the uniform grid.
                merge_tol = max(0.15, grid_spacing * 0.35)
                order = cKDTree(ring_points).query_pairs(merge_tol)
                drop = {max(a, b) for a, b in order}
                ring_points = ring_points[
                    [i for i in range(len(ring_points)) if i not in drop]
                ]
            if len(ring_points) > 0 and len(bottom_interior) > 0:
                grid_dist, _ = cKDTree(bottom_interior).query(ring_points, k=1)
                ring_points = ring_points[grid_dist > max(0.15, grid_spacing * 0.35)]
            if len(ring_points) > 0:
                bottom_interior = (
                    np.vstack([bottom_interior, ring_points])
                    if len(bottom_interior) > 0 else ring_points
                )
            _log_t(
                f"bottom fillet: r_max={fillet_radii.max():.3f}mm on "
                f"{int(np.count_nonzero(fillet_radii > 1e-6))}/{n_boundary} rim "
                f"pts, +{len(ring_points)} arc pts"
            )

        n_bottom_boundary = len(bottom_outline)
        bottom_all_2d = np.vstack([bottom_outline, bottom_interior]) if len(bottom_interior) > 0 else bottom_outline
        n_bottom_total = len(bottom_all_2d)

        bottom_z = np.zeros(n_bottom_total)
        if has_fillet:
            # Only points within r_max of the rim can land inside the arc, and
            # the exact edge distance is O(points x edges). Prefilter with a
            # KD-tree on the rim: the nearest-vertex distance is an upper bound
            # on the true edge distance, so anything beyond r_max + the longest
            # edge is certainly flat bottom.
            rim_span = float(np.max(np.linalg.norm(
                np.roll(bottom_outline, -1, axis=0) - bottom_outline, axis=1
            )))
            cutoff = float(fillet_run.max()) + rim_span + 1e-6
            vertex_dist, _ = cKDTree(bottom_outline).query(bottom_all_2d, k=1)
            near = vertex_dist <= cutoff
            depth = np.full(n_bottom_total, np.inf)
            nearest_edge = np.zeros(n_bottom_total, dtype=int)
            edge_pos = np.zeros(n_bottom_total)
            if np.any(near):
                d_n, i_n, t_n = _distance_to_polygon_edges(
                    bottom_all_2d[near], bottom_outline
                )
                depth[near] = d_n
                nearest_edge[near] = i_n
                edge_pos[near] = t_n
            # Interpolate the radius along the nearest edge. Snapping to the
            # edge's first vertex makes r_local jump wherever the radius fades,
            # and the jump approaches the radius difference as depth -> 0.
            next_edge = (nearest_edge + 1) % n_bottom_boundary
            def _along_edge(values):
                return (values[nearest_edge] * (1.0 - edge_pos)
                        + values[next_edge] * edge_pos)

            r_local = _along_edge(fillet_radii)
            run_local = _along_edge(fillet_run)
            inside_arc = (depth < run_local) & (run_local > 1e-6)
            # Circle of radius r tangent to the floor at depth `run`, turning
            # through the wall angle so it meets the wall tangentially.
            r_arc = r_local[inside_arc]
            horiz = run_local[inside_arc] - depth[inside_arc]
            bottom_z[inside_arc] = r_arc - np.sqrt(
                np.maximum(0.0, r_arc * r_arc - horiz * horiz)
            )
            # The rim vertices sit at the top of the arc.
            bottom_z[:n_bottom_boundary] = fillet_lift
        bottom_vertices = np.column_stack([bottom_all_2d, bottom_z])

        # Top faces (Delaunay on top outline) - vectorized centroid filter
        tri = Delaunay(all_2d)
        _log_t(f"top delaunay: {len(tri.simplices)} faces")
        top_centroids = all_2d[tri.simplices].mean(axis=1)
        top_face_mask = outline_path.contains_points(
            top_centroids, radius=_boundary_containment_radius(outline)
        )
        top_boundary_faces = np.all(tri.simplices < n_boundary, axis=1)
        top_face_mask &= (
            ~top_boundary_faces
            | outline_path.contains_points(top_centroids)
        )
        top_faces = tri.simplices[top_face_mask]
        _log_t(f"top face filter done: {len(top_faces)} valid faces")

        # Bottom faces (Delaunay on bottom outline) - vectorized centroid filter
        tri_bottom = Delaunay(bottom_all_2d)
        _log_t(f"bottom delaunay: {len(tri_bottom.simplices)} faces")
        bottom_centroids = bottom_all_2d[tri_bottom.simplices].mean(axis=1)
        bottom_face_mask = bottom_outline_path.contains_points(
            bottom_centroids,
            radius=_boundary_containment_radius(bottom_outline)
        )
        bottom_boundary_faces = np.all(
            tri_bottom.simplices < n_bottom_boundary, axis=1
        )
        bottom_face_mask &= (
            ~bottom_boundary_faces
            | bottom_outline_path.contains_points(bottom_centroids)
        )
        bottom_valid = tri_bottom.simplices[bottom_face_mask]
        bottom_faces = bottom_valid[:, [0, 2, 1]] + n_total  # offset by top vertex count
        _log_t(f"bottom face filter done: {len(bottom_faces)} valid faces")

        # Subdivide sloped side walls so large outline offsets remain smooth
        # when intersected by horizontal print layers.
        max_side_offset = float(np.max(edge_offset))
        side_layer_count = max(
            1,
            min(24, int(np.ceil(max_side_offset / 1.0)))
        )
        fractions = [layer / side_layer_count
                     for layer in range(1, side_layer_count)]
        layer_xys = [
            bottom_outline + f * (outline - bottom_outline) for f in fractions
        ]

        if layer_xys and np.any(edge_offset >= 0.5):
            # Ceiling per layer, from the FILTERED top triangulation (the raw
            # Delaunay includes simplices later discarded outside a concave
            # outline).
            ceiling_at = None
            try:
                from matplotlib.tri import (
                    Triangulation as _Tri, LinearTriInterpolator as _TriInterp
                )
                _tri_top = _Tri(all_2d[:, 0], all_2d[:, 1], triangles=top_faces)
                ceiling_at = _TriInterp(_tri_top, top_vertices[:, 2])
            except Exception as exc:
                _log_t(f"ceiling interpolator unavailable: {exc}")
            ceilings = []
            for f, layer_xy in zip(fractions, layer_xys):
                if ceiling_at is None:
                    ceilings.append(np.full(n_boundary, np.inf))
                    continue
                sampled = np.asarray(
                    ceiling_at(layer_xy[:, 0], layer_xy[:, 1]).filled(np.nan)
                )
                ceiling = np.where(np.isfinite(sampled), sampled, np.inf)
                depth = (1.0 - f) * edge_offset
                clearance = MIN_WALL_CLEARANCE_MM * _smoothstep(
                    depth / WALL_CLEARANCE_RAMP_MM
                )
                ceilings.append(ceiling - clearance)
            wall_power = _wall_power_from_ceiling(
                edge_offset, wall_base_z, wall_z_boundary,
                ceilings, fractions, bottom_outline, ramp_mix
            )
            _log_t(
                f"wall exponent: {wall_power.min():.2f}..{wall_power.max():.2f}"
            )

        layer_zs = [
            _wall_z(f, wall_base_z, wall_z_boundary, wall_power, ramp_mix,
                    edge_offset=edge_offset, first_stage_deg=wall_first_stage_deg)
            for f in fractions
        ]

        side_mid_vertices = [
            np.column_stack([xy, z]) for xy, z in zip(layer_xys, layer_zs)
        ]
        if side_mid_vertices:
            side_mid_vertices = np.vstack(side_mid_vertices)
        else:
            side_mid_vertices = np.empty((0, 3))

        # The bottom rim vertices already carry z = r, so the side loft starts
        # there; the fillet itself is part of the bottom face.
        side_mid_offset = n_total + n_bottom_total

        def side_vertex_index(layer, boundary_index):
            if layer == 0:
                return n_total + boundary_index
            if layer == side_layer_count:
                return boundary_index
            return (
                side_mid_offset
                + (layer - 1) * n_boundary
                + boundary_index
            )

        side_faces_list = []
        for layer in range(side_layer_count):
            for i in range(n_boundary):
                ni = (i + 1) % n_boundary
                lower_i = side_vertex_index(layer, i)
                lower_ni = side_vertex_index(layer, ni)
                upper_i = side_vertex_index(layer + 1, i)
                upper_ni = side_vertex_index(layer + 1, ni)
                side_faces_list.append([upper_i, lower_i, upper_ni])
                side_faces_list.append([upper_ni, lower_i, lower_ni])

        side_faces = np.array(side_faces_list)

        # Combine all vertices and faces
        all_verts = np.vstack([
            top_vertices,
            bottom_vertices,
            side_mid_vertices
        ])
        all_faces = np.vstack([top_faces, bottom_faces, side_faces])

    mesh = trimesh.Trimesh(vertices=all_verts, faces=all_faces)
    _log_t(f"trimesh created: {len(all_verts)} verts, {len(all_faces)} faces")
    _progress("Finalizing mesh...", 85)

    mesh.merge_vertices()
    _log_t("merge_vertices done")
    removed_degenerate = _remove_degenerate_mesh_faces(mesh)
    edge_counts = np.bincount(
        mesh.edges_unique_inverse, minlength=len(mesh.edges_unique)
    )
    holes_before_repair = int(np.count_nonzero(edge_counts == 1))
    non_manifold_before_repair = int(np.count_nonzero(edge_counts > 2))
    _log_t(
        f"topology cleanup: removed_degenerate={removed_degenerate}, "
        f"boundary_edges={holes_before_repair}, "
        f"non_manifold_edges={non_manifold_before_repair}"
    )
    if holes_before_repair:
        mesh.fill_holes()
        _log_t("fill_holes safety net done")
    mesh.fix_normals()
    _log_t("fix_normals done")
    _progress("Smoothing surface...", 90)

    # Smoothing: use adjacency-based approach (O(n) instead of O(n*faces))
    try:
        interior_set = set(range(n_boundary, n_total))
        if interior_set:
            from collections import defaultdict
            v2v = defaultdict(set)
            for face in mesh.faces:
                for a, b in ((face[0], face[1]), (face[1], face[2]), (face[2], face[0])):
                    v2v[a].add(b)
                    v2v[b].add(a)

            v = mesh.vertices.copy()
            new_z = v[:, 2].copy()
            for idx in interior_set:
                neighbors = [n for n in v2v[idx] if n < n_total]
                if neighbors:
                    new_z[idx] = 0.7 * v[idx, 2] + 0.3 * np.mean(v[neighbors, 2])
            v[:, 2] = new_z
            mesh.vertices = v
    except: pass

    return mesh


def generate_insole_from_outline(
    outline_points: Optional[List[Dict[str, float]]] = None,
    flip_x: bool = False,
    flip_y: bool = False,
    base_thickness: float = 3.0,
    arch_scale: float = 1.0,
    wall_height_offset_mm: float = 0.0,
    heel_cup_scale: float = 1.0,
    grid_spacing: float = 0.6,
    arch_settings: dict = None,
    landmark_settings: dict = None,
    wall_params: dict = None,
    heel_cup_height: float = None,
    arch_curves: dict = None,
    progress_callback: callable = None,
    bottom_outline_points: Optional[List[Dict[str, float]]] = None,
    pad_params: dict = None,
    bottom_rounding_mm: float = 0.0,
    wall_dish_reach_mm: float = None,
    medial_band_drop_bias: float = None,
    lateral_band_drop_bias: float = None,
    wall_first_stage_deg: float = None
) -> trimesh.Trimesh:
    log_debug("Frontend Gen Called")

    if outline_points:
        outline_np = np.array([[p['x'], p['y']] for p in outline_points])
        if flip_x: outline_np[:, 0] = outline_np[:, 0].max() - outline_np[:, 0]
        if flip_y: outline_np[:, 1] = outline_np[:, 1].max() - outline_np[:, 1]
        # Save offset before normalization (needed for bottom outline alignment)
        top_x_offset = outline_np[:, 0].min()
        top_y_offset = outline_np[:, 1].min()
        outline_np[:, 0] -= top_x_offset
        outline_np[:, 1] -= top_y_offset
    else:
        raise ValueError("No outline provided")

    # Process bottom outline points — use TOP outline's offset to keep alignment
    bottom_outline_np = None
    if bottom_outline_points:
        bottom_outline_np = np.array([[p['x'], p['y']] for p in bottom_outline_points])
        if flip_x: bottom_outline_np[:, 0] = bottom_outline_np[:, 0].max() - bottom_outline_np[:, 0]
        if flip_y: bottom_outline_np[:, 1] = bottom_outline_np[:, 1].max() - bottom_outline_np[:, 1]
        # Use the SAME offset as the top outline to maintain alignment
        bottom_outline_np[:, 0] -= top_x_offset
        bottom_outline_np[:, 1] -= top_y_offset
        print(f"[INFO] Bottom outline provided: {len(bottom_outline_np)} points")

    # Use the SAME offset as the top outline to keep drawn arch curves aligned
    shifted_arch_curves = None
    if arch_curves is not None:
        shifted_arch_curves = {}
        for name, value in arch_curves.items():
            if not isinstance(value, list):
                shifted_arch_curves[name] = value
                continue

            shifted_points = []
            valid_curve = True
            for point in value:
                if isinstance(point, dict) and 'x' in point and 'y' in point:
                    shifted_point = point.copy()
                    shifted_point['x'] = point['x'] - top_x_offset
                    shifted_point['y'] = point['y'] - top_y_offset
                elif isinstance(point, (list, tuple)) and len(point) >= 2:
                    shifted_point = list(point)
                    shifted_point[0] = point[0] - top_x_offset
                    shifted_point[1] = point[1] - top_y_offset
                    if isinstance(point, tuple):
                        shifted_point = tuple(shifted_point)
                else:
                    valid_curve = False
                    break
                shifted_points.append(shifted_point)
            shifted_arch_curves[name] = shifted_points if valid_curve else value

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
        arch_curves=shifted_arch_curves,
        bottom_outline=bottom_outline_np,
        progress_callback=progress_callback,
        pad_params=pad_params,
        bottom_rounding_mm=bottom_rounding_mm,
        wall_dish_reach_mm=wall_dish_reach_mm,
        medial_band_drop_bias=medial_band_drop_bias,
        lateral_band_drop_bias=lateral_band_drop_bias,
        wall_first_stage_deg=wall_first_stage_deg
    )

def export_mesh(mesh: trimesh.Trimesh, output_path: Path):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.suffix.lower() == '.stl': mesh.export(output_path, file_type='stl')
    elif output_path.suffix.lower() == '.glb': mesh.export(output_path, file_type='glb')
    else: mesh.export(output_path)
