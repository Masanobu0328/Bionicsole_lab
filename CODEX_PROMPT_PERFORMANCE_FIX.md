# MasaCAD: 中空シェル性能問題の修正

## 問題

`generate_hollow_shell()` 関数が非常に遅い（10分以上）。

### 原因

`_build_solid_from_height_maps()` が outer_solid と inner_solid の**両方**を一から再生成している：

```python
# 現在のコード（問題あり）
outer_solid = _build_solid_from_height_maps(...)  # ← 数分かかる
inner_solid = _build_solid_from_height_maps(...)  # ← 数分かかる
hollow_shell = outer_solid.difference(inner_solid)
```

各ソリッドで約16万点のグリッドを生成し、各点で `point_in_polygon()` チェックを行っている。

---

## 修正方針

**outer_solid は既存の mesh を再利用し、inner_solid だけを生成する。**

ただし、`_build_solid_from_height_maps()` の内部グリッド生成も遅いので、以下の最適化が必要：

1. `point_in_polygon()` のループを**ベクトル化**（matplotlib.path.Path.contains_points を使用）
2. 不要な内部点生成をスキップ

---

## 修正箇所

### 1. `_build_solid_from_height_maps()` の高速化

**ファイル**: `core/geometry_v4.py`

**変更前**:
```python
for i in range(1, x_steps):
    gx = x_min + i * sample_step
    for j in range(1, y_steps):
        gy = y_min + j * sample_step
        if point_in_polygon(np.array([gx, gy]), outline):  # ← 遅い
            interior_points.append([gx, gy])
```

**変更後**:
```python
from matplotlib.path import Path as MplPath

# グリッド全体を一度に生成
x_coords = np.linspace(x_min, x_max, x_steps)
y_coords = np.linspace(y_min, y_max, y_steps)
xx, yy = np.meshgrid(x_coords, y_coords)
grid_points = np.column_stack([xx.ravel(), yy.ravel()])

# 一括でポリゴン内判定
outline_path = MplPath(outline)
mask = outline_path.contains_points(grid_points)
interior_points = grid_points[mask]
```

これにより、16万回のPythonループが1回のベクトル化された操作に置き換わる。

---

### 2. `generate_hollow_shell()` で outer_mesh を受け取る

**変更前**:
```python
def generate_hollow_shell(
    outline_points, top_height_map, bottom_height_map,
    wall_thickness=0.8, top_skin=0.4, bottom_skin=0.4
):
    outer_solid = _build_solid_from_height_maps(...)  # ← 常に再生成
```

**変更後**:
```python
def generate_hollow_shell(
    outline_points, top_height_map, bottom_height_map,
    wall_thickness=0.8, top_skin=0.4, bottom_skin=0.4,
    outer_mesh=None  # 既存メッシュを渡せるようにする
):
    if outer_mesh is not None and len(outer_mesh.vertices) > 0:
        outer_solid = outer_mesh  # 再利用
    else:
        outer_solid = _build_solid_from_height_maps(...)
```

---

### 3. 呼び出し側の修正

**ファイル**: `core/xcell_3d.py`

**変更前**:
```python
hollow_shell, inner_volume = generate_hollow_shell(
    outline_points=outline_points,
    top_height_map=top_heights,
    bottom_height_map=bottom_heights,
    wall_thickness=wall_thickness,
    top_skin=top_skin,
    bottom_skin=bottom_skin
)
```

**変更後**:
```python
hollow_shell, inner_volume = generate_hollow_shell(
    outline_points=outline_points,
    top_height_map=top_heights,
    bottom_height_map=bottom_heights,
    wall_thickness=wall_thickness,
    top_skin=top_skin,
    bottom_skin=bottom_skin,
    outer_mesh=mesh  # 既存の watertight メッシュを渡す
)
```

---

## テスト方法

```bash
python test_dual_wall.py
```

**成功基準**:
- 1〜2分以内に完了
- `[HOLLOW-SHELL] Using provided mesh as outer solid` のログが出力
- `exports/dual_wall_insole_test.stl` が生成される
- Shell watertight: True

---

## 参考: 既存ファイル構成

```
masacad/
├── core/
│   ├── geometry_v4.py    # generate_hollow_shell, _build_solid_from_height_maps
│   └── xcell_3d.py       # apply_3d_xcell_lattice
└── test_dual_wall.py     # テストスクリプト
```
