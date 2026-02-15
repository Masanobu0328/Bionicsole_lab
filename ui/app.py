"""
MasaCAD v4.0 - シンプルUI
断面スプライン補間方式によるインソール生成

使い方:
  streamlit run ui/app.py
"""

import streamlit as st
import sys
from pathlib import Path
import numpy as np
import pandas as pd
import plotly.graph_objects as go

# ===== 断面ビュー用ユーティリティ =====
def get_cross_section(mesh, x_position: float) -> np.ndarray:
    """
    メッシュをX=x_positionの平面で切断し、断面の点群を返す

    Args:
        mesh: 入力メッシュ
        x_position: 切断位置のX座標 (mm)

    Returns:
        断面の点群 (N, 2) - [y, z] 座標の配列
        断面がない場合は空配列
    """
    try:
        slice_plane_origin = [x_position, 0, 0]
        slice_plane_normal = [1, 0, 0]  # X軸方向

        section = mesh.section(
            plane_origin=slice_plane_origin,
            plane_normal=slice_plane_normal
        )

        if section is None:
            return np.array([])

        section_2d, _ = section.to_planar()

        points = []
        for entity in section_2d.entities:
            pts = section_2d.vertices[entity.points]
            points.extend(pts)

        if not points:
            return np.array([])

        return np.array(points)

    except Exception as e:
        print(f"Cross section error: {e}")
        return np.array([])


def get_cross_section_fallback(
    mesh,
    x_position: float,
    tolerance: float = 0.5
) -> np.ndarray:
    """
    フォールバック: X座標が指定範囲内の頂点を抽出

    Args:
        mesh: 入力メッシュ
        x_position: 切断位置のX座標 (mm)
        tolerance: 許容範囲 (mm)

    Returns:
        断面付近の点群 (N, 2) - [y, z] 座標の配列
    """
    vertices = mesh.vertices

    mask = np.abs(vertices[:, 0] - x_position) < tolerance
    section_verts = vertices[mask]

    if len(section_verts) == 0:
        return np.array([])

    return section_verts[:, 1:3]



# Windowsの標準出力で絵文字が出ると失敗するためUTF-8に固定
# エラーが発生する場合は無視（Streamlit環境などでは再設定できない場合がある）
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except (OSError, AttributeError):
    pass
try:
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except (OSError, AttributeError):
    pass

# プロジェクトルートをパスに追加
PROJECT_ROOT = Path(__file__).parent.parent.resolve()
sys.path.insert(0, str(PROJECT_ROOT))

# 骨ランドマークモジュールのインポート
from core.landmarks import (
    DEFAULT_BONE_LANDMARKS,
    DEFAULT_ARCH_GRID,
    get_all_landmark_lines,
    create_landmark_settings,
    get_arch_grid_info,
    # 幅方向ガイドライン
    DEFAULT_WIDTH_GUIDELINES,
    calculate_width_guidelines,
    calculate_width_guidelines_with_side,
    calculate_width_guidelines_straight,
    get_width_guideline_info,
)

from core.geometry_v4 import (
    generate_insole_from_outline,
    export_mesh,
    GEOMETRY_VERSION,
    DEFAULT_ARCH_SETTINGS
)

# ラティスモジュール
from core.xcell_3d import apply_3d_xcell_lattice, apply_3d_xcell_lattice_only


# ディレクトリ
EXPORTS_DIR = PROJECT_ROOT / "exports"
EXPORTS_DIR.mkdir(exist_ok=True)

# ページ設定
st.set_page_config(
    page_title="MasaCAD v4.0",
    page_icon=None,  # 絵文字を削除（Windows cp932エンコーディング対応）
    layout="wide"
)

# カスタムCSS
st.markdown("""
<style>
/* メインコンテナ */
.main {
    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
}

/* ヘッダー */
h1 {
    color: #174a5c;
    font-weight: 700;
}

/* ボタン */
.stButton>button {
    background: linear-gradient(135deg, #174a5c 0%, #2a7e8e 100%);
    color: #ffffff !important;
    border: none;
    border-radius: 8px;
    padding: 0.75rem 1.5rem;
    font-weight: 600;
    width: 100%;
}

/* 成功メッセージ */
.stSuccess {
    background-color: #d4edda;
    border-color: #c3e6cb;
}

/* メトリクスカード */
.metric-card {
    background: white;
    padding: 1rem;
    border-radius: 8px;
    text-align: center;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
.metric-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: #174a5c;
}
.metric-label {
    font-size: 0.8rem;
    color: #666;
}
</style>
""", unsafe_allow_html=True)

# ヘッダー
st.markdown("""
<div style="text-align: center; padding: 2rem 0;">
    <h1 style="font-size: 3rem; margin-bottom: 0.5rem;">MasaCAD v4.0</h1>
    <p style="color: #666; font-size: 1.1rem;">断面スプライン補間方式 | 輪郭ベース生成</p>
</div>
""", unsafe_allow_html=True)

# セッション状態
if 'generated_mesh' not in st.session_state:
    st.session_state.generated_mesh = None

# タブナビゲーション
tab1, tab2 = st.tabs(["インソール生成", "設定ガイド"])

# ===================================================================
# タブ1: インソール生成
# ===================================================================
with tab1:
    # メインコンテンツ
    col_params, col_preview = st.columns([1, 2], gap="large")

with col_params:
    st.markdown("### パラメータ設定")
    
    # 患者選択
    st.markdown("#### 患者選択")
    patients_dir = PROJECT_ROOT / "patients"
    patient_dirs = [d.name for d in patients_dir.iterdir() if d.is_dir()]
    
    outline_csv_path = None
    if patient_dirs:
        selected_patient = st.selectbox("患者ID", patient_dirs)
        outline_path = patients_dir / selected_patient / "outline.csv"
        if outline_path.exists():
            outline_csv_path = outline_path
            st.success(f"outline.csv 検出")
        else:
            st.warning("outline.csv が見つかりません")
    
    # 輪郭オプション
    if outline_csv_path:
        st.markdown("#### 足のオプション")
        
        col_opt1, col_opt2 = st.columns(2)
        with col_opt1:
            foot_side = st.selectbox("足の左右", ["左足", "右足"])
        with col_opt2:
            flip_orientation = st.checkbox("向き反転", value=False)
        
        flip_x = flip_orientation
        flip_y = (foot_side == "右足")
        
        # ===== 骨ランドマーク位置調整 =====
        st.markdown("---")
        st.markdown("#### 骨ランドマーク位置")
        st.caption("各骨レベルの位置（%）を調整 | 0%=踵、100%=つま先")
        
        # 7つのランドマーク（かかとから順）
        landmark_order = [
            'arch_start', 'lateral_arch_start', 'subtalar', 
            'navicular', 'cuboid', 'medial_cuneiform', 'metatarsal'
        ]
        
        # 内側アーチ関連
        st.markdown("**内側アーチ**", help="内側縦アーチに関連するランドマーク")
        row1_cols = st.columns(4)
        medial_landmarks = ['arch_start', 'subtalar', 'navicular', 'medial_cuneiform']
        
        custom_percentages = {}
        for i, landmark_id in enumerate(medial_landmarks):
            landmark = DEFAULT_BONE_LANDMARKS[landmark_id]
            with row1_cols[i]:
                custom_percentages[landmark_id] = st.slider(
                    landmark.name_ja,
                    min_value=5.0,
                    max_value=95.0,
                    value=landmark.x_percent,
                    step=1.0,
                    key=f"landmark_{landmark_id}",
                    help=landmark.description_ja
                )
        
        # 外側アーチ関連
        st.markdown("**外側アーチ**", help="外側縦アーチに関連するランドマーク")
        row2_cols = st.columns(3)
        lateral_landmarks = ['lateral_arch_start', 'cuboid', 'metatarsal']
        
        for i, landmark_id in enumerate(lateral_landmarks):
            landmark = DEFAULT_BONE_LANDMARKS[landmark_id]
            with row2_cols[i]:
                custom_percentages[landmark_id] = st.slider(
                    landmark.name_ja,
                    min_value=5.0,
                    max_value=95.0,
                    value=landmark.x_percent,
                    step=1.0,
                    key=f"landmark_{landmark_id}",
                    help=landmark.description_ja
                )
        
        # 幅方向ガイドライン（列境界）
        st.markdown("**列境界（幅方向）**", help="足の幅に対する列の境界位置")
        row3_cols = st.columns(2)
        
        width_percentages = {}
        for i, (gid, wg) in enumerate(DEFAULT_WIDTH_GUIDELINES.items()):
            with row3_cols[i]:
                width_percentages[gid] = st.slider(
                    wg.name_ja,
                    min_value=5.0,
                    max_value=95.0,
                    value=wg.y_percent,
                    step=1.0,
                    key=f"width_{gid}",
                    help=wg.description_ja
                )
        
        # セッション状態に保存（右パネルで使用）
        st.session_state.outline_csv_path = outline_csv_path
        st.session_state.custom_percentages = custom_percentages
        st.session_state.width_percentages = width_percentages
        st.session_state.is_right_foot = (foot_side == "右足")
    
    st.markdown("#### 基本形状")
    
    col_base1, col_base2 = st.columns(2)
    with col_base1:
        base_thickness = st.slider(
            "ベース厚み (mm)", 
            min_value=2.0, 
            max_value=6.0, 
            value=3.0, 
            step=0.5,
            help="インソール底面の厚み"
        )
    with col_base2:
        wall_offset_mm = st.slider(
            "壁高さ調整 (mm)", 
            min_value=-4.0, 
            max_value=4.0, 
            value=0.0, 
            step=0.5,
            help="壁の高さを調整（+で高く、-で低く）"
        )
    
    heel_cup_scale = st.slider(
        "ヒールカップ倍率",
        min_value=0.5,
        max_value=2.0,
        value=1.0,
        step=0.1,
        help="ヒールカップの深さ倍率"
    )
    
    # ===== ラティス設定 =====
    st.markdown("---")
    st.markdown("#### Kelvin")
    
    output_mode = "Kelvin"
    use_lattice = True
    st.caption("Output mode: Kelvin (fixed)")
    
    if use_lattice:
        col_lat1, col_lat2 = st.columns(2)
        with col_lat1:
            lattice_cell_size = st.slider(
                "Cell size (mm)",
                min_value=1.0,
                max_value=10.0,
                value=3.0,
                step=0.1,
                help="X pattern spacing"
            )
        with col_lat2:
            strut_radius = st.slider(
                "Strut radius (mm)",
                min_value=0.1,
                max_value=0.8,
                value=0.2,
                step=0.05,
                help="Thicker struts increase stiffness"
            )

    # ===== 簡易版アーチ設定 =====
    st.markdown("---")
    st.markdown("#### アーチ設定（簡易版）")
    st.caption("アーチの位置は上の骨ランドマークで自動決定されます。ここでは高さのみを調整します。")
    
    # アーチスケール（全体倍率）
    arch_scale = st.slider(
        "アーチ全体倍率", 
        min_value=0.5, 
        max_value=2.0, 
        value=1.0, 
        step=0.1,
        help="全アーチ高さの倍率（1.0=設定値通り）"
    )
    
    # 高さのみの設定（3列レイアウト）
    col_h1, col_h2, col_h3 = st.columns(3)
    
    with col_h1:
        st.markdown("**内側縦アーチ**")
        medial_height = st.number_input(
            "高さ (mm)", 
            min_value=0.0, 
            max_value=15.0, 
            value=float(DEFAULT_ARCH_SETTINGS['medial_height']),
            step=0.5,
            key="medial_height",
            help="内側縦アーチの最大高さ"
        )
        # 範囲情報を表示
        if custom_percentages:
            medial_start_pct = custom_percentages.get('arch_start', 15.0)
            medial_end_pct = custom_percentages.get('metatarsal', 70.0)
            st.caption(f"範囲: {medial_start_pct:.0f}% → {medial_end_pct:.0f}%")
    
    with col_h2:
        st.markdown("**外側縦アーチ**")
        lateral_height = st.number_input(
            "高さ (mm)", 
            min_value=0.0, 
            max_value=10.0, 
            value=float(DEFAULT_ARCH_SETTINGS['lateral_height']),
            step=0.5,
            key="lateral_height",
            help="外側縦アーチの最大高さ"
        )
        # 範囲情報を表示
        if custom_percentages:
            lateral_start_pct = custom_percentages.get('lateral_arch_start', 20.0)
            lateral_end_pct = custom_percentages.get('cuboid', 45.0)
            st.caption(f"範囲: {lateral_start_pct:.0f}% → {lateral_end_pct:.0f}%")
    
    with col_h3:
        st.markdown("**横アーチ**")
        transverse_height = st.number_input(
            "高さ (mm)", 
            min_value=0.0, 
            max_value=10.0, 
            value=float(DEFAULT_ARCH_SETTINGS['transverse_height']),
            step=0.5,
            key="transverse_height",
            help="横アーチの最大高さ（0で無効化）"
        )
        # 範囲情報を表示
        if custom_percentages:
            transverse_start_pct = custom_percentages.get('navicular', 43.0)
            transverse_end_pct = custom_percentages.get('metatarsal', 70.0) + 5.0
            st.caption(f"範囲: {transverse_start_pct:.0f}% → {transverse_end_pct:.0f}%")
    
    # --- グリッドセルごとの詳細設定（オプション） ---
    with st.expander("詳細: グリッドセルごとの高さ設定", expanded=False):
        st.markdown("""
        骨ランドマークと列境界で区切られた各セルの高さを個別設定できます。
        設定しない場合は、上記のアーチ高さスライダーの値が使用されます。
        """)

        use_grid_cells = st.checkbox("グリッドセルごとの高さを使用", value=False, key="use_grid_cells")

        if use_grid_cells:
            grid_heights = {}

            # 内側縦アーチ（4セル）
            st.markdown("**内側縦アーチ**")
            cols_m = st.columns(4)
            for i, (cell_id, cell) in enumerate([
                ('medial_1', DEFAULT_ARCH_GRID['medial_1']),
                ('medial_2', DEFAULT_ARCH_GRID['medial_2']),
                ('medial_3', DEFAULT_ARCH_GRID['medial_3']),
                ('medial_4', DEFAULT_ARCH_GRID['medial_4']),
            ]):
                with cols_m[i]:
                    st.caption(cell.name_ja.split(': ')[1])
                    grid_heights[cell_id] = st.number_input(
                        "mm", 0.0, 5.0, cell.default_height, 0.1,
                        key=f"grid_{cell_id}", label_visibility="collapsed"
                    )

            # 外側縦アーチ（1セル）
            st.markdown("**外側縦アーチ**")
            cell = DEFAULT_ARCH_GRID['lateral_1']
            grid_heights['lateral_1'] = st.number_input(
                f"{cell.name_ja.split(': ')[1]} (mm)",
                0.0, 3.0, cell.default_height, 0.1,
                key="grid_lateral_1"
            )

            # 横アーチ（3セル）
            st.markdown("**横アーチ**")
            cols_t = st.columns(3)
            for i, (cell_id, cell) in enumerate([
                ('transverse_1', DEFAULT_ARCH_GRID['transverse_1']),
                ('transverse_2', DEFAULT_ARCH_GRID['transverse_2']),
                ('transverse_3', DEFAULT_ARCH_GRID['transverse_3']),
            ]):
                with cols_t[i]:
                    st.caption(cell.name_ja.split(': ')[1])
                    grid_heights[cell_id] = st.number_input(
                        "mm", 0.0, 3.0, cell.default_height, 0.1,
                        key=f"grid_{cell_id}", label_visibility="collapsed"
                    )
        else:
            grid_heights = None

    st.markdown("<br>", unsafe_allow_html=True)
    
    # アーチ設定をまとめる（骨ランドマークから位置を自動取得）
    # 位置はcustom_percentagesから取得、なければデフォルト値を使用
    
    # 内側縦アーチ: arch_start → navicular → metatarsal
    medial_start = custom_percentages.get('arch_start', 15.0) if custom_percentages else 15.0
    medial_peak = custom_percentages.get('navicular', 43.0) if custom_percentages else 43.0
    medial_end = custom_percentages.get('metatarsal', 70.0) if custom_percentages else 70.0
    
    # 外側縦アーチ: lateral_arch_start → (中間) → cuboid
    lateral_start = custom_percentages.get('lateral_arch_start', 20.0) if custom_percentages else 20.0
    lateral_end = custom_percentages.get('cuboid', 45.0) if custom_percentages else 45.0
    lateral_peak = (lateral_start + lateral_end) / 2
    
    # 横アーチ: navicular → (中間) → metatarsal+5
    transverse_start = custom_percentages.get('navicular', 43.0) if custom_percentages else 43.0
    transverse_end = (custom_percentages.get('metatarsal', 70.0) if custom_percentages else 70.0) + 5.0
    transverse_peak = (transverse_start + transverse_end) / 2
    
    # Auto-pull arch width from width guidelines (column boundaries).
    width_percentages_custom = getattr(st.session_state, 'width_percentages', None)
    medial_y_start = (
        width_percentages_custom.get('ray1_boundary', DEFAULT_WIDTH_GUIDELINES['ray1_boundary'].y_percent)
        if width_percentages_custom
        else DEFAULT_WIDTH_GUIDELINES['ray1_boundary'].y_percent
    )
    lateral_y_end = (
        width_percentages_custom.get('ray5_boundary', DEFAULT_WIDTH_GUIDELINES['ray5_boundary'].y_percent)
        if width_percentages_custom
        else DEFAULT_WIDTH_GUIDELINES['ray5_boundary'].y_percent
    )
    transverse_y_start = lateral_y_end  # 25.0
    transverse_y_end = medial_y_start  # 65.0

    arch_settings = {
        'medial_start': medial_start,
        'medial_peak': medial_peak,
        'medial_end': medial_end,
        'medial_height': medial_height,
        'lateral_start': lateral_start,
        'lateral_peak': lateral_peak,
        'lateral_end': lateral_end,
        'lateral_height': lateral_height,
        'transverse_start': transverse_start,
        'transverse_peak': transverse_peak,
        'transverse_end': transverse_end,
        'transverse_height': transverse_height,
        'medial_y_start': medial_y_start,
        'medial_y_end': 100.0,
        'lateral_y_start': 0.0,
        'lateral_y_end': lateral_y_end,
        'transverse_y_start': transverse_y_start,
        'transverse_y_end': transverse_y_end,
        'grid_cell_heights': grid_heights,
    }
    st.session_state.arch_settings = arch_settings

    landmark_settings = None
    if custom_percentages:
        landmark_settings = {
            'navicular': custom_percentages.get('navicular', 43.0),
            'cuboid': custom_percentages.get('cuboid', 45.0),
            'metatarsal': custom_percentages.get('metatarsal', 70.0),
        }

    # 生成ボタン
    if st.button("インソール生成", use_container_width=True, type="primary"):
        with st.spinner("生成処理を実行中..."):
            try:
                if outline_csv_path:
                    mesh = generate_insole_from_outline(
                        outline_csv_path=outline_csv_path,
                        flip_x=flip_x,
                        flip_y=flip_y,
                        base_thickness=base_thickness,
                        arch_scale=arch_scale,
                        wall_height_offset_mm=wall_offset_mm,
                        heel_cup_scale=heel_cup_scale,
                        arch_settings=arch_settings,
                        landmark_settings=landmark_settings
                    )
                    
                    # ラティス構造を適用
                    lattice_info = None
                    if output_mode == "ラティスのみ":
                        st.info("Generating 3D X-cell lattice (lattice only)...")
                        mesh, lattice_info = apply_3d_xcell_lattice_only(
                            mesh,
                            cell_size=lattice_cell_size,
                            strut_radius=strut_radius
                        )
                    elif output_mode in ("シェル＋ラティス", "Kelvin"):
                        st.info("Generating 3D X-cell lattice (shell + lattice)...")
                        mesh, lattice_info = apply_3d_xcell_lattice(
                            mesh,
                            cell_size=lattice_cell_size,
                            strut_radius=strut_radius
                        )

                    st.session_state.generated_mesh = mesh

                    # ファイル保存
                    output_path = EXPORTS_DIR / "generated_v4_insole.stl"
                    export_mesh(mesh, output_path)

                    if lattice_info:
                        if lattice_info['success']:
                            st.success(f"生成完了！ラティス: {lattice_info['cells_generated']}セル")
                        else:
                            st.warning("生成完了！（ラティスはスキップされました）")
                            with st.expander("診断情報", expanded=True):
                                for msg in lattice_info['messages']:
                                    st.text(msg)
                    else:
                        st.success("生成完了！")
                else:
                    st.error("輪郭CSVを選択してください")
                    
            except Exception as e:
                st.error(f"エラー: {e}")
                import traceback
                st.code(traceback.format_exc())

with col_preview:
    # ===== 2D輪郭ビジュアライゼーション（上部） =====
    st.markdown("### 足型輪郭とガイドライン")
    
    # セッション状態から輪郭とランドマーク設定を取得
    if hasattr(st.session_state, 'outline_csv_path') and st.session_state.outline_csv_path:
        csv_data = pd.read_csv(st.session_state.outline_csv_path)
        outline_array = csv_data[['x_mm', 'y_mm']].values
        
        x = outline_array[:, 0]
        y = outline_array[:, 1]
        x_min, x_max = x.min(), x.max()
        y_min, y_max = y.min(), y.max()
        
        # カスタムランドマーク設定を取得
        custom_percentages = getattr(st.session_state, 'custom_percentages', None)
        if custom_percentages:
            landmarks = create_landmark_settings(custom_percentages)
        else:
            landmarks = DEFAULT_BONE_LANDMARKS
        
        lines = get_all_landmark_lines(x_min, x_max, y_min, y_max, landmarks)
        
        # Plotly図を作成
        fig = go.Figure()
        
        # 輪郭を描画
        fig.add_trace(go.Scatter(
            x=x, y=y,
            mode='lines',
            line=dict(color='#174a5c', width=2),
            name='足型輪郭',
            fill='toself',
            fillcolor='rgba(60, 174, 163, 0.15)',
        ))
        
        # ===== 幅方向ガイドライン（列境界線）を先に計算 =====
        is_right_foot = getattr(st.session_state, 'is_right_foot', False)
        width_percentages_custom = getattr(st.session_state, 'width_percentages', None)
        
        # 幅パーセンテージを取得（反転は描画時に行う）
        ray1_pct = width_percentages_custom.get('ray1_boundary', 65.0) if width_percentages_custom else 65.0
        ray5_pct = width_percentages_custom.get('ray5_boundary', 25.0) if width_percentages_custom else 25.0
        
        width_guidelines = calculate_width_guidelines_straight(
            outline_array, 
            is_right_foot=is_right_foot,
            width_percentages=width_percentages_custom
        )
        
        # ===== 列境界線からY座標を補間する関数 =====
        def get_ray_y_at_x(ray_points: np.ndarray, target_x: float) -> float:
            """
            列境界線の点配列から、指定X位置でのY座標を線形補間で求める
            """
            if ray_points is None or len(ray_points) < 2:
                return None
            
            # X座標でソート
            sorted_idx = np.argsort(ray_points[:, 0])
            sorted_points = ray_points[sorted_idx]
            
            x_vals = sorted_points[:, 0]
            y_vals = sorted_points[:, 1]
            
            # 範囲外の場合は外挿
            if target_x <= x_vals[0]:
                return y_vals[0]
            if target_x >= x_vals[-1]:
                return y_vals[-1]
            
            # 線形補間
            return np.interp(target_x, x_vals, y_vals)
        
        # 第1列・第5列境界の点データを取得
        ray1_points = width_guidelines.get('ray1_boundary')
        ray5_points = width_guidelines.get('ray5_boundary')
        
        for idx, line in enumerate(lines):
            side = line.get('side', 'full')
            line_x = line['x']  # この縦ガイドラインのX座標
            
            if side == 'medial':
                # 内側アーチは内側端（輪郭の端）から第5列境界まで
                ray5_y_at_x = get_ray_y_at_x(ray5_points, line_x)
                if is_right_foot:
                    # 右足: 第5列境界（下側）から内側端（Y大=y_max）まで
                    line_y_start = ray5_y_at_x if ray5_y_at_x is not None else y_min
                    line_y_end = y_max
                else:
                    # 左足: 内側端（Y小=y_min）から第5列境界（上側）まで
                    line_y_start = y_min
                    line_y_end = ray5_y_at_x if ray5_y_at_x is not None else y_max
                    
            elif side == 'lateral':
                # 外側アーチは常に第5列境界まで（小趾側）
                ray5_y_at_x = get_ray_y_at_x(ray5_points, line_x)
                if is_right_foot:
                    # 右足: 外側（小趾側）は下側（Y小）→ y_minから第5列境界まで
                    line_y_start = y_min
                    line_y_end = ray5_y_at_x if ray5_y_at_x is not None else y_max
                else:
                    # 左足: 外側（小趾側）は上側（Y大）→ 第5列境界からy_maxまで
                    line_y_start = ray5_y_at_x if ray5_y_at_x is not None else y_min
                    line_y_end = y_max
                    
            else:
                # 全幅（中足骨など）
                line_y_start = y_min
                line_y_end = y_max
            
            # 全て破線で統一（凡例なし）
            fig.add_trace(go.Scatter(
                x=[line['x'], line['x']],
                y=[line_y_start, line_y_end],
                mode='lines',
                line=dict(color=line['color'], width=2.5, dash='dash'),
                name=f"{line['name_ja']} ({line['x_percent']}%)",
                showlegend=False,
                hovertemplate=f"<b>{line['name_ja']}</b><br>X = {line['x']:.1f} mm<br>位置: {line['x_percent']}%<br>側: {side}<extra></extra>"
            ))
            
            # ラベル配置: side（medial/lateral）と左右足で決定
            # 左足: 内側アーチ(medial)→下、外側アーチ(lateral)→上
            # 右足: 内側アーチ(medial)→上、外側アーチ(lateral)→下
            # full（中足骨など）: 交互配置
            
            if side == 'medial':
                # 内側アーチ成分
                place_below = not is_right_foot  # 左足→下、右足→上
            elif side == 'lateral':
                # 外側アーチ成分
                place_below = is_right_foot  # 左足→上、右足→下
            else:
                # 全幅（中足骨など）: 交互配置
                place_below = (idx % 2 == 0)
            
            if place_below:
                # 下に配置
                fig.add_annotation(
                    x=line['x'],
                    y=y_min - (y_max - y_min) * 0.05,
                    text=f"<b>{line['name_ja']}</b><br>{line['x_percent']}%",
                    showarrow=False,
                    font=dict(size=9, color=line['color']),
                    align='center',
                    yanchor='top',
                    bgcolor='rgba(255,255,255,0.8)',
                    borderpad=2,
                )
            else:
                # 上に配置
                fig.add_annotation(
                    x=line['x'],
                    y=y_max + (y_max - y_min) * 0.05,
                    text=f"<b>{line['name_ja']}</b><br>{line['x_percent']}%",
                    showarrow=False,
                    font=dict(size=9, color=line['color']),
                    align='center',
                    yanchor='bottom',
                    bgcolor='rgba(255,255,255,0.8)',
                    borderpad=2,
                )
        
        # ===== 幅方向ガイドライン（列境界線）を描画 =====
        # （既に上で計算済み）
        
        for gid, points in width_guidelines.items():
            wg_info = DEFAULT_WIDTH_GUIDELINES[gid]
            # 実際に使用されているパーセンテージを取得
            actual_percent = width_percentages_custom.get(gid, wg_info.y_percent) if width_percentages_custom else wg_info.y_percent
            fig.add_trace(go.Scatter(
                x=points[:, 0],
                y=points[:, 1],
                mode='lines',
                line=dict(color=wg_info.color, width=2.5, dash='dashdot'),
                name=f"{wg_info.name_ja} ({actual_percent:.0f}%)",
                showlegend=False,
                hovertemplate=f"<b>{wg_info.name_ja}</b><br>幅位置: {actual_percent:.0f}%<extra></extra>"
            ))
            
            # 列境界線のラベル（踵側の左端、輪郭の外に配置）
            fig.add_annotation(
                x=points[0, 0] - (x_max - x_min) * 0.02,  # 左端の少し左
                y=points[0, 1],
                text=f"<b>{wg_info.name_ja}</b><br>{actual_percent:.0f}%",
                showarrow=False,
                font=dict(size=9, color=wg_info.color),
                align='right',
                xanchor='right',
                bgcolor='rgba(255,255,255,0.8)',
                borderpad=2,
            )
        
        fig.update_layout(
            xaxis=dict(
                title="X (mm) - 踵 → つま先",
                scaleanchor="y",
                showgrid=True,
                gridcolor='rgba(0,0,0,0.1)',
            ),
            yaxis=dict(
                title="Y (mm) - 内側 ↔ 外側" if not is_right_foot else "Y (mm) - 外側 ↔ 内側",
                showgrid=True,
                gridcolor='rgba(0,0,0,0.1)',
            ),
            showlegend=False,
            height=500,  # ラベル表示のため高くする
            margin=dict(l=80, r=30, t=80, b=80),  # 上下左マージンを広げてラベル用スペース確保
            paper_bgcolor='rgba(0,0,0,0)',
            plot_bgcolor='#ffffff',
        )
        
        st.plotly_chart(fig, use_container_width=True)
        st.info("左のパネルで患者を選択すると、足型輪郭とガイドラインが表示されます")
    
    st.markdown("---")
    
    # ===== 3Dプレビュー（生成後のメッシュ表示） =====
    if st.session_state.generated_mesh is not None:
        mesh = st.session_state.generated_mesh
        
        # メトリクス表示
        col_m1, col_m2, col_m3, col_m4 = st.columns(4)
        bounds = mesh.bounds
        
        with col_m1:
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-value">{bounds[1][0]-bounds[0][0]:.1f}</div>
                <div class="metric-label">LENGTH (MM)</div>
            </div>
            """, unsafe_allow_html=True)
        
        with col_m2:
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-value">{bounds[1][1]-bounds[0][1]:.1f}</div>
                <div class="metric-label">WIDTH (MM)</div>
            </div>
            """, unsafe_allow_html=True)
            
        with col_m3:
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-value">{bounds[1][2]-bounds[0][2]:.1f}</div>
                <div class="metric-label">HEIGHT (MM)</div>
            </div>
            """, unsafe_allow_html=True)
        
        with col_m4:
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-value">{'[OK]' if mesh.is_watertight else '[NG]'}</div>
                <div class="metric-label">WATERTIGHT</div>
            </div>
            """, unsafe_allow_html=True)
        
        st.markdown("<br>", unsafe_allow_html=True)
        
        # 追加情報
        col_i1, col_i2, col_i3 = st.columns(3)
        with col_i1:
            st.metric("頂点数", f"{len(mesh.vertices):,}")
        with col_i2:
            st.metric("面数", f"{len(mesh.faces):,}")
        with col_i3:
            # 底面平坦性
            z_min = mesh.vertices[:, 2].min()
            bottom = mesh.vertices[mesh.vertices[:, 2] < z_min + 0.1]
            z_range = bottom[:, 2].max() - bottom[:, 2].min()
            st.metric("底面平坦性", f"{'完全平坦' if z_range < 0.001 else f'{z_range:.3f}mm'}")
        
        # ダウンロードボタン
        st.markdown("<br>", unsafe_allow_html=True)
        col_d1, col_d2 = st.columns(2)
        
        output_stl = EXPORTS_DIR / "generated_v4_insole.stl"
        if output_stl.exists():
            with col_d1:
                with open(output_stl, 'rb') as f:
                    st.download_button(
                        label="STLダウンロード",
                        data=f.read(),
                        file_name="insole_v4.stl",
                        mime="application/octet-stream",
                        use_container_width=True
                    )
        
        # GLBも生成
        output_glb = EXPORTS_DIR / "generated_v4_insole.glb"
        export_mesh(mesh, output_glb)
        if output_glb.exists():
            with col_d2:
                with open(output_glb, 'rb') as f:
                    st.download_button(
                        label="GLBダウンロード",
                        data=f.read(),
                        file_name="insole_v4.glb",
                        mime="model/gltf-binary",
                        use_container_width=True
                    )
        
        # 3Dビューア（Three.js）
        st.markdown("#### 3Dビュー")
        
        # STLをBase64エンコード
        import base64
        with open(output_stl, 'rb') as f:
            stl_b64 = base64.b64encode(f.read()).decode()
        
        viewer_html = f'''
            <div id="viewer" style="width: 100%; height: 500px; border-radius: 8px; overflow: hidden;"></div>
            <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/STLLoader.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
            <script>
            (function() {{
                const container = document.getElementById('viewer');
                const scene = new THREE.Scene();
                scene.background = new THREE.Color(0xf0f0f0);
                
                // カメラ設定
                const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 1, 5000);
                
                const renderer = new THREE.WebGLRenderer({{ antialias: true }});
                renderer.setSize(container.clientWidth, container.clientHeight);
                container.appendChild(renderer.domElement);
                
                const controls = new THREE.OrbitControls(camera, renderer.domElement);
                controls.enableDamping = true;
                controls.dampingFactor = 0.05;
                
                // ライト
                const light1 = new THREE.DirectionalLight(0xffffff, 0.8);
                light1.position.set(1, 1, 1);
                scene.add(light1);
                const light2 = new THREE.DirectionalLight(0xffffff, 0.4);
                light2.position.set(-1, -1, -1);
                scene.add(light2);
                scene.add(new THREE.AmbientLight(0x404040, 0.5));
                
                // STL読み込み
                const loader = new THREE.STLLoader();
                const stlData = atob("{stl_b64}");
                const buffer = new ArrayBuffer(stlData.length);
                const view = new Uint8Array(buffer);
                for (let i = 0; i < stlData.length; i++) {{
                    view[i] = stlData.charCodeAt(i);
                }}
                
                const geometry = loader.parse(buffer);
                geometry.center();
                
                // バウンディングボックスを取得
                geometry.computeBoundingBox();
                const bbox = geometry.boundingBox;
                const size = new THREE.Vector3();
                bbox.getSize(size);
                const maxDim = Math.max(size.x, size.y, size.z);
                
                // カメラ位置をモデルサイズに基づいて設定
                const distance = maxDim * 2;
                camera.position.set(distance * 0.8, distance * 0.5, distance * 0.8);
                camera.lookAt(0, 0, 0);
                controls.target.set(0, 0, 0);
                
                // 高さに基づくグラデーション色を計算
                // ベース厚みからの高さの差分でグラデーション
                const positions = geometry.attributes.position.array;
                const count = positions.length / 3;
                const colors = new Float32Array(count * 3);
                
                // Z座標を収集
                let zMin = Infinity, zMax = -Infinity;
                const zValues = [];
                for (let i = 0; i < count; i++) {{
                    const z = positions[i * 3 + 2];
                    zValues.push(z);
                    if (z < zMin) zMin = z;
                    if (z > zMax) zMax = z;
                }}
                
                // ベースレベルを推定（中央値付近の最頻出Z）
                // 簡略化: 下から30%の位置をベースレベルとする
                const sortedZ = [...zValues].sort((a, b) => a - b);
                const baseZ = sortedZ[Math.floor(count * 0.3)];
                const heightAboveBase = zMax - baseZ;
                
                // 頂点カラーを設定
                // ベース以下 = 赤（一定、ベース色）
                // ベースより高い = グラデーション（赤→オレンジ→黄色、高さに応じて変化）
                // 感度を上げるため、固定の高さ範囲（0-2mm）で色をマッピング
                const maxColorHeight = 2.0;  // 2mm以上で完全に黄色になる
                
                for (let i = 0; i < count; i++) {{
                    const z = positions[i * 3 + 2];
                    const heightDiff = z - baseZ;  // ベースからの高さ（mm）
                    
                    let r, g, b;
                    
                    if (heightDiff <= 0) {{
                        // ベースレベル以下 = 赤（一定、ベース色）
                        r = 1.0; g = 0.0; b = 0.0;  // 赤
                    }} else {{
                        // ベースより高い = グラデーション（固定の高さ範囲0-2mmで色をマッピング）
                        // 1mm上がったら黄色っぽく見えるように感度を上げる
                        const t = Math.min(1, heightDiff / maxColorHeight);
                        
                        // 赤→オレンジ→黄色 グラデーション（高さに応じて変化）
                        if (t < 0.5) {{
                            // 0-1mm: 赤からオレンジへ
                            const s = t / 0.5;
                            r = 1.0; g = 0.0 + s * 0.8; b = 0.0;  // 赤(1,0,0)からオレンジ(1,0.8,0)へ
                        }} else {{
                            // 1-2mm: オレンジから黄色へ
                            const s = (t - 0.5) / 0.5;
                            r = 1.0; g = 0.8 + s * 0.2; b = 0.0;  // オレンジ(1,0.8,0)から黄色(1,1,0)へ
                        }}
                    }}
                    
                    colors[i * 3] = r;
                    colors[i * 3 + 1] = g;
                    colors[i * 3 + 2] = b;
                }}
                
                geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
                
                const material = new THREE.MeshPhongMaterial({{
                    vertexColors: true,
                    specular: 0x111111,
                    shininess: 30
                }});
                
                const meshObj = new THREE.Mesh(geometry, material);
                scene.add(meshObj);
                
                // グリッドをモデルサイズに合わせる
                const gridSize = Math.ceil(maxDim * 1.5 / 50) * 50;
                const grid = new THREE.GridHelper(gridSize, 20, 0xcccccc, 0xeeeeee);
                grid.rotation.x = Math.PI / 2;
                grid.position.z = -size.z / 2 - 1;
                scene.add(grid);
                
                function animate() {{
                    requestAnimationFrame(animate);
                    controls.update();
                    renderer.render(scene, camera);
                }}
                animate();
            }})();
            </script>
            '''
        
        st.components.v1.html(viewer_html, height=550)

        # ===== 断面ビュー =====
        st.markdown("#### 断面ビュー")
        st.caption("X軸方向の断面を表示（ラティス構造の確認用）")

        # メッシュの境界を取得
        bounds = mesh.bounds
        x_min, x_max = bounds[0][0], bounds[1][0]
        x_range = x_max - x_min

        # 断面位置スライダー（パーセント）
        section_percent = st.slider(
            "断面位置",
            min_value=0,
            max_value=100,
            value=50,
            step=5,
            format="%d%%",
            help="0%=かかと、100%=つま先",
            key="section_percent"
        )

        # パーセントを実際のX座標に変換
        x_position = x_min + (x_range * section_percent / 100.0)

        st.caption(f"X = {x_position:.1f} mm")

        # 断面を取得
        section_points = get_cross_section(mesh, x_position)
        if len(section_points) == 0:
            section_points = get_cross_section_fallback(mesh, x_position, tolerance=0.5)

        if len(section_points) > 0:
            # Plotlyで断面を表示
            fig_section = go.Figure()

            # 断面の輪郭を作成（点を角度で並べ替え）
            if len(section_points) >= 3:
                centroid = section_points.mean(axis=0)
                angles = np.arctan2(
                    section_points[:, 1] - centroid[1],
                    section_points[:, 0] - centroid[0]
                )
                order = np.argsort(angles)
                outline = section_points[order]
            else:
                outline = section_points

            fig_section.add_trace(go.Scatter(
                x=outline[:, 0],  # Y座標
                y=outline[:, 1],  # Z座標
                mode='lines',
                line=dict(color='#174a5c', width=2),
                fill='toself',
                fillcolor='rgba(23, 74, 92, 0.2)',
                name='断面'
            ))

            fig_section.update_layout(
                xaxis=dict(
                    title="Y (mm) - 幅方向",
                    scaleanchor="y",
                    showgrid=True,
                ),
                yaxis=dict(
                    title="Z (mm) - 高さ方向",
                    showgrid=True,
                ),
                height=400,
                margin=dict(l=60, r=30, t=30, b=60),
                showlegend=False,
            )

            st.plotly_chart(fig_section, use_container_width=True)
        else:
            st.warning("この位置では断面を取得できませんでした")
    else:
        st.info("左のパネルでパラメータを設定し「インソール生成」をクリックしてください")

# ===================================================================
# タブ2: 設定ガイド
# ===================================================================
with tab2:
    st.markdown("## 設定ガイド")
    st.markdown("骨ランドマークとアーチの対応関係、デフォルト値を確認できます。")
    
    st.markdown("---")
    
    # ===== 骨ランドマーク一覧 =====
    st.markdown("### 骨ランドマーク位置")
    st.markdown("各骨レベルの位置（%）を定義します。**0% = 踵後端、100% = つま先**")
    
    # ランドマークデータを表形式で整理
    landmark_data = []
    for landmark_id, landmark in DEFAULT_BONE_LANDMARKS.items():
        landmark_data.append({
            "骨名（日本語）": landmark.name_ja,
            "骨名（英語）": landmark.name_en,
            "位置 (%)": f"{landmark.x_percent}%",
            "適用側": "内側" if landmark.side == "medial" else ("外側" if landmark.side == "lateral" else "全幅"),
            "説明": landmark.description_ja,
        })
    
    # 位置でソート
    landmark_df = pd.DataFrame(landmark_data)
    landmark_df = landmark_df.sort_values(by="位置 (%)")
    
    st.dataframe(
        landmark_df,
        use_container_width=True,
        hide_index=True,
    )
    
    st.markdown("---")
    
    # ===== アーチ設定の対応関係 =====
    st.markdown("### アーチ設定の対応関係")
    st.markdown("各アーチの範囲は骨ランドマークから自動的に決定されます。")
    
    # アーチ対応表（数値なし、ランドマーク名のみ）
    arch_mapping = [
        {
            "アーチ名": "内側縦アーチ",
            "起始": "アーチ起始部",
            "ピーク": "舟状骨レベル",
            "終了": "中足骨レベル",
            "説明": "土踏まずのアーチ。衝撃吸収と推進力を担う。",
        },
        {
            "アーチ名": "外側縦アーチ",
            "起始": "外側アーチ起始部",
            "ピーク": "起始と終了の中間点",
            "終了": "立方骨レベル",
            "説明": "小指側のアーチ。安定性とバランスを担う。",
        },
        {
            "アーチ名": "横アーチ",
            "起始": "舟状骨レベル",
            "ピーク": "起始と終了の中間点",
            "終了": "中足骨レベル + 5%",
            "説明": "前足部の横方向アーチ。荷重分散を担う。",
        },
    ]
    
    arch_df = pd.DataFrame(arch_mapping)
    
    st.dataframe(
        arch_df,
        use_container_width=True,
        hide_index=True,
    )
    
    st.markdown("---")
    
    # ===== 幅方向ガイドライン =====
    st.markdown("### 幅方向ガイドライン（列境界）")
    st.markdown("足の幅方向の列を区切るガイドラインです。**0% = 外側（小指側）、100% = 内側（母指側）**")
    st.info("アーチ幅はここで示す列境界と連動します。横アーチ幅は第5列境界〜第1列境界の範囲で自動設定され、内側/外側縦アーチの幅も各境界で決まります。")
    
    width_data = []
    for gid, wg in DEFAULT_WIDTH_GUIDELINES.items():
        width_data.append({
            "ガイドライン名": wg.name_ja,
            "英語名": wg.name_en,
            "位置 (%)": f"{wg.y_percent}%",
            "説明": wg.description_ja,
        })
    
    width_df = pd.DataFrame(width_data)
    width_df = width_df.sort_values(by="位置 (%)")
    
    st.dataframe(
        width_df,
        use_container_width=True,
        hide_index=True,
    )
    
    st.markdown("---")

    # ===== アーチ幅と詳細設定（保存用） =====
    st.markdown("### アーチ幅設定と詳細（保存用）")
    st.markdown("アーチ幅はY方向の境界（列境界）を基準に設定されます。")
    st.markdown("""
    **アーチ幅（Y方向）**
    - **内側縦アーチ**: `medial_y_start` 〜 `medial_y_end(=100%)`
    - **外側縦アーチ**: `lateral_y_start(=0%)` 〜 `lateral_y_end`
    - **横アーチ**: `transverse_y_start(=lateral_y_end)` 〜 `transverse_y_end(=medial_y_start)`
    """)
    st.markdown("""
    **ガイド図（Y方向）**
    ```text
    100% 内側
      ┌────────────────────────────────────────────┐
      │ 内側縦アーチ領域（medial_y_start〜100%）     │
    65% ├──────────────────────────────────────────┤ ← 第1列境界（medial_y_start）
      │            横アーチ領域（25〜65%）          │
    25% ├──────────────────────────────────────────┤ ← 第5列境界（lateral_y_end）
      │ 外側縦アーチ領域（0〜lateral_y_end）        │
    0% 外側
    ```
    """)
    st.markdown("""
    **詳細: グリッドセルごとの高さ設定**
    - チェックを有効にすると、骨ランドマーク×列境界で分割したセルごとに高さを設定できます。
    - 無効の場合は、上部のアーチ高さ（内側/外側/横）スライダー値が使用されます。
    """)

    grid_rows = []
    for cell in DEFAULT_ARCH_GRID.values():
        grid_rows.append({
            "セルID": cell.id,
            "アーチ種別": cell.arch_type,
            "X開始": cell.x_start_landmark,
            "X終了": cell.x_end_landmark,
            "Y開始(%)": f"{cell.y_start_percent:.0f}",
            "Y終了(%)": f"{cell.y_end_percent:.0f}",
            "デフォルト高さ(mm)": f"{cell.default_height:.1f}",
            "名称": cell.name_ja,
        })
    grid_df = pd.DataFrame(grid_rows)
    st.dataframe(
        grid_df,
        use_container_width=True,
        hide_index=True,
    )
    
    st.markdown("---")
    
    # ===== 使い方のヒント =====
    st.markdown("### 使い方のヒント")
    
    col_hint1, col_hint2 = st.columns(2)
    
    with col_hint1:
        st.markdown("""
        **簡易版の使い方:**
        1. 骨ランドマーク位置を調整（必要に応じて）
        2. アーチの高さ（mm）を調整
        3. インソール生成ボタンをクリック
        
        → アーチの範囲は自動的に決定されます
        """)
    
    with col_hint2:
        st.markdown("""
        **詳細版（将来実装予定）:**
        - 各骨レベルごとに個別の高さを設定
        - 骨レベル間を補間して滑らかなアーチを生成
        - より細かい調整が可能
        """)
    
    st.markdown("---")
    
    # ===== 座標系の説明 =====
    st.markdown("### 座標系")
    
    st.markdown("""
    - **X軸**: 0% = 踵後端、100% = つま先（足長方向）
    - **Y軸**: CSVデータに基づく（左足/右足で内側/外側の解釈が異なる）
    - **Z軸**: 高さ方向（底面 = 0mm、上方向がプラス）
    """)
    
    st.markdown("---")
    
    # ===== Z軸（高さ方向）の詳細 =====
    st.markdown("### Z軸（高さ方向）の構造")
    st.markdown("インソールの高さは以下の要素を**加算**して決定されます。Z軸のプラス方向が「上」です。")
    
    z_structure = [
        {
            "要素": "底面",
            "Z座標": "0mm（固定）",
            "説明": "インソールの底面。3Dプリント時の接地面",
        },
        {
            "要素": "ベース厚み",
            "Z座標": "3.0mm（デフォルト）",
            "説明": "インソール全体の最小厚み。スライダーで調整可能",
        },
        {
            "要素": "壁高さ（輪郭上）",
            "Z座標": "0〜5.0mm（内壁最大）、0〜3.0mm（外壁最大）",
            "説明": "輪郭（縁）上の点に適用。ベース厚みに加算",
        },
        {
            "要素": "ヒールカップ",
            "Z座標": "0〜2.0mm",
            "説明": "踵部分（X=0〜20%）の輪郭上に適用。壁高さと比較して大きい方を採用",
        },
        {
            "要素": "アーチ高さ（内部）",
            "Z座標": "0〜1.5mm（デフォルト）",
            "説明": "内部の点に適用。壁→アーチへ滑らかに遷移",
        },
    ]
    z_df = pd.DataFrame(z_structure)
    st.dataframe(z_df, use_container_width=True, hide_index=True)
    
    st.markdown("""
    **高さ計算の流れ:**
    1. `Z = ベース厚み`（全点共通の最低高さ）
    2. **輪郭上の点**: `Z += max(壁高さ, ヒールカップ)`
    3. **内部の点**: `Z += アーチ高さ`（縁からの距離に応じてブレンド）
    
    **最終的なZ座標の例:**
    - 前足部の内部点: `3.0mm（ベース）+ 0.5mm（アーチ）= 3.5mm`
    - 土踏まず部の壁（縁）: `3.0mm（ベース）+ 5.0mm（内壁）= 8.0mm`
    - 踵部の縁: `3.0mm（ベース）+ 2.0mm（ヒールカップ）= 5.0mm`
    """)
    
    st.markdown("---")
    
    # ===== 左右足の座標対応表 =====
    st.markdown("### 左右足のY軸座標対応")
    st.markdown("CSVデータ（左足スキャン想定）に対する各要素のY軸配置")
    
    foot_mapping = [
        {
            "要素": "内側縦アーチ（土踏まず）",
            "左足選択時": "Y_min側（Y座標が小さい側）",
            "右足選択時": "Y_max側（Y座標が大きい側）",
        },
        {
            "要素": "外側縦アーチ（小指側）",
            "左足選択時": "Y_max側（Y座標が大きい側）",
            "右足選択時": "Y_min側（Y座標が小さい側）",
        },
        {
            "要素": "内壁（高い壁）",
            "左足選択時": "Y_min側（Y座標が小さい側）",
            "右足選択時": "Y_max側（Y座標が大きい側）",
        },
        {
            "要素": "外壁（低い壁）",
            "左足選択時": "Y_max側（Y座標が大きい側）",
            "右足選択時": "Y_min側（Y座標が小さい側）",
        },
    ]
    
    foot_df = pd.DataFrame(foot_mapping)
    st.dataframe(foot_df, use_container_width=True, hide_index=True)
    
    st.caption("※ 右足選択時は内部でY座標が反転（flip_y）されるため、配置が逆になります")
    
    st.markdown("---")
    
    # ===== 壁とヒールカップの構造 =====
    st.markdown("### 壁とヒールカップの構造")
    
    st.markdown("""
    **壁（Wall）の構成:**
    - **内壁（Inner Wall）**: 土踏まず側の壁。足をしっかり支えるため、外壁より高い
    - **外壁（Outer Wall）**: 小指側の壁。内壁より低めに設計
    - 壁の高さはX位置（踵→つま先）で変化
    - Y位置に応じて内壁と外壁の高さを線形補間
    """)
    
    st.markdown("""
    **壁と骨ランドマークの連動（動的生成）:**
    
    壁の形状は骨ランドマークスライダーの値に応じて自動調整されます。
    
    | 壁の特徴 | 連動するランドマーク | デフォルト値 | 高さ |
    |----------|---------------------|-------------|------|
    | 外壁最高点 | 30%付近（固定） | 30% | 3.0mm |
    | 内壁最高点 | 舟状骨レベル | 43% | 5.0mm |
    | 外壁終了（0mmになる） | 立方骨レベル | 45% | 0.0mm |
    | 内壁終了（0mmになる） | 中足骨レベル | 70% | 0.0mm |
    
    - **0%〜20%**: ヒールカップ領域（壁高さ固定: 内壁6.4mm、外壁5.9mm）
    - **20%〜30%**: 内壁が上昇開始、外壁が下降（外壁最高点3.0mmは30%付近）
    - **30%〜舟状骨**: 内壁が上昇継続、外壁が下降継続
    - **舟状骨（43%）**: 内壁最高点5.0mm
    - **舟状骨〜立方骨**: 外壁が0mmに到達
    - **舟状骨〜中足骨**: 内壁が0mmに到達
    - **中足骨〜100%**: 前足部（壁なし）
    """)
    
    st.markdown("""
    **ヒールカップ（Heel Cup）の構成:**
    - 踵部分（X = 0〜20%）に適用される凹み形状
    - 踵後端（X=0%）で最大深さ、X=20%で0に遷移
    - 踵を包み込んで安定性を向上させる
    - ヒールカップ領域では壁高さが均一化される（内壁と外壁の平均）
    - ※ヒールカップは固定設定（骨ランドマークとは連動しない）
    """)
    
    # 壁プロファイル参考値（骨ランドマークに連動して動的生成）
    st.markdown("**壁高さプロファイル（主要ポイント）:**")
    st.caption("※ ランドマーク変更時は自動調整されます")
    
    wall_profile_data = [
        {"X位置": "0%（踵後端）", "内壁(mm)": "6.4", "外壁(mm)": "5.9", "説明": "ヒールカップ開始"},
        {"X位置": "20%", "内壁(mm)": "6.4", "外壁(mm)": "5.9", "説明": "ヒールカップ終端"},
        {"X位置": "30%", "内壁(mm)": "約7.2", "外壁(mm)": "3.0", "説明": "外壁最高点"},
        {"X位置": "43%（舟状骨）", "内壁(mm)": "5.0", "外壁(mm)": "約0.1", "説明": "内壁最高点"},
        {"X位置": "45%（立方骨）", "内壁(mm)": "約4.9", "外壁(mm)": "0.0", "説明": "外壁終了"},
        {"X位置": "70%（中足骨）", "内壁(mm)": "0.0", "外壁(mm)": "0.0", "説明": "内壁終了"},
        {"X位置": "100%（つま先）", "内壁(mm)": "0.0", "外壁(mm)": "0.0", "説明": "前足部"},
    ]
    wall_df = pd.DataFrame(wall_profile_data)
    st.dataframe(wall_df, use_container_width=True, hide_index=True)
    
    st.markdown("""
    **壁終了位置と骨ランドマークの連動:**
    - **内壁最高点**: 舟状骨レベル（デフォルト43%）
    - **外壁終了**: 立方骨レベル（デフォルト45%）
    - **内壁終了**: 中足骨レベル（デフォルト70%）
    
    ※ 骨ランドマークスライダーで位置を変更すると、壁の形状も自動的に調整されます
    """)

# フッター
st.markdown("---")
st.markdown(f"<p style='text-align: center; color: #666;'>MasaCAD {GEOMETRY_VERSION}</p>", unsafe_allow_html=True)
