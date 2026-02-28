"""
MasaCAD Core - Landmarks Module
骨レベルのガイドライン定義

各関節（骨）の位置にY軸と平行なラインを引くための設定
座標系: X=0% (踵後端) → X=100% (つま先)
# Force update
"""

from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass
import numpy as np


@dataclass
class BoneLandmark:
    """骨ランドマークの定義"""
    id: str                     # 識別子
    name_ja: str               # 日本語名
    name_en: str               # 英語名
    x_percent: float           # X位置 (0-100%)
    color: str                 # 可視化用カラー (HEX)
    description_ja: str        # 日本語説明
    description_en: str        # 英語説明
    side: str = 'full'         # 'medial'=内側のみ, 'lateral'=外側のみ, 'full'=全幅


# =============================================================================
# デフォルトの骨ランドマーク定義（かかとから順に7本）
# =============================================================================

DEFAULT_BONE_LANDMARKS: Dict[str, BoneLandmark] = {
    'arch_start': BoneLandmark(
        id='arch_start',
        name_ja='アーチ起始部',
        name_en='Arch Start',
        x_percent=15.0,
        color='#FFB347',  # オレンジ
        description_ja='内側縦アーチの起始位置',
        description_en='Start of medial longitudinal arch',
        side='medial'  # 内側のみ
    ),
    'lateral_arch_start': BoneLandmark(
        id='lateral_arch_start',
        name_ja='外側アーチ起始部',
        name_en='Lateral Arch Start',
        x_percent=20.0,
        color='#E17055',  # テラコッタ
        description_ja='外側縦アーチの起始位置',
        description_en='Start of lateral longitudinal arch',
        side='lateral'  # 外側のみ
    ),
    'subtalar': BoneLandmark(
        id='subtalar',
        name_ja='距骨下レベル',
        name_en='Subtalar Level',
        x_percent=30.0,
        color='#FF6B6B',  # コーラルレッド
        description_ja='踵骨と距骨の関節レベル',
        description_en='Talo-calcaneal joint level',
        side='medial'  # 内側のみ
    ),
    'navicular': BoneLandmark(
        id='navicular',
        name_ja='舟状骨レベル',
        name_en='Navicular Level',
        x_percent=43.0,
        color='#4ECDC4',  # ティールグリーン
        description_ja='舟状骨の位置。内側縦アーチのピーク付近',
        description_en='Navicular bone position. Near the peak of medial longitudinal arch',
        side='medial'  # 内側のみ
    ),
    'cuboid': BoneLandmark(
        id='cuboid',
        name_ja='立方骨レベル',
        name_en='Cuboid Level',
        x_percent=45.0,
        color='#A29BFE',  # ラベンダー
        description_ja='立方骨の位置。外側縦アーチの終了部',
        description_en='Cuboid bone position. End of lateral longitudinal arch',
        side='lateral'  # 外側のみ
    ),
    'medial_cuneiform': BoneLandmark(
        id='medial_cuneiform',
        name_ja='内側楔状骨レベル',
        name_en='Medial Cuneiform Level',
        x_percent=55.0,
        color='#45B7D1',  # スカイブルー
        description_ja='内側楔状骨の位置。中足骨への移行部',
        description_en='Medial cuneiform position. Transition to metatarsals',
        side='medial'  # 内側のみ
    ),
    'metatarsal_base_1': BoneLandmark(
        id='metatarsal_base_1',
        name_ja='第1中足骨基部',
        name_en='1st Metatarsal Base (MB1)',
        x_percent=62.0,
        color='#F59E0B',  # アンバー
        description_ja='第1中足骨基部（Lisfranc関節内側）。内側縦アーチの終端',
        description_en='Base of 1st metatarsal (medial Lisfranc joint). End of medial longitudinal arch',
        side='medial'  # 内側のみ
    ),
    'metatarsal': BoneLandmark(
        id='metatarsal',
        name_ja='中足骨レベル',
        name_en='Metatarsal Level',
        x_percent=70.0,
        color='#96CEB4',  # セージグリーン
        description_ja='中足骨頭の位置。横アーチ・前足部サポート領域',
        description_en='Metatarsal head position. Transverse arch and forefoot support area',
        side='full'  # 全幅（横アーチは両側）
    ),
}


# =============================================================================
# 幅方向ガイドライン定義（列ガイドライン - X軸と平行）
# =============================================================================

@dataclass
class WidthGuideline:
    """幅方向ガイドラインの定義"""
    id: str                     # 識別子
    name_ja: str               # 日本語名
    name_en: str               # 英語名
    y_percent: float           # Y位置（外側0% → 内側100%）
    color: str                 # 可視化用カラー (HEX)
    description_ja: str        # 日本語説明


# 列境界のガイドライン（外側から内側へ）
# 外側 0% -------- 25% (第5列) -------- 65% (第5〜第2-4列境界) -------- 100% 内側
# 第5列: 0-25% (25%)
# 第2,3,4列: 25-65% (40%)
# 第1列: 65-100% (35%)

DEFAULT_WIDTH_GUIDELINES: Dict[str, WidthGuideline] = {
    'ray5_boundary': WidthGuideline(
        id='ray5_boundary',
        name_ja='第5列境界',
        name_en='5th Ray Boundary',
        y_percent=25.0,
        color='#9B59B6',  # パープル
        description_ja='第5列と第2-4列の境界（外側から25%）'
    ),
    'ray1_boundary': WidthGuideline(
        id='ray1_boundary',
        name_ja='第1列境界',
        name_en='1st Ray Boundary',
        y_percent=65.0,
        color='#E74C3C',  # レッド
        description_ja='第2-4列と第1列の境界（外側から65% = 内側から35%）'
    ),
}


@dataclass
class ArchGridCell:
    """Definition of an arch grid cell."""
    id: str                    # Cell ID (e.g. 'medial_1')
    x_start_landmark: str      # Start X landmark ID
    x_end_landmark: str        # End X landmark ID
    y_start_percent: float     # Start Y position (0-100%, from lateral side)
    y_end_percent: float       # End Y position (0-100%, from lateral side)
    default_height: float      # Default height (mm)
    arch_type: str             # 'medial', 'lateral', or 'transverse'
    name_ja: str               # Japanese name


DEFAULT_ARCH_GRID: Dict[str, ArchGridCell] = {
    # Medial longitudinal arch (4 cells)
    'medial_1': ArchGridCell(
        id='medial_1',
        x_start_landmark='arch_start',
        x_end_landmark='subtalar',
        y_start_percent=65.0,
        y_end_percent=100.0,
        default_height=0.8,
        arch_type='medial',
        name_ja='内側1: アーチ起始〜距骨下'
    ),
    'medial_2': ArchGridCell(
        id='medial_2',
        x_start_landmark='subtalar',
        x_end_landmark='navicular',
        y_start_percent=65.0,
        y_end_percent=100.0,
        default_height=1.0,
        arch_type='medial',
        name_ja='内側2: 距骨下〜舟状骨'
    ),
    'medial_3': ArchGridCell(
        id='medial_3',
        x_start_landmark='navicular',
        x_end_landmark='medial_cuneiform',
        y_start_percent=65.0,
        y_end_percent=100.0,
        default_height=0.9,
        arch_type='medial',
        name_ja='内側3: 舟状骨〜内側楔状骨'
    ),
    'medial_4': ArchGridCell(
        id='medial_4',
        x_start_landmark='medial_cuneiform',
        x_end_landmark='metatarsal',
        y_start_percent=65.0,
        y_end_percent=100.0,
        default_height=0.5,
        arch_type='medial',
        name_ja='内側4: 内側楔状骨〜中足骨'
    ),

    # Lateral longitudinal arch (1 cell)
    'lateral_1': ArchGridCell(
        id='lateral_1',
        x_start_landmark='lateral_arch_start',
        x_end_landmark='cuboid',
        y_start_percent=0.0,
        y_end_percent=25.0,
        default_height=0.5,
        arch_type='lateral',
        name_ja='外側: 外側アーチ起始〜立方骨'
    ),

    # Transverse arch (3 cells)
    'transverse_1': ArchGridCell(
        id='transverse_1',
        x_start_landmark='subtalar',
        x_end_landmark='navicular',
        y_start_percent=25.0,
        y_end_percent=65.0,
        default_height=0.3,
        arch_type='transverse',
        name_ja='横1: 距骨下〜舟状骨'
    ),
    'transverse_2': ArchGridCell(
        id='transverse_2',
        x_start_landmark='navicular',
        x_end_landmark='cuboid',
        y_start_percent=25.0,
        y_end_percent=65.0,
        default_height=0.5,
        arch_type='transverse',
        name_ja='横2: 舟状骨〜立方骨'
    ),
    'transverse_3': ArchGridCell(
        id='transverse_3',
        x_start_landmark='cuboid',
        x_end_landmark='medial_cuneiform',
        y_start_percent=25.0,
        y_end_percent=65.0,
        default_height=0.5,
        arch_type='transverse',
        name_ja='横3: 立方骨〜内側楔状骨'
    ),
}


def get_arch_grid_info() -> List[Dict]:
    """Get arch grid cell info list (for UI)."""
    info = []
    for cell_id, cell in DEFAULT_ARCH_GRID.items():
        info.append({
            'id': cell.id,
            'arch_type': cell.arch_type,
            'x_start': cell.x_start_landmark,
            'x_end': cell.x_end_landmark,
            'y_start': cell.y_start_percent,
            'y_end': cell.y_end_percent,
            'default_height': cell.default_height,
            'name_ja': cell.name_ja,
        })
    return info


def calculate_width_guidelines(
    outline: np.ndarray,
    width_percentages: Dict[str, float] = None,
    num_samples: int = 100
) -> Dict[str, np.ndarray]:
    """
    輪郭形状に沿った幅方向ガイドラインを計算
    
    Args:
        outline: 輪郭点配列 (N, 2) - x_mm, y_mm
        width_percentages: カスタムパーセンテージ {id: y_percent}
        num_samples: X方向のサンプル数
    
    Returns:
        {guideline_id: array of (x, y) points}
    """
    if width_percentages is None:
        guidelines = DEFAULT_WIDTH_GUIDELINES
    else:
        guidelines = {}
        for gid, wg in DEFAULT_WIDTH_GUIDELINES.items():
            pct = width_percentages.get(gid, wg.y_percent)
            guidelines[gid] = WidthGuideline(
                id=wg.id,
                name_ja=wg.name_ja,
                name_en=wg.name_en,
                y_percent=pct,
                color=wg.color,
                description_ja=wg.description_ja
            )
    
    x = outline[:, 0]
    y = outline[:, 1]
    x_min, x_max = x.min(), x.max()
    
    # X方向のサンプル点
    x_samples = np.linspace(x_min, x_max, num_samples)
    
    result = {}
    
    for gid, wg in guidelines.items():
        guideline_points = []
        
        for x_pos in x_samples:
            # この X 位置での輪郭の Y 範囲を取得
            # X 位置に近い点を探す
            tolerance = (x_max - x_min) / num_samples * 1.5
            mask = np.abs(outline[:, 0] - x_pos) < tolerance
            
            if mask.sum() > 0:
                y_at_x = outline[mask, 1]
                y_min_local = y_at_x.min()
                y_max_local = y_at_x.max()
                
                # パーセンテージに基づいてY位置を計算
                # 0% = y_min_local (外側), 100% = y_max_local (内側)
                y_pos = y_min_local + (y_max_local - y_min_local) * wg.y_percent / 100.0
                guideline_points.append([x_pos, y_pos])
        
        if guideline_points:
            result[gid] = np.array(guideline_points)
    
    return result


def calculate_width_guidelines_with_side(
    outline: np.ndarray,
    is_right_foot: bool = False,
    width_percentages: Dict[str, float] = None,
    num_samples: int = 100
) -> Dict[str, np.ndarray]:
    """
    輪郭形状に沿った幅方向ガイドラインを計算（左右足対応版）
    
    Args:
        outline: 輪郭点配列 (N, 2) - x_mm, y_mm
        is_right_foot: Trueの場合、右足として計算（パーセンテージ反転）
        width_percentages: カスタムパーセンテージ {id: y_percent}
        num_samples: X方向のサンプル数
    
    Returns:
        {guideline_id: array of (x, y) points}
    
    左足の場合: Y大=内側(母指側), Y小=外側(小指側)
    右足の場合: Y大=外側(小指側), Y小=内側(母指側)
    """
    if width_percentages is None:
        guidelines = DEFAULT_WIDTH_GUIDELINES
    else:
        guidelines = {}
        for gid, wg in DEFAULT_WIDTH_GUIDELINES.items():
            pct = width_percentages.get(gid, wg.y_percent)
            guidelines[gid] = WidthGuideline(
                id=wg.id,
                name_ja=wg.name_ja,
                name_en=wg.name_en,
                y_percent=pct,
                color=wg.color,
                description_ja=wg.description_ja
            )
    
    x = outline[:, 0]
    y = outline[:, 1]
    x_min, x_max = x.min(), x.max()
    
    # X方向のサンプル点
    x_samples = np.linspace(x_min, x_max, num_samples)
    
    result = {}
    
    for gid, wg in guidelines.items():
        guideline_points = []
        
        # 右足の場合はパーセンテージを反転
        # 例: 20% (外側から) → 80% (Y座標での位置)
        if is_right_foot:
            effective_percent = 100.0 - wg.y_percent
        else:
            effective_percent = wg.y_percent
        
        for x_pos in x_samples:
            tolerance = (x_max - x_min) / num_samples * 1.5
            mask = np.abs(outline[:, 0] - x_pos) < tolerance
            
            if mask.sum() > 0:
                y_at_x = outline[mask, 1]
                y_min_local = y_at_x.min()
                y_max_local = y_at_x.max()
                
                # パーセンテージに基づいてY位置を計算
                y_pos = y_min_local + (y_max_local - y_min_local) * effective_percent / 100.0
                guideline_points.append([x_pos, y_pos])
        
        if guideline_points:
            result[gid] = np.array(guideline_points)
    
    return result


def calculate_width_guidelines_straight(
    outline: np.ndarray,
    is_right_foot: bool = False,
    width_percentages: Dict[str, float] = None
) -> Dict[str, np.ndarray]:
    """
    踵と最大幅部分を通る直線ガイドラインを計算
    
    Args:
        outline: 輪郭点配列 (N, 2) - x_mm, y_mm
        is_right_foot: Trueの場合、右足として計算（パーセンテージ反転）
        width_percentages: カスタムパーセンテージ {id: y_percent}
    
    Returns:
        {guideline_id: array of 2 points [(x1,y1), (x2,y2)] for straight line}
    
    直線は踵位置と最大幅位置の2点を通り、つま先まで延長される
    """
    if width_percentages is None:
        guidelines = DEFAULT_WIDTH_GUIDELINES
    else:
        guidelines = {}
        for gid, wg in DEFAULT_WIDTH_GUIDELINES.items():
            pct = width_percentages.get(gid, wg.y_percent)
            guidelines[gid] = WidthGuideline(
                id=wg.id,
                name_ja=wg.name_ja,
                name_en=wg.name_en,
                y_percent=pct,
                color=wg.color,
                description_ja=wg.description_ja
            )
    
    x = outline[:, 0]
    y = outline[:, 1]
    x_min, x_max = x.min(), x.max()
    
    # 各X位置での幅を計算
    num_samples = 50
    x_samples = np.linspace(x_min, x_max, num_samples)
    widths = []
    
    for x_pos in x_samples:
        tolerance = (x_max - x_min) / num_samples * 1.5
        mask = np.abs(outline[:, 0] - x_pos) < tolerance
        if mask.sum() > 0:
            y_at_x = outline[mask, 1]
            width = y_at_x.max() - y_at_x.min()
            widths.append({'x': x_pos, 'width': width, 'y_min': y_at_x.min(), 'y_max': y_at_x.max()})
    
    if len(widths) < 2:
        return {}
    
    # X範囲
    x_range = x_max - x_min
    
    # 踵基準位置（X方向10%の位置）
    heel_ref_x = x_min + x_range * 0.10
    heel_data = None
    for w in widths:
        if w['x'] >= heel_ref_x:
            heel_data = w
            break
    if heel_data is None:
        heel_data = widths[0]
    
    # 最大幅位置を探す
    max_width_idx = max(range(len(widths)), key=lambda i: widths[i]['width'])
    max_width_data = widths[max_width_idx]
    
    # 開始位置（X=0%）と終了位置（X=100%）のデータ
    start_data = widths[0]  # X最小
    end_data = widths[-1]   # X最大（つま先）
    
    result = {}
    
    for gid, wg in guidelines.items():
        # 左足の場合はパーセンテージを反転（左足: Y小=内側、Y大=外側）
        if is_right_foot:
            effective_percent = wg.y_percent
        else:
            effective_percent = 100.0 - wg.y_percent
        
        # 踵基準位置（10%）での Y 位置
        heel_y = heel_data['y_min'] + (heel_data['y_max'] - heel_data['y_min']) * effective_percent / 100.0
        heel_x = heel_data['x']
        
        # 最大幅での Y 位置
        max_y = max_width_data['y_min'] + (max_width_data['y_max'] - max_width_data['y_min']) * effective_percent / 100.0
        max_x = max_width_data['x']
        
        # 直線の傾きを計算（踵10%と最大幅を通る直線）
        if max_x != heel_x:
            slope = (max_y - heel_y) / (max_x - heel_x)
            intercept = heel_y - slope * heel_x
            
            # 開始位置（X=0%）での Y 位置
            start_x = start_data['x']
            start_y = slope * start_x + intercept
            
            # 終了位置（つま先）での Y 位置
            end_x = end_data['x']
            end_y = slope * end_x + intercept
            
            # 直線を表現（0%開始、踵10%、最大幅、つま先）
            result[gid] = np.array([
                [start_x, start_y],
                [heel_x, heel_y],
                [max_x, max_y],
                [end_x, end_y]
            ])
        else:
            # 水平線の場合
            result[gid] = np.array([
                [start_data['x'], heel_y],
                [end_data['x'], heel_y]
            ])
    
    return result


def get_width_guideline_info() -> List[Dict]:
    """幅方向ガイドラインの情報を取得"""
    info = []
    for gid, wg in DEFAULT_WIDTH_GUIDELINES.items():
        info.append({
            'id': gid,
            'name_ja': wg.name_ja,
            'name_en': wg.name_en,
            'y_percent': wg.y_percent,
            'color': wg.color,
            'description_ja': wg.description_ja,
        })
    # パーセンテージでソート
    info.sort(key=lambda x: x['y_percent'])
    return info


# =============================================================================
# ガイドライン計算関数
# =============================================================================

def get_landmark_x_position(
    landmark_id: str,
    x_min: float,
    x_max: float,
    landmarks: Dict[str, BoneLandmark] = None
) -> float:
    """
    ランドマークの実際のX座標を計算
    
    Args:
        landmark_id: ランドマーク識別子
        x_min: 輪郭のX最小値（踵）
        x_max: 輪郭のX最大値（つま先）
        landmarks: ランドマーク定義（Noneの場合はデフォルト使用）
    
    Returns:
        実際のX座標 (mm)
    """
    if landmarks is None:
        landmarks = DEFAULT_BONE_LANDMARKS
    
    if landmark_id not in landmarks:
        raise ValueError(f"Unknown landmark ID: {landmark_id}")
    
    landmark = landmarks[landmark_id]
    x_range = x_max - x_min
    return x_min + (x_range * landmark.x_percent / 100.0)


def get_all_landmark_lines(
    x_min: float,
    x_max: float,
    y_min: float,
    y_max: float,
    landmarks: Dict[str, BoneLandmark] = None
) -> List[Dict]:
    """
    全てのランドマークラインを取得
    
    Args:
        x_min: 輪郭のX最小値
        x_max: 輪郭のX最大値
        y_min: 輪郭のY最小値
        y_max: 輪郭のY最大値
        landmarks: ランドマーク定義
    
    Returns:
        ライン情報のリスト [{id, name_ja, name_en, x, y_start, y_end, color}, ...]
    """
    if landmarks is None:
        landmarks = DEFAULT_BONE_LANDMARKS
    
    lines = []
    for landmark_id, landmark in landmarks.items():
        x = get_landmark_x_position(landmark_id, x_min, x_max, landmarks)
        lines.append({
            'id': landmark_id,
            'name_ja': landmark.name_ja,
            'name_en': landmark.name_en,
            'x': x,
            'y_start': y_min,
            'y_end': y_max,
            'color': landmark.color,
            'x_percent': landmark.x_percent,
            'description_ja': landmark.description_ja,
            'description_en': landmark.description_en,
            'side': landmark.side,  # 'medial', 'lateral', or 'full'
        })
    
    # X座標でソート（踵から順に）
    lines.sort(key=lambda l: l['x'])
    return lines


def create_landmark_settings(
    custom_percentages: Dict[str, float] = None
) -> Dict[str, BoneLandmark]:
    """
    カスタムパーセンテージでランドマーク設定を作成
    
    Args:
        custom_percentages: {landmark_id: x_percent} の辞書
    
    Returns:
        カスタマイズされたランドマーク定義
    """
    landmarks = {}
    
    for landmark_id, default_landmark in DEFAULT_BONE_LANDMARKS.items():
        if custom_percentages and landmark_id in custom_percentages:
            # カスタム値を適用（sideプロパティも保持）
            landmarks[landmark_id] = BoneLandmark(
                id=default_landmark.id,
                name_ja=default_landmark.name_ja,
                name_en=default_landmark.name_en,
                x_percent=custom_percentages[landmark_id],
                color=default_landmark.color,
                description_ja=default_landmark.description_ja,
                description_en=default_landmark.description_en,
                side=default_landmark.side,  # ← これが欠落していた！
            )
        else:
            # デフォルト値を使用
            landmarks[landmark_id] = default_landmark
    
    return landmarks


# =============================================================================
# 2D可視化用データ生成
# =============================================================================

def generate_landmark_visualization_data(
    outline: np.ndarray,
    landmarks: Dict[str, BoneLandmark] = None
) -> Dict:
    """
    輪郭データとランドマークから可視化用データを生成
    
    Args:
        outline: 輪郭点配列 (N, 2)
        landmarks: ランドマーク定義
    
    Returns:
        可視化用データ辞書
    """
    if landmarks is None:
        landmarks = DEFAULT_BONE_LANDMARKS
    
    x_min, y_min = outline.min(axis=0)
    x_max, y_max = outline.max(axis=0)
    
    lines = get_all_landmark_lines(x_min, x_max, y_min, y_max, landmarks)
    
    return {
        'outline': outline.tolist(),
        'bounds': {
            'x_min': float(x_min),
            'x_max': float(x_max),
            'y_min': float(y_min),
            'y_max': float(y_max),
        },
        'lines': lines,
        'total_length': float(x_max - x_min),
    }


# =============================================================================
# アーチパラメータとの連携
# =============================================================================

def get_arch_region_from_landmarks(
    landmarks: Dict[str, BoneLandmark] = None
) -> Dict[str, Tuple[float, float]]:
    """
    ランドマーク位置からアーチ領域のパーセンテージ範囲を取得
    
    ※ 簡易アーチ設定 (geometry_v4.py DEFAULT_ARCH_SETTINGS) と同期
    
    Returns:
        {
            'heel_cup': (start_%, end_%),
            'medial_arch': (start_%, peak_%, end_%),
            'lateral_arch': (start_%, peak_%, end_%),
            'transverse_arch': (start_%, peak_%, end_%),
        }
    """
    if landmarks is None:
        landmarks = DEFAULT_BONE_LANDMARKS
    
    subtalar = landmarks['subtalar'].x_percent
    arch_start = landmarks['arch_start'].x_percent
    lateral_arch_start = landmarks['lateral_arch_start'].x_percent
    navicular = landmarks['navicular'].x_percent
    cuboid = landmarks['cuboid'].x_percent
    metatarsal = landmarks['metatarsal'].x_percent
    
    return {
        # ヒールカップ: 踵後端 ～ 距骨下レベル
        'heel_cup': (0.0, subtalar),
        
        # 内側縦アーチ: アーチ起始部(15%) ～ 舟状骨(ピーク:43%) ～ 中足骨(70%)
        'medial_arch': (arch_start, navicular, metatarsal),
        
        # 外側縦アーチ: 外側アーチ起始部(20%) ～ (ピーク:32.5%) ～ 立方骨(45%)
        'lateral_arch': (lateral_arch_start, (lateral_arch_start + cuboid) / 2, cuboid),
        
        # 横アーチ: 舟状骨(43%) ～ (ピーク:59%) ～ 中足骨+5(75%)
        'transverse_arch': (navicular, (navicular + metatarsal + 5) / 2, min(metatarsal + 5, 80.0)),
    }


# =============================================================================
# デバッグ・表示用
# =============================================================================

def print_landmarks_info(landmarks: Dict[str, BoneLandmark] = None):
    """ランドマーク情報をコンソールに出力"""
    if landmarks is None:
        landmarks = DEFAULT_BONE_LANDMARKS
    
    print("\n" + "=" * 60)
    print("骨ランドマーク一覧 (Bone Landmarks)")
    print("=" * 60)
    
    for landmark_id, landmark in sorted(landmarks.items(), key=lambda x: x[1].x_percent):
        print(f"\n{landmark.name_ja} ({landmark.name_en})")
        print(f"  ID: {landmark.id}")
        print(f"  X位置: {landmark.x_percent}%")
        print(f"  カラー: {landmark.color}")
        print(f"  説明: {landmark.description_ja}")
    
    print("\n" + "=" * 60)


if __name__ == "__main__":
    # テスト実行
    print_landmarks_info()
    
    # サンプル輪郭での計算テスト
    x_min, x_max = 0.0, 260.0  # mm
    y_min, y_max = 0.0, 100.0  # mm
    
    lines = get_all_landmark_lines(x_min, x_max, y_min, y_max)
    
    print("\n計算されたライン位置:")
    for line in lines:
        print(f"  {line['name_ja']}: X = {line['x']:.1f} mm ({line['x_percent']}%)")
