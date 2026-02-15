# ラティス結合部修正 - 実装プロンプト

## 問題

現在の実装では、8本のストラットが中心点で完全に重複し、結合部が太くなりすぎている。
- 重複エッジ: 700,071本
- スライサーでの処理不良
- 3Dプリント時の硬さの偏り

## 解決策

**中心に球を配置し、ストラットを球の表面までに短縮する**

## 実装内容

### 変更ファイル
- `core/xcell_3d.py` の `create_3d_xcell_unit` 関数（22-98行目）

### 修正手順

1. **中心球の生成を追加**（ストラット生成の前）
```python
# 中心に球を配置
center_sphere = trimesh.creation.icosphere(
    subdivisions=2,  # 解像度（2=80面）
    radius=strut_radius
)
center_sphere.apply_translation(center)
parts.append(center_sphere)
```

2. **ストラットの長さを調整**（球の半径分引く）
```python
for corner in corners:
    direction = center - corner
    direction_normalized = direction / np.linalg.norm(direction)
    
    # ストラットの長さ（球の表面まで）
    corner_to_center = np.linalg.norm(direction)
    strut_length = corner_to_center - strut_radius  # 球の半径分引く
    
    if strut_length < 0.001:
        continue
    
    # シリンダーを作成（sections=16に変更）
    cylinder = trimesh.creation.cylinder(
        radius=strut_radius,
        height=strut_length,
        sections=16  # 8→16に変更
    )
    
    # 方向を合わせる（既存のコード）
    z_axis = np.array([0, 0, 1])
    rotation_matrix = rotation_matrix_from_vectors(z_axis, direction_normalized)
    cylinder.apply_transform(rotation_matrix)
    
    # 位置を調整（コーナーから球表面まで）
    strut_start = corner + direction_normalized * strut_radius
    strut_center = strut_start + direction_normalized * (strut_length / 2)
    cylinder.apply_translation(strut_center)
    
    parts.append(cylinder)
```

3. **クリーンアップを強化**
```python
unit_cell = trimesh.util.concatenate(parts)
unit_cell.merge_vertices()
unit_cell.remove_degenerate_faces()  # 追加
unit_cell.remove_duplicate_faces()    # 追加
unit_cell.fix_normals()                # 追加
```

## 期待される結果

- 重複エッジ: 700,071本 → < 10,000本（目標）
- 結合部の太さ: `strut_radius × 8` → `strut_radius × 2`相当
- 視覚的品質: 滑らかな結合部

## 確認事項

- [x] 中心球が正しく生成される
- [ ] ストラットが球の表面までに短縮される（現状 `strut_length = direction_length`）
- [x] シリンダーの分割数が16になっている
- [ ] クリーンアップ処理が追加されている（`create_3d_xcell_unit` の通常経路で明示的な `remove_*_faces` は未確認）
- [x] 既存の回転行列計算関数（`rotation_matrix_from_vectors`）が使用されている
