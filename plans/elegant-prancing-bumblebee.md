# 開発環境の安定化 — エラー頻発の根本対策

## Context（なぜこの変更をするか）

今セッションで「Failed to fetch」「HDR読込失敗」「ポート占有でサーバー起動不可」など複数のエラーが連続して発生した。調査の結果、これは **1つのバグではなく、種類の異なる構造的問題が重なった** ことが原因と判明した。特に開発体験を毎回壊しているのは以下:

1. **バックエンドのポート番号がプロジェクト内で3分裂**（8000 / 8001 / 8010）。起動手段によってフロントの接続先とバックエンドの待受ポートがズレ、全API呼び出しが `Failed to fetch` で失敗する。
2. **`start.vbs` がウィンドウ非表示（style 0）で `uvicorn --reload` を起動** → リロード用の子プロセスが孤児化してポートを握り続ける → 次回起動時に「ポート占有」で失敗。ポート占有トラブルの真因。
3. **App Router にエラーバウンダリが皆無** → 未捕捉例外で画面が白くクラッシュし、原因が分からない。
4. **`.env.example` 不在**（フロント・バック両方）→ 新環境セットアップ時に必要な環境変数キーを取りこぼす。

目的: これら「毎回起きる構造的原因」を潰し、`git clone → 起動` が一発で通り、失敗しても原因が画面に見える状態にする。

**ユーザー決定事項**: バックエンドポートは **8000 に統一**（プロジェクト本来のデフォルト）。今セッションで応急的に入れた 8010 は巻き戻す。対策範囲は **最重要の固めのみ**。

---

## スコープ外（今回はやらない）
- HDR環境マップのセルフホスト（既に `EnvironmentErrorBoundary` で対処済み、クラッシュはしない）
- Google Fonts のビルド時オフラインフォールバック
- `api.ts` のエラー処理の全面統一 / トースト通知システム導入
- Supabase 接続の `!` 非null断定の改善
- Supabase 自動一時停止の恒久対策（後述の運用メモで代替）

これらは別タスクとして提案のみ。

---

## 変更内容

### 1. バックエンドポートを 8000 に一本化

散在している 8001 / 8010 をすべて **8000** に揃える。

| ファイル | 現状 | 変更後 |
|---|---|---|
| `frontend/next.config.ts:3` | フォールバック `http://localhost:8001/api/v1` | `http://localhost:8000/api/v1` |
| `frontend/.env.local:1` | `...:8010/api/v1`（今セッションの応急変更） | `...:8000/api/v1` |
| `.claude/launch.json:7-8` | uvicorn `--port 8010`, `"port": 8010` | `--port 8000`, `"port": 8000` |
| `start.vbs:5` | 既に 8000（下記2で別途修正） | 8000 維持 |
| `backend/main.py:49` | 既に `PORT` 既定 8000 | 変更不要 |

- ドキュメント（`AGENTS.md:97`, `.agent/workflows/dev-server.md`）の 8001/8000 記述も 8000 に統一し、矛盾を消す。
- `next.config.ts` の rewrites は「フロントが相対 `/api/v1` を叩いた時のプロキシ先」なので、`.env.local` 未設定時でも 8000 に飛ぶよう整合させる。

### 2. ゾンビプロセス対策（ポート占有の真因を断つ）

`start.vbs` を修正 + 停止スクリプト追加。

- **`start.vbs`**: `uvicorn --reload` の子プロセス孤児化を防ぐため、ウィンドウ非表示（`0`）ではなく**最小化表示（`7`）**で起動し、プロセスを見える・閉じられる状態にする。合わせてポート 8000 を明示。
- **`stop.vbs`（新規）** または `stop.ps1`: 起動中の 8000/3000 の LISTEN プロセスを安全に停止するワンクリックスクリプト。占有状態からの復旧手段を用意（今セッションで手動 `taskkill` した作業をスクリプト化）。
- 代替案として、開発は `.claude/launch.json`（Claude Code 経由）または `stop → start` の手順に一本化することを README に明記。

### 3. App Router グローバルエラーバウンダリ追加

`frontend/src/app/` に以下を新規作成（Next.js 標準の規約ファイル）:

- **`error.tsx`**: ページ単位の未捕捉例外を捕捉し、「エラーが発生しました + 再試行ボタン + エラー概要」を表示。`reset()` で再レンダリング。
- **`global-error.tsx`**: ルートレイアウトごと落ちた場合の最終フォールバック。
- 既存の日本語UIトーン（`LoginPage.tsx` 等）に合わせた最小限の表示。新規スタイルシステムは作らず既存の Tailwind + `Button` コンポーネントを再利用。

これにより「白画面クラッシュ」が「原因の見える画面」に変わる。

### 4. `.env.example` 整備

新環境セットアップでのキー取りこぼしを防ぐ。値はダミー、キー名と用途コメントのみ。

- **`frontend/.env.example`（新規）**: `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **`backend/.env.example`（新規）**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- **`frontend/.gitignore` に例外追加**: 現状 `.env*`（34行）で `.env.example` も除外されるため、`!.env.example` を追記してコミット可能にする。（`backend/.env.example` は `backend/.env` のみ ignore なので対応不要）

### 5. 運用メモ（Supabase 自動一時停止）

コードではなくドキュメント対応。`README.md` または `CLAUDE.md` に「Supabase無料プランは一定期間未使用で INACTIVE になり、`Failed to fetch` の原因になる。復旧は Supabase ダッシュボード（またはMCP `restore_project`）」と明記。今回の原因#1の再発時に即座に切り分けられるようにする。

---

## critical files

**修正:**
- `frontend/next.config.ts`（ポート 8001→8000）
- `frontend/.env.local`（8010→8000）
- `.claude/launch.json`（8010→8000）
- `start.vbs`（ウィンドウ表示 0→7、ポート明示）
- `frontend/.gitignore`（`!.env.example` 追加）
- `AGENTS.md`, `.agent/workflows/dev-server.md`（ポート記述統一）
- `README.md` or `CLAUDE.md`（起動手順一元化 + Supabase 運用メモ）

**新規:**
- `frontend/src/app/error.tsx`
- `frontend/src/app/global-error.tsx`
- `frontend/.env.example`
- `backend/.env.example`
- `stop.vbs`（or `stop.ps1`）

**変更しない（Protected Zone）:**
- `core/geometry_v4_frontend.py`、`frontend/src/components/steps/` は本対策では触らない。

---

## 実装担当: Codex 委託

本プランは複数ファイルにまたがる定型変更のため、実装は `mcp__codex__codex` に委託する（作業分担ルール準拠）。Claude は Codex への指示出し・成果物レビュー・統合・動作確認を担当。

Codex へは以下を明示して渡す:
- Protected Zone（`core/geometry_v4_frontend.py`, `frontend/src/components/steps/`）には触れないこと
- ポートは 8000 に統一（8001/8010 を全廃）
- 上記「変更内容 1〜5」「critical files」をそのまま作業指示とする
- 完了後、下記 Verification をレビュー観点として使う

---

## Verification（動作確認手順）

1. **ポート整合の確認**: 全ファイルを grep して `8001` / `8010` がバックエンド参照として残っていないこと（`grep -rn "800[01]\|8010" --include=*.ts --include=*.vbs --include=*.json --include=*.py --include=*.md`）。
2. **一発起動テスト**: `.claude/launch.json` で Backend(8000)+Frontend(3000) を起動 → ブラウザで `http://localhost:3000` → コンソールエラーなし。
3. **API疎通**: ブラウザから `fetch('http://localhost:8000/api/v1/')` が 404（＝到達OK）を返すこと。generate-insole を実リクエストして task 完了 → GLB ダウンロードまで通ること（今セッションと同じ手順を 8000 で再現）。
4. **エラーバウンダリ**: 意図的に例外を投げるか、バックエンド停止状態で操作 → 白画面ではなく `error.tsx` のフォールバックUIが出ること。
5. **ゾンビ対策**: `start.vbs` 起動 → `stop.vbs` で 8000/3000 が解放されること（`netstat -ano | grep LISTENING` で確認）。
6. **.env.example**: `frontend/.env.example` が `git status` に現れる（ignore されていない）こと。
