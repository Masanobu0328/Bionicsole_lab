# 画像から足輪郭を自動抽出する機能（CSV入力廃止を含む）

## Context

現状、足輪郭は CSV アップロード or `OutlineEditorCanvas` 上でのドラッグ編集で入力している。
ユーザー要望は「紙に写した足輪郭を写真撮影 → 画像をアップロード → 自動で輪郭点列を生成」。
紙にはガイド線（補助線）も書かれているため、それに惑わされず **外形だけ** を、なめらかな曲線で抽出する必要がある。

これを機に、入力経路を「画像のみ」に一本化し、**CSV 関連コードはすべて削除する**。
画像未アップロード時は編集 UI には輪郭を表示せず「画像をアップロードしてください」というプレースホルダのみ表示する。

期待効果:
- CSV を作る運用が不要になり、写真 1 枚で初期輪郭が手に入る
- 入力経路が 1 つになり、UI/コード/テストがシンプルになる
- 抽出後は既存の編集 UI で微修正できるため、品質はユーザーが最終担保

## 採用方針（ユーザー確認済み）

| 項目 | 決定 |
|------|------|
| スケール基準 | フロント既存の `targetLengthMm`（足長 mm）で抽出後に正規化 |
| 処理場所 | バックエンド（FastAPI + scikit-image） |
| 結果反映 | `outlinePoints` を上書き → `OutlineEditorCanvas` で微修正 |

## 実装内容

### 1. バックエンド: 新規エンドポイント `POST /api/v1/extract-outline`

ファイル: `api/main.py`（既存 FastAPI）に追加

入力（multipart/form-data）:
- `image`: 画像ファイル（jpg/png/heic→jpg 変換は後回し）
- `target_length_mm`: float（足長 mm。フロントの `targetLengthMm` を送る）
- `num_points`: int（既定 120。粗/細ボタンと整合）

出力（JSON）:
```json
{
  "outline_points": [{"x": 0.0, "y": 12.3}, ...],   // 閉曲線、mm
  "preview_png": "data:image/png;base64,..."        // 抽出輪郭を画像に重ねたデバッグ用（任意）
}
```

### 2. 抽出パイプライン（scikit-image / numpy / scipy）

新規モジュール: `core/outline_extract.py`（コア領域だが新規ファイルのため Protected Zone 影響なし。`geometry_v4_frontend.py` 等は触らない）

処理ステップ:
1. **読み込み** — `PIL.Image.open` → `numpy` 配列、長辺 1500px 程度に縮小
2. **グレースケール + ぼかし** — `skimage.color.rgb2gray` → `skimage.filters.gaussian(sigma=2)`
3. **二値化** — `skimage.filters.threshold_otsu` で閾値、暗い線を前景に
4. **クロージング + 内部塗りつぶし** — `skimage.morphology.binary_closing`（小ギャップ補完） → `scipy.ndimage.binary_fill_holes`（外形の内部を塗る）。ガイド線は閉曲線でないため塗られず、外形のみ大領域として残る
5. **連結成分から最大領域を抽出** — `skimage.measure.label` → `regionprops` で最大面積の領域を選択
6. **外周輪郭抽出** — その領域マスクに `skimage.measure.find_contours(level=0.5)` を適用 → 最長輪郭を採用（外周）
7. **スムージング** — 周期境界の Gaussian 1D（`scipy.ndimage.gaussian_filter1d(..., mode="wrap")`、x/y 別々、sigma=3〜5）でトゲを除去
8. **均等リサンプリング** — 弧長累積でパラメータ化し `num_points` 点に等間隔で再サンプル
9. **スケール正規化** — 抽出輪郭の x 範囲（足の長さ方向）を `target_length_mm` に合わせて拡大縮小。座標系は既存の `parseOutlineCsv` と整合（x_mm, y_mm、踵→つま先）
10. **向き合わせ** — PCA 主軸を x 軸に揃え、踵側（曲率半径大）が x=0 になるように反転判定

### 3. 依存関係

`requirements.txt` に追加:
- `Pillow>=10.0.0`（画像読み込み。scikit-image の依存で入っている可能性大、明示追加）

scikit-image / scipy / numpy は既に存在。

### 4. CSV 関連コード削除

事前に Grep で全洗い出ししてから削除する。少なくとも以下を対象とする:

- `frontend/src/components/steps/OutlineEditorCanvas.tsx`
  - `DEMO_OUTLINE_CSV` 定数および参照箇所（行 206 付近）
  - CSV 読み込みボタン、ファイル input、関連 state/handler
- `frontend/src/lib/geometry-utils.ts`
  - `parseOutlineCsv()`（行 261-304）
  - 「粗/細」ボタンが CSV 前提の場合は「点数」入力に置き換え or 削除
- `api/main.py` 周辺
  - 輪郭 CSV ファイルを読み込むロジック（行 228-254 付近の CSV 読み込み分岐）。`InsoleParams.outline_points` を必須化し、CSV パスは廃止
- バックエンド側に CSV パーサ（pandas で読んでいる箇所等）があれば併せて削除
- `tests/` および `samples/` 内の CSV 依存テスト・サンプルは画像ベースに置き換え。残せない場合は削除

DB スキーマ（`foot_outlines` テーブル）は `{x,y}` 配列保存で CSV 非依存のため変更不要。

### 5. 初期表示の挙動

- `OutlineEditorCanvas` は `outlinePoints.length === 0` の場合、SVG キャンバス内に「画像をアップロードして輪郭を抽出してください」と中央表示
- 「画像から輪郭を抽出」ボタンのみ操作可能、編集系操作は disabled
- 抽出成功後に通常表示へ切り替わる
- これにより「画像抽出が必須ステップ」という UX を強制する

### 6. フロントエンド（画像抽出 UI）

#### a) API クライアント追加 — `frontend/src/lib/api.ts`（**Protected Zone**、追加のみ・既存関数の改変なし）
```ts
export async function extractOutlineFromImage(file: File, targetLengthMm: number, numPoints = 120): Promise<{outline_points: {x:number;y:number}[]}>
```
multipart/form-data で `/api/v1/extract-outline` を叩く。

#### b) UI トリガー追加 — `frontend/src/components/steps/OutlineEditorCanvas.tsx`（**Protected Zone**）
既存の「画像オーバーレイ」ボタン群の隣に「画像から輪郭を抽出」ボタンを 1 つ追加。
- 押下時: ファイル選択 → `extractOutlineFromImage()` → 戻り点列を `setOutlinePoints()` に流し込み
- 上書き前に `confirm("既存の輪郭を上書きします。よろしいですか？")` を出す
- ローディングインジケータ表示

**Protected Zone への変更となるため、core-guard 承認フローに従う。** 変更は最小限（API 呼び出し関数 1 個 + ボタン 1 個 + ハンドラ 1 個）に留める。

### 7. 影響ファイル一覧

| ファイル | 変更種別 | Protected Zone |
|----------|----------|---------------|
| `api/main.py` | エンドポイント追加 + CSV 読込ロジック削除 | No |
| `core/outline_extract.py` | 新規 | No（新規ファイル） |
| `requirements.txt` | Pillow 追記 | No |
| `frontend/src/lib/api.ts` | 関数追加 | **Yes** |
| `frontend/src/lib/geometry-utils.ts` | `parseOutlineCsv` 削除 | No |
| `frontend/src/components/steps/OutlineEditorCanvas.tsx` | CSV系削除 + 抽出ボタン + プレースホルダ | **Yes** |
| `tests/`, `samples/` 内の CSV 依存物 | 画像ベースに置き換え/削除 | No |

`core/geometry_v4_frontend.py`、`core/landmarks.py` は変更しない。

## 検証方法

1. **単体テスト** — `tests/test_outline_extract.py`
   - サンプル画像（紙に手描き足型 + ガイド線あり）数枚を `tests/fixtures/` に置く
   - 抽出点列が「閉曲線・点数 = num_points・x 範囲が target_length_mm に一致」を assert
   - ガイド線が無視されること（点列の凸包面積が想定範囲）を assert
2. **回帰** — 既存 CSV 入力フローへの影響がないことを `regression-test` skill で確認
3. **E2E（手動）** — `cd frontend && npm run dev` → 画像アップロード → 抽出 → 既存編集 UI でドラッグ可能なことを確認 → メッシュ生成まで一気通貫で走らせる
4. **エッジケース確認** — 影が強い画像、紙が傾いている画像、ガイド線が外形に接触している画像で挙動を見る

## 想定リスクと対策

| リスク | 対策 |
|--------|------|
| ガイド線が外形に接触し外形と一体化 | クロージング前にエッジ検出のみ抽出してから内部塗りつぶし。最終的に「閉曲線でない線分は無視」される塗りつぶし戦略で大半解決 |
| 紙の影で外形が誤検出 | sigma 大きめのガウシアン + Otsu。ダメなら `threshold_local`（適応閾値）にフォールバック |
| 足の向き（左右・前後）が逆 | PCA 主軸合わせ + 踵側判定。ダメな場合は UI に「左右反転」ボタンを追加（既存の編集 UI で対応可） |
| 大きい画像で処理重い | 長辺 1500px に縮小してから処理 |

## 実装担当

本実装は **Codex に委託**（`mcp__codex__codex`）。Claude Code は本計画書を仕様としてCodexに渡し、成果物のレビュー・統合・Protected Zone 変更の最終確認を担当する。

## 段階リリース案

1. **Phase A**（最小）: バックエンド実装 + フロント簡易ボタン。プレビュー画像なし、上書きのみ
2. **Phase B**（任意）: プレビュー画像オーバーレイで抽出結果確認、左右反転 UI、複数候補から選択
