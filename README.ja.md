<div align="center">
  <img src="./dashboard/public/app-icon.png" width="96" height="96" alt="TokenTracker Plus Logo" />
  <h1>TokenTracker Plus (TT-plus)</h1>
  <p><strong>55 の AI コーディングツール・IDE を横断して、トークン消費・コスト・リアルタイム生成速度を可視化</strong></p>
  <p>
    <a href="./README.md">简体中文</a> · <a href="./README.zh-TW.md">繁體中文</a> · <a href="./README.en.md">English</a> · <b>日本語</b> · <a href="./README.ko.md">한국어</a> · <a href="./README.pt-BR.md">Português (BR)</a>
  </p>
</div>

> 💡 本リポジトリは [xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker)（MIT）をベースにした拡張フォークです。**100% ローカル優先**・**実勢に基づく課金計算**・**セッション階層の掘り下げ**・**リアルタイム tok/s 計測**を目的とします。上流の著作権は原作者に帰属し、本フォークも MIT で公開しています。

[✨ 主な特徴](#-主な特徴) · [⚡ クイックスタート](#-クイックスタート) · [💰 課金とヒートマップ](#-課金とヒートマップ) · [🔒 プライバシー](#-プライバシー) · [📜 使い方ガイド](./docs/getting-started.zh-CN.md) · [❤️ 応援する](./SPONSOR.md)

## ✨ 主な特徴

- 🔌 **ゼロ設定で 55 ツールに自動接続** —— Claude Code / Codex / Cursor / Qoder / Kimi など主要 55 ツールのローカルログを自動検出。ログイン不要、API キー不要、クラウド不要。
- 💰 **無料モデルも定価で計上** —— 上流の `-free` → 0 円ルールを拒否し、無料ルートも公式定価で評価。タダ乗りした価値がひと目でわかる。
- ⚡ **ミリ秒の tok/s ストリーム** —— チャンク単位の継続時間と推論トークンを分離し、セッション単位の生成速度を正確に計測。
- 🌲 **セッション階層を掘り下げ** —— メイン会話 / サブエージェント / ツール呼び出し単位で高コスト操作を特定。
- 📊 **Lv0〜Lv7 の 8 段階ヒートマップ** —— 1 日 30 億トークン超の「シンギュラリティ」階層を含む。2D / 3D 両対応。
- 🏆 **実績 65 種 + 称号 17 種を完全オフライン判定** —— Steam 風トースト、3D メダル、Canvas 戦績エクスポート。
- 🪟 **Windows デスクトップ統合** —— トレイ常駐・ペット・クォータ浮窗。インストーラーに Node 同梱でビルド不要。
- 🌍 **グローバルモデルボード（設定不要）** —— Artificial Analysis の公式ランキングを直接取得：80+ モデルの知能スコア・入出力/キャッシュ価格・コンテキスト・生成速度。API キー不要、ローカルキャッシュで自動更新。
- 🎁 **プロバイダー特典ガイド** —— 無料で使える 32 の AI サービスを一目で確認：新規付与額・毎日無料・長期有効額度・チェックイン特典をカテゴリ別／検索で一覧化。各カードに招待リンクと公式リンクの両方を搭載。
- 🔒 **100% ローカル** —— 記録するのは数値だけ。コードやプロンプトは保存も送信もされません。

## ⚡ クイックスタート

**Windows はビルド不要**：[Releases](https://github.com/01UNCLEDOG01/TokenTracker-plus/releases) から `TokenTracker-plus-Setup-v*.exe` をダウンロードしてインストールするだけです。初めての方は[はじめてのガイド](./docs/getting-started.zh-CN.md)（中国語）へ。

```bash
git clone https://github.com/01UNCLEDOG01/TokenTracker-plus.git
cd TokenTracker-plus
npm install
node bin/tracker.js   # 初回起動：Hook 自動設置 + 同期 + Dashboard オープン
node bin/tracker.js status   # 55 ツールの接続状態
node bin/tracker.js doctor   # 診断
```

ローカル Dashboard は `http://localhost:7680`。対応ツールの全リストは[中国語版 README](./README.md#-支持的-ai-工具列表55-款)を参照（CLI / VS Code 拡張 / IDE の 55 種）。

## 💰 課金とヒートマップ

`cost = Σ(tokens × 定価)`。LiteLLM 公式料金 + ローカル上書き設定。未公開価格のモデルは金額を捏造せずトークンのみ記録。ヒートマップは P30〜P95 の分位点 + Lv7（≥30 億トークン/日）の 8 段階。

## 🔒 プライバシー

数値（トークン数・タイムスタンプ・モデル名・推定金額）のみをローカルの `~/.tokentracker/` に記録。プロンプト・応答・コード本文は保存も送信もされません。Cookie やキーが必要なのは一部のクォータカードだけで、コア機能には不要です。WorkBuddy のクォータカード（2 版それぞれ）はデスクトップアプリの実行中にのみ読めます（プラン + 毎日の報酬クレジット）。

## 📄 ライセンス

MIT。上流 [xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker) に感謝。詳細は [中文版](./README.md) を参照してください。
