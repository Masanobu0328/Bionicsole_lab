---
description: ローカル開発サーバーの起動手順（バックエンド + フロントエンド）
---

# ローカル開発サーバー起動

## ポート設定（固定）
- **バックエンド (FastAPI):** `http://localhost:8000`
- **フロントエンド (Next.js):** `http://localhost:3000`

## 起動手順

### 1. ポート 3000 と 8000 を使っているプロセスがあれば停止する
```powershell
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
```
// turbo

### 2. ロックファイルが残っていれば削除する
```powershell
Remove-Item -Force "c:\Users\masan\Desktop\insole-ai-design\masacad\frontend\.next\dev\lock" -ErrorAction SilentlyContinue
```
// turbo

### 3. バックエンド起動（ポート 8000）
```powershell
python backend/main.py
```
- 作業ディレクトリ: `c:\Users\masan\Desktop\insole-ai-design\masacad`
- 起動確認メッセージ: `Uvicorn running on http://0.0.0.0:8000`

### 4. フロントエンド起動（ポート 3000）
```powershell
npm run dev
```
- 作業ディレクトリ: `c:\Users\masan\Desktop\insole-ai-design\masacad\frontend`
- 起動確認メッセージ: `Ready in Xs`
- ポート 3000 は `package.json` の `dev` スクリプトで `-p 3000` として固定済み

### 5. ブラウザで確認
- `http://localhost:3000` を開く

## 環境変数
- ローカル開発: `.env.local` → `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1`
- 本番 (Vercel): `.env.production` → `NEXT_PUBLIC_API_BASE_URL=https://web-production-339a7.up.railway.app/api/v1`

## 注意事項
- バックエンドを先に起動してからフロントエンドを起動すること
- ポート 3000 が占有されている場合は、既存の node プロセスを停止してから起動すること
