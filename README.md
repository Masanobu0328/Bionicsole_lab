# MasaCAD - AI対応インソール生成システム

**trimesh + Plotly ベース | v4.3**

---

## 概要

MasaCADは、医療用インソールを自動生成する次世代CADシステムです。
足の輪郭データ（CSV）から3Dプリント可能なインソールメッシュを生成します。

### 主な特徴

- **高速メッシュ処理**: trimeshによる軽量な3D処理
- **直感的UI**: Streamlit + Plotlyでリアルタイム3Dプレビュー
- **3種類のアーチ**: 内側縦・外側縦・横アーチを独立制御
- **ラティス構造**: 3D X-Cellパターンで軽量化
- **AI対応**: パラメトリック設計でML学習に最適

---

## プロジェクト構成

```
masacad/
├── core/                    # コアエンジン
│   ├── geometry_v4.py       # メッシュ生成エンジン
│   ├── landmarks.py         # 解剖学的ランドマーク
│   ├── lattice.py           # ラティス構造
│   ├── xcell_3d.py          # 3D X-Cellラティス
│   └── validate.py          # メッシュ検証・修復
├── ui/
│   ├── app.py               # Streamlit UI
│   ├── patient_manager.py   # 患者データ管理
│   └── components/          # UIコンポーネント
├── patients/                # 患者データ（CSV輪郭）
├── exports/                 # 出力ファイル（STL/GLB）
├── TODO.md                  # タスク管理
└── requirements.txt
```

---

## クイックスタート

### 1. 環境構築

```bash
cd masacad
pip install -r requirements.txt
```

### 2. アプリ起動

```bash
streamlit run ui/app.py
```

ブラウザで http://localhost:8501 が開きます

### 3. 使い方

1. **輪郭CSVアップロード**: `x_mm, y_mm` 列を含むCSV
2. **パラメータ設定**: スライダーでアーチ高さ・位置等を調整
3. **生成実行**: ボタンをクリック
4. **3Dプレビュー**: Plotlyでリアルタイム表示
5. **エクスポート**: STL/GLBダウンロード

---

## 機能一覧

### 実装済み

- [x] CSV輪郭読み込み（スケーリング対応）
- [x] ベースメッシュ生成（Delaunay三角分割）
- [x] ヒールカップ（コサイン減衰で滑らか化）
- [x] 内側縦アーチ（S字カーブ補間）
- [x] 外側縦アーチ（S字カーブ補間）
- [x] 横アーチ（v4.3で実装）
- [x] STL/GLB出力
- [x] 3Dプレビュー（Plotly）
- [x] メッシュ検証・自動修復
- [x] 3D X-Cellラティス
- [x] 解剖学的ランドマーク定義

### 開発中

- [ ] ラティス外殻厚維持（オフセット処理）
- [ ] パラメータプリセット保存
- [ ] 他のラティスパターン（gyroid等）

### 計画中

- [ ] AI推論API統合
- [ ] 断面スライダ表示
- [ ] 高さマップカラー表示
- [ ] 3Dプリント最適化

詳細は [TODO.md](TODO.md) を参照してください。

---

## 依存ライブラリ

```
trimesh>=3.21.0
numpy>=1.24.0
scipy>=1.10.0
pandas>=2.0.0
streamlit>=1.28.0
plotly>=5.14.0
shapely>=2.0.0
```

---

## アルゴリズム概要

### 1. ベース生成
- 2D輪郭 → Delaunay三角形分割
- 底面・上面・側面を結合して閉じたメッシュ

### 2. ヒールカップ
- 踵中心に凹型構造
- コサイン減衰で境界を滑らか化

### 3. アーチ生成（v4.3）
- 3種類のアーチを独立制御
- S字カーブ（smoothstep）で滑らかな高さ遷移
- Y方向の適用範囲を自動設定

### 4. ラティス（3D X-Cell）
- ダイヤモンドパターンの3Dラティス
- ブーリアン演算でインソール形状にクリップ

---

## ドキュメント

| ファイル | 内容 |
|----------|------|
| [RULES.md](RULES.md) | AI共通ルール |
| [CLAUDE.md](CLAUDE.md) | Claude Code専用指示 |
| [AGENTS.md](AGENTS.md) | Codex専用指示 |
| [TODO.md](TODO.md) | タスク管理・進捗状況 |
| [ARCH_DESIGN_SPEC.md](ARCH_DESIGN_SPEC.md) | アーチ設計仕様 |
| [README_XCELL.md](README_XCELL.md) | ラティス構造仕様 |
| [GLOSSARY.md](GLOSSARY.md) | 用語集 |

---

## ライセンス

MIT License

---

**MasaCAD** - Next-Gen Insole CAD System

