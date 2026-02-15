# X-Cell ラティス構造 ユニットセル（原型）

## 完成したファイルの場所

### 生成されたSTLファイル

以下のファイルが `exports/` ディレクトリに生成されています：

#### ユニットセル（原型）
- **`exports/xcell_unit_3mm.stl`** - 3mmセルサイズのユニットセル（推奨）
- **`exports/xcell_unit_4.0mm.stl`** - 4mmセルサイズのユニットセル
- **`exports/xcell_unit_5.0mm.stl`** - 5mmセルサイズのユニットセル

#### ラティス構造（デモ）
- **`exports/xcell_lattice_30mm.stl`** - 30mm x 30mm x 10mm ボックス内のラティス構造
- **`exports/xcell_lattice_box_30mm_v2.stl`** - 改良版ラティス構造

### 可視化画像

- **`xcell_unit_3.0mm_view.png`** - ユニットセルの3D可視化
- **`xcell_lattice_box_view.png`** - ラティス構造の3D可視化
- **`xcell_top_views.png`** - 上から見た図（トップビュー）

## 確認方法

### 1. STLビューアーで確認（推奨）

#### オンラインビューアー
1. https://www.viewstl.com/ にアクセス
2. `exports/xcell_unit_3mm.stl` をドラッグ&ドロップ
3. 3D表示で確認

#### ローカルソフトウェア
- **FreeCAD**（無料）: https://www.freecad.org/
- **Blender**（無料）: https://www.blender.org/
- **Fusion 360**（教育版無料）: https://www.autodesk.com/products/fusion-360/

### 2. Pythonで確認

```python
import trimesh

# ユニットセルを読み込み
unit_cell = trimesh.load('exports/xcell_unit_3mm.stl')

print(f"頂点数: {len(unit_cell.vertices)}")
print(f"面数: {len(unit_cell.faces)}")
print(f"Watertight: {unit_cell.is_watertight}")
print(f"サイズ: {unit_cell.bounds[1] - unit_cell.bounds[0]}")

# 表示（Jupyter Notebookまたはインタラクティブ環境）
unit_cell.show()
```

### 3. コードから確認

```python
from core.lattice import create_xcell_unit_cell

# ユニットセルを生成
unit_cell = create_xcell_unit_cell(
    cell_size=3.0,        # セルサイズ（mm）
    cell_height=8.0,      # 高さ（mm）
    strut_thickness=0.8,  # ストラット厚（mm）
    top_skin=1.0,         # 上面スキン厚（mm）
    bottom_skin=1.0       # 底面スキン厚（mm）
)

# エクスポート
unit_cell.export('my_unit_cell.stl')
```

## 作成されたモジュール

### `core/xcell_primitive.py`
- X-cellユニットセル生成関数
- ラティス構造生成関数
- テスト・デモ関数

### `core/lattice.py` (更新版 v2.0)
- `create_xcell_unit_cell()` - ユニットセル生成
- `generate_xcell_lattice()` - ラティス構造生成
- `apply_xcell_lattice()` - メッシュに適用
- `apply_lattice_to_insole()` - インソールに適用（API）

## 今後の活用方法

### 1. UI（Streamlit）での使用

既に `ui/app.py` に統合されています：

```python
from core.lattice import apply_lattice_to_insole

# インソール生成後にラティスを適用
mesh = apply_lattice_to_insole(
    insole_mesh,
    cell_size=3.0,        # UIのスライダーから取得
    strut_thickness=0.8,  # 固定値またはUIパラメータ
    top_skin=1.0,         # UIのスライダーから取得
    bottom_skin=1.0       # UIのスライダーから取得
)
```

### 2. パラメータ化による柔軟な設計

- **セルサイズ**を変更 → ラティス密度が変わる
- **ストラット厚**を変更 → 構造強度が変わる
- **スキン厚**を変更 → 表面仕上げが変わる

### 3. 参照STLからの学習

- `exports/インソール試作20256月 v3.stl` から構造を分析
- 推定パラメータ：セルサイズ≈3.0mm、ストラット厚≈0.8mm
- このパラメータをベースに調整可能

## 技術的な特徴

### 完成した機能

1. **ユニットセル生成**
   - Watertightなメッシュ
   - パラメータ化（セルサイズ、ストラット厚、スキン厚）
   - X字型パターン（±45度ストラット）

2. **ラティス構造生成**
   - グリッド配置
   - スキン層（上下）
   - ストラット（X字型）

3. **メッシュ適用**
   - インソール形状への適用
   - ブーリアン演算（クリップ）

### 制限事項

- **ブーリアン演算**: blenderエンジンが失敗する場合がある
  - 解決策：`manifold3d` をインストール
  ```bash
  pip install manifold3d
  ```
- **パフォーマンス**: セルサイズが小さいと処理時間が増加

## パラメータ推奨値

| パラメータ | 推奨値 | 範囲 | 説明 |
|-----------|--------|------|------|
| `cell_size` | 3.0mm | 2.0-5.0mm | セルサイズ（小さいほど密） |
| `strut_thickness` | 0.8mm | 0.5-1.5mm | ストラット厚（太いほど強い） |
| `top_skin` | 1.0mm | 0.5-2.0mm | 上面スキン厚 |
| `bottom_skin` | 1.0mm | 0.5-2.0mm | 底面スキン厚 |

## 次のステップ

1. **UI統合の改善**
   - ストラット厚のパラメータ追加
   - リアルタイムプレビュー

2. **パフォーマンス最適化**
   - メッシュ簡略化
   - ブーリアン演算の最適化

3. **機能拡張**
   - 他のラティスパターン（hex、gyroid等）
   - 段階的密度（部分的にラティス）

4. **品質向上**
   - Watertight保証
   - メッシュ品質の検証

---

**作成日**: 2025-01-14  
**バージョン**: 2.0  
**参照STL**: `exports/インソール試作20256月 v3.stl`
