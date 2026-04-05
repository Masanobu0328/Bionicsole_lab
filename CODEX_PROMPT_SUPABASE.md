# Codex タスク: Supabase統合実装

## はじめに必ず読むこと

以下のファイルを順番に読んでから実装を開始すること：
1. `RULES.md`
2. `AGENTS.md`
3. `SUPABASE_IMPL_SPEC.md` ← 今回の実装仕様書

---

## タスク概要

Bionic Sole Lab（MasaCAD）にSupabase認証・データベース連携を実装する。

Supabase側（プロジェクト作成・テーブル・RLS・ストレージ）は**すでに完了済み**。
今回はフロントエンドとバックエンドのコードを実装するだけでよい。

---

## 実装するフェーズ

`SUPABASE_IMPL_SPEC.md` の以下のフェーズをすべて実装すること：

- **Phase 1**: フロントエンド認証（Supabase Auth ログイン画面）
- **Phase 2**: バックエンド認証（JWT検証 + Supabaseクライアント）
- **Phase 3**: Save/Load のSupabase移行（localStorageからDB）
- **Phase 4**: ファイルストレージ移行（GLB/STLをSupabase Storageにアップロード）

---

## ローカル開発環境の設定

### バックエンド用 `.env` ファイルを作成すること

`backend/.env` を新規作成（gitignoreに追加済みか確認）：

```
SUPABASE_URL=https://owunqmyphmulwpdmpcci.supabase.co
SUPABASE_SERVICE_ROLE_KEY=（ユーザーが別途設定する）
```

`backend/main.py` の先頭に以下を追加して `.env` を読み込む：

```python
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent / ".env")
```

`requirements.txt` に `python-dotenv` を追加。

### フロントエンド環境変数

`frontend/.env.local` に追記（`SUPABASE_IMPL_SPEC.md` に記載のキーを使用）。

---

## 重要な制約（必ず守ること）

1. **`core/geometry_v4_frontend.py` は変更しない**（今回のタスクに不要）
2. **`core/geometry_v4.py` は絶対に変更しない**
3. **既存のAPIエンドポイントのシグネチャを変更しない**
4. **print文に絵文字を使わない**（Windows cp932エンコーディングエラーになる）
5. **バックエンドの認証は最初はオプション**にすること（既存機能を壊さないため）
   - `Authorization` ヘッダーがない場合はそのまま動作させる
   - 認証必須化は動作確認後に別途指示する
6. **`SUPABASE_SERVICE_ROLE_KEY` は `.env` ファイルにのみ書く**（コードにハードコードしない）

---

## 完了条件

以下がすべて動作すること：

- [ ] `http://localhost:3000` を開くとログイン画面が表示される
- [ ] メールアドレス＋パスワードでサインアップ・ログインできる
- [ ] ログイン後、既存の7ステップUIが通常通り動作する
- [ ] 「Save Project」ボタンでSupabaseの `insole_designs` テーブルにデータが保存される
- [ ] インソール生成後、GLB/STLがSupabase Storageにアップロードされる
- [ ] ログアウトボタンが動作する

---

## 不明点がある場合

実装前に計画を提示し、確認を求めること。
特に以下の場合は必ず確認：
- `core/` ディレクトリに触れる必要がある場合
- 仕様書に記載のない変更が必要な場合
- 3ファイル以上の同時変更になる場合
