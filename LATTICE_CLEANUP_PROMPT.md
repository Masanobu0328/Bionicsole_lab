# ラティス全体結合後のクリーンアップ追加 - Codexプロンプト

## タスク

`core/xcell_3d.py` の `apply_3d_xcell_lattice` 関数で、全体のラティスを結合した後にクリーンアップ処理を追加する。

## 変更箇所

**ファイル**: `core/xcell_3d.py`  
**関数**: `apply_3d_xcell_lattice`  
**行数**: 約617-618行目付近

## 現在のコード

```python
# 4. ラティスを結合
print(f"[3D-XCELL] Step 4: Merge lattice cells...")
lattice = trimesh.util.concatenate(all_parts)
lattice.merge_vertices()
```

## 修正後のコード

```python
# 4. ラティスを結合
print(f"[3D-XCELL] Step 4: Merge lattice cells...")
lattice = trimesh.util.concatenate(all_parts)
lattice.merge_vertices()
# 全体結合後のクリーンアップ（重複エッジ削減のため）
lattice.remove_degenerate_faces()
lattice.remove_duplicate_faces()
lattice.fix_normals()
```

## 説明

ユニットセル単体では既にクリーンアップが行われているが、全体を結合した後にも追加のクリーンアップが必要。これにより、ユニットセル同士の結合部分の重複エッジを削減できる。

## 注意事項

- `merge_vertices()` の直後に追加する
- 3行のメソッド呼び出しを追加するだけ（シンプルな修正）
- 既存のコードを壊さないように注意
