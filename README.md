# Morning Brief

毎朝、日本株・円金利・マクロのブリーフを自動生成して静的サイトで公開する。
対象読者は3ペルソナ(日本株HFアナリスト / 円金利トレーダー / 日本株ストラテジスト)。

## セットアップ

```bash
npm install
npm install --prefix site

cp .env.example .env
# .env を開き DEEPSEEK_API_KEY=sk-... を記入する(.env は git 管理外)
```

## まず動かす

```bash
# APIを使わないデモ。パイプラインが通ることの確認用(無料・数秒)
npm run demo

# フィードの疎通確認。FAIL が出たら sources.yaml を直す
npm run check:feeds

# 実データ + 実API。まず2本だけで様子を見るのを推奨(課金あり)
npm run try -- --articles 2

# 問題なければ全10本
npm run try
```

## 日常の実行

```bash
npm run daily        # 収集 → 生成 → 検証 → content/<日付>.json
npm run build        # サイトをビルド(Astro + Pagefind)
npm run preview      # ローカルで表示確認
```

## 主なコマンド

| コマンド | 内容 |
|---|---|
| `npm run demo` | API を使わずパイプライン全体を試す |
| `npm run daily` | 本番の生成。API を使う |
| `npm run try` | 疎通確認 → 生成 → サイトビルドを一括 |
| `npm run check:feeds` | 全フィードのHTTP疎通と件数を表示 |
| `npm run validate -- content/2026-07-24.json` | 生成物を単体で検証 |
| `npm test` | 検証ロジックのテスト(19件) |
| `npm run typecheck` | 型チェック |

## 構成

```
pipeline/          収集・生成・検証
  collect.ts       RSS/一次情報 → raw/
  generate.ts      DeepSeek 呼び出し → content/
  validate.ts      文字数・引用・スキーマ検証
  config.ts        モデル名・単価・制約値(変更はここだけ)
  sources.yaml     フィード一覧(追加・削除はここだけ)
  prompts/         システムプロンプト
input/manual/      週刊誌メモの置き場(任意)
content/           生成物。コミットしてアーカイブになる
site/              Astro サイト
.github/workflows/ 日次実行
```

## 記事の構成

各記事は3部構成(1日4本)。字数は機械検証され、満たさない記事は最大3回まで自動再生成される。

1. **要約** — 300字以内
2. **内容詳細** — 出典リンク付き。原文の転載は禁止、直接引用は1出典1箇所・80字以内
3. **拡張考察** — 2,000字以上。3ペルソナへの含意、今後の潮流、見落とされがちな論点

検証に通らなくても公開は止めず、該当記事に「品質注意」を表示する(朝6時の公開を優先)。

## 週刊誌メモ

`input/manual/` に `.md` を置くと、翌朝の生成時に考察へ織り込まれる。
ファイルが無い日は無視される。詳細は `input/manual/README.md`。

## 公開(Phase 3)

1. GitHub にリポジトリを作成し、このフォルダを push する(.env は自動で除外される)
2. リポジトリの Settings → Secrets and variables → Actions → New repository secret で
   `DEEPSEEK_API_KEY` を登録する
3. Cloudflare Pages で当該リポジトリを接続する。ビルド設定:
   - Root directory: `site`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - 環境変数: `NODE_VERSION` = `20`
4. Actions タブ → daily brief → Run workflow で手動実行し、一連の流れを確認する
5. 以後は cron(夏時間 JST5:30 / 冬時間 JST6:00)で毎朝自動実行される

## 費用

有料は DeepSeek API のみ。ホスティング・CI・検索・ブックマークは無料枠内。
実行のたびにトークン数と概算コストがログに出る。

## 注意

- API キーは `.env` と GitHub Secrets にのみ置く。チャットやコミットに貼らない
- 生成物は自動生成であり、投資助言ではない
- 数値・固有名詞は必ず出典を確認する
