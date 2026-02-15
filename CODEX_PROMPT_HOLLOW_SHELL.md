# MasaCAD: シェル構造改善プロンプト

## 背景・現状の問題

MasaCADは3Dプリント用インソールを生成するシステムです。現在、以下の問題があります：

### 現在の処理フロー（問題あり）
1. ソリッドインソールを生成（watertight ✓）
2. ラティス構造を生成
3. シェル（外殻）を後付けで生成 ← **ここで穴が開く**
4. シェル + ラティス を結合して出力

### 問題の詳細
- `build_shell_mesh()` 関数が上面・下面を内側にオフセットしてリムを作ろうとする
- アーチ形状により頂点数が不一致 → リム生成時に穴が開く
- スライサーは「閉じていないシェル」を「ソリッド」と解釈 → 内部が充填される

---

## 新しいアプローチ（実装してほしい内容）

### 処理フロー
```
Step 1: ソリッドインソールを生成（既存関数でwatertight）

Step 2: 「内部ソリッド」を生成
        - 輪郭を内側にオフセット（壁厚分）
        - 高さも top_skin, bottom_skin 分だけ縮小
        - これも watertight なソリッドとして生成

Step 3: ブーリアン減算
        outer_solid - inner_solid = hollow_shell
        → 数学的にwatertight保証

Step 4: inner_solid の形状内にラティスを生成・クリップ

Step 5: hollow_shell + lattice を結合して出力
```

---

## 技術情報

### 使用ライブラリ
- `trimesh`: メッシュ操作
- `numpy`: 数値計算
- `shapely`: 2Dポリゴン操作（輪郭オフセット等）
- `scipy`: 補間（LinearNDInterpolator）

### 既存の関数（参照用）

#### `generate_insole_from_outline()` in `core/geometry_v4.py`
- 輪郭CSVからソリッドインソールを生成
- 戻り値: watertight な `trimesh.Trimesh`
- アーチ形状を含む

#### `apply_3d_xcell_lattice()` in `core/xcell_3d.py`
- メッシュにラティス構造を適用
- 現在は `build_shell_mesh()` を呼び出している ← これを置き換えたい

#### `create_3d_xcell_unit()` in `core/xcell_3d.py`
- X-Cellラティスの単位セルを生成

---

## 実装すべき関数

### `generate_hollow_shell()` （新規）

```python
def generate_hollow_shell(
    outline_points: np.ndarray,  # 2D輪郭 (N, 2)
    top_height_map: dict,        # {(x, y): z_top}
    bottom_height_map: dict,     # {(x, y): z_bottom}
    wall_thickness: float = 0.8, # 側壁の厚み (mm)
    top_skin: float = 0.4,       # 上面スキン厚 (mm)
    bottom_skin: float = 0.4,    # 下面スキン厚 (mm)
) -> tuple[trimesh.Trimesh, trimesh.Trimesh]:
    """
    中空シェルを生成
    
    Returns:
        hollow_shell: 中空シェルメッシュ（watertight）
        inner_volume: 内部空間を表すソリッド（ラティス配置用）
    """
    # 1. outer_solid を生成（輪郭 + 高さマップから）
    # 2. inner_solid を生成（輪郭をオフセット + 高さを縮小）
    # 3. boolean: hollow_shell = outer_solid.difference(inner_solid)
    # 4. inner_volume も返す（ラティスクリップ用）
    pass
```

### 処理の詳細

#### 1. outer_solid の生成
既存の `generate_insole_from_outline()` と同様のロジックで、輪郭と高さマップからソリッドを生成。

#### 2. inner_solid の生成
- 輪郭を `shapely.buffer(polygon, -wall_thickness)` で内側にオフセット
- 高さマップから top_skin, bottom_skin を引いた新しい高さマップを作成
- その輪郭と高さで小さいソリッドを生成

#### 3. ブーリアン減算
```python
hollow_shell = outer_solid.difference(inner_solid, engine='blender')
```

---

## `apply_3d_xcell_lattice()` の修正

現在の処理:
```python
shell_mesh = build_shell_mesh(mesh, top_skin, bottom_skin)
result = trimesh.util.concatenate([shell_mesh, lattice])
```

新しい処理:
```python
# 1. 中空シェルと内部空間を生成
hollow_shell, inner_volume = generate_hollow_shell(
    outline_points, top_heights, bottom_heights,
    wall_thickness=0.8, top_skin=top_skin, bottom_skin=bottom_skin
)

# 2. ラティスを inner_volume の範囲内にクリップ（既存ロジック流用）

# 3. 結合
result = trimesh.util.concatenate([hollow_shell, lattice])
```

---

## テスト方法

1. 単体テスト
```python
# 簡単な矩形で中空シェルを生成
outline = np.array([[0,0], [50,0], [50,30], [0,30], [0,0]])
top_h = {(x, y): 5.0 for x in range(51) for y in range(31)}
bot_h = {(x, y): 0.0 for x in range(51) for y in range(31)}

shell, inner = generate_hollow_shell(outline, top_h, bot_h)
print(f"Shell watertight: {shell.is_watertight}")  # Should be True
```

2. 統合テスト
```python
# 実際のインソールで
from core.geometry_v4 import generate_insole_from_outline
mesh = generate_insole_from_outline('patients/0001/outline.csv')
result, info = apply_3d_xcell_lattice(mesh, cell_size=4.0)
result.export('exports/hollow_shell_test.stl')
# → スライサーで開いて内部が空洞+ラティスになっているか確認
```

---

## 成功基準

1. `generate_hollow_shell()` が watertight なシェルを返す
2. シェルの内部にラティスが正しく配置される
3. STLをスライサーで開いたとき、内部が充填されずラティスが見える
4. アーチ形状が保持される

---

## ファイル構成

```
masacad/
├── core/
│   ├── geometry_v4.py    # generate_insole_from_outline() がある
│   └── xcell_3d.py       # apply_3d_xcell_lattice(), build_shell_mesh() がある
├── patients/
│   └── 0001/
│       └── outline.csv   # テスト用輪郭データ
└── exports/              # STL出力先
```
