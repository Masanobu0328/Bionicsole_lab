# 引き継ぎ情報：MasaCAD フロントエンド開発 - Next.jsプロジェクト初期化

**作成日**: 2026-01-20  
**状況**: Next.jsプロジェクト初期化で停止中

---

## 1. プロジェクト概要

### 目的
既存のPython製インソール生成ロジック（`core/geometry_v4.py`など）をFastAPIバックエンドとして再利用し、Next.js (React) を用いてプロフェッショナルなWebベースのフロントエンドUIを新規開発する。

### 技術スタック（決定済み）
- **フロントエンド**: Next.js (App Router), TypeScript, Tailwind CSS
- **UIコンポーネント**: shadcn/ui (Radix UI)
- **3D描画**: React Three Fiber (three.js), drei
- **状態管理**: Zustand (クライアント状態), React Query (サーバー状態)
- **バックエンド**: FastAPI（既存のPythonロジックをAPI化）

---

## 2. 現在の進捗状況

### 完了済み
- ✅ フロントエンドの初期設計書 `FRONTEND_DESIGN_SPEC.md` を作成済み（ユーザー承認済み）
- ✅ 技術選定（Next.js + FastAPI）で合意済み

### 停止箇所
**ToDoリストの2番目「Next.jsプロジェクトを初期化する」の段階で停止**

---

## 3. 直面している問題

### 問題の詳細
`npx create-next-app@latest frontend --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"` コマンドを実行しようとしたが、Next.jsプロジェクト作成ツール（create-next-app）が応答を返さず、処理が停止してしまう。

### 原因
Next.jsのツールが最近「React Compilerを使いますか？」という新しいインタラクティブなプロンプトを追加した。`--yes` オプションでもこのプロンプトに対応できず、コマンドがタイムアウト（時間切れ）になる事態が繰り返し発生している。

### 試行したコマンド
```bash
npx create-next-app@latest frontend --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
```

### 現在の状態
- `frontend/` ディレクトリは**まだ作成されていない**
- プロジェクトの初期化は**完了していない**

---

## 4. 推奨される解決策

### アプローチ：手動セットアップ
`create-next-app`ツールを迂回し、手動でNext.jsプロジェクトの基盤を構築する。

### 具体的な手順

#### ステップ1: ディレクトリ作成
```bash
mkdir frontend
cd frontend
```

#### ステップ2: package.jsonの作成
必須の依存関係を記述した `package.json` を作成：
- `next` (最新版)
- `react`, `react-dom`
- `typescript`
- `@types/node`, `@types/react`, `@types/react-dom`
- `tailwindcss`, `postcss`, `autoprefixer`
- `eslint`, `eslint-config-next`

#### ステップ3: 依存関係のインストール
```bash
npm install
# または
yarn install
```

#### ステップ4: 設定ファイルの作成
- `next.config.mjs` - Next.jsの設定
- `tsconfig.json` - TypeScriptの設定
- `tailwind.config.ts` - Tailwind CSSの設定
- `postcss.config.mjs` - PostCSSの設定
- `.eslintrc.json` - ESLintの設定

#### ステップ5: 基本的なディレクトリ構造の作成
```
frontend/
├── src/
│   └── app/
│       ├── layout.tsx
│       ├── page.tsx
│       └── globals.css
├── public/
└── ...（設定ファイル）
```

### この方法の利点
- インタラクティブなプロンプトに阻害されない
- 必要な設定のみを確実に含められる
- プロジェクト構造を完全に制御できる

---

## 5. 次のステップ（初期化後の予定）

初期化が完了したら、以下の順序で進める：

1. **shadcn/uiのセットアップ**
   - `npx shadcn-ui@latest init`
   - 必要なコンポーネントを追加

2. **デザインテーマの適用**
   - `FRONTEND_DESIGN_SPEC.md` に記載のカラーパレット（青緑系）を適用
   - ライト/ダークモード対応

3. **3Dライブラリの導入**
   - React Three Fiber (`@react-three/fiber`)
   - drei (`@react-three/drei`)

4. **基本的なレイアウトコンポーネントの作成**
   - Header（患者名、保存ボタン、Undo/Redo、ライト/ダーク切替）
   - Sidebar（パラメータ調整スライダー）
   - Main Content（3Dビューア領域）

5. **基礎的な3DシーンとCADライクなカメラコントロールの実装**

---

## 6. 関連ドキュメント

- **`FRONTEND_DESIGN_SPEC.md`** - フロントエンドの詳細設計書（承認済み）
  - デザインシステム（カラーパレット、タイポグラフィ）
  - アプリケーションレイアウト
  - 主要機能とコンポーネント
  - ディレクトリ構造
  - API連携仕様（ドラフト）

- **`TODO.md`** - プロジェクト全体のタスク管理
- **`README.md`** - プロジェクト概要（既存のPython実装について）

---

## 7. 注意事項

- **`core/` ディレクトリは変更禁止**（既存のPythonロジック）
- フロントエンドは `frontend/` ディレクトリに新規作成
- バックエンドAPI（FastAPI）は別途実装が必要（現時点では設計書に記載のみ）

---

## 8. 技術的な補足

### Next.jsのバージョン
最新の安定版を使用（2026年1月時点）

### プロジェクト構造
`--src-dir` オプションを使用するため、`src/app/` ディレクトリ構造で作成する。

### インポートエイリアス
`@/*` を `src/*` にマッピングする設定が必要。

---

**引き継ぎ完了** - 次の担当者は上記の手動セットアップ手順に従って、Next.jsプロジェクトの初期化を完了してください。
