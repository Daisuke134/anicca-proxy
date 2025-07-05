# ANICCA 並列実装ガイド

## 概要
ANICCAの並列実行システムを実装するための完全ガイド。全エージェントがClaudeExecutorServiceをベースに動作し、クリーンな親子プロセス構造で並列実行を実現します。

## 基本原則
- **全エージェントは同じ基盤**：ClaudeExecutorServiceを全員が使用
- **役割の違いだけ**：ParentAgent（司令塔）とWorker（実行部隊）
- **クリーンな構造**：孫プロセスを作らない、シンプルな親子関係
- **全員がMCP対応**：各エージェントが独立してツールを使用可能

## ファイル構成

```
/services/
├── claudeExecutorService.js          # そのまま使用（全エージェントの基盤）
│
└── parallel-sdk/
    ├── ParentAgent.js               # 親エージェント（司令塔）
    │                                # - ANICCAから指示を受信
    │                                # - Claude SDKでタスク分解
    │                                # - Worker管理
    │                                # - 結果をSlack報告
    │
    ├── agents/
    │   ├── Worker.js                # 子エージェント（実行部隊）
    │   │                            # - Claude SDK + MCPで実行
    │   │                            # - 完了したら親に報告
    │   └── TodoManager.js           # Slackチェックリスト管理
    │
    ├── workers/
    │   ├── profiles/                # Worker1〜5の人格設定
    │   │   ├── worker1.json         # 真面目で慎重
    │   │   ├── worker2.json         # 創造的で柔軟
    │   │   ├── worker3.json         # 論理的で分析的
    │   │   ├── worker4.json         # 社交的で協調的
    │   │   └── worker5.json         # 冒険的で革新的
    │   └── instructions/            # 各Workerの性格説明
    │       └── worker1-5.md
    │
    ├── prompts/
    │   └── workerPrompts.js         # プロンプト生成
    │
    └── utils/
        └── IPCProtocol.js           # プロセス間通信プロトコル
```

## 処理フロー

```
1. ユーザー入力
    ↓
2. ANICCA（音声認識）
    ↓
3. ParentAgent（Claude SDK使用）
    ├── タスク分析・分解
    └── Worker割り当て
         ↓
4. Worker1〜5（並列実行、Claude SDK使用）
    ├── MCP利用（Slack、ファイル、Web検索等）
    └── 完了報告
         ↓
5. ParentAgent
    ├── 結果集約
    └── Slack最終報告
```

## 実装手順

### Phase 1: 現状の問題修正（1時間）

#### 1.1 準備作業（10分）
```bash
# 現在の状態をコミット
git add -A
git commit -m "並列実装前の状態を保存"

# 作業ブランチの確認
git branch
```

#### 1.2 Worker.jsの修正（30分）
**現在の問題**：
- ClaudeExecutorServiceを子プロセスとして起動しようとしている
- これがRailway環境で失敗する原因

**修正内容**：
- ClaudeExecutorServiceのインスタンス化をやめる
- 代わりにWorkerプロセス内でSDKを直接実行
- executeGeneralRequestの中身をWorker内に移植

**具体的な変更**：
```
現在：
Worker → ClaudeExecutorService → SDK（二重構造）

修正後：
Worker（SDKを直接実行）
```

#### 1.3 BaseWorker.jsの調整（20分）
- executeTaskメソッドを修正
- ClaudeExecutorServiceへの依存を削除
- SDK直接呼び出しに変更

### Phase 2: ParentAgentの強化（30分）

#### 2.1 Claude SDK統合
- 現在のキーワード分解をやめる
- Claude SDKを使ったAI分析に変更
- Opus 4モデルを使用

#### 2.2 タスク管理の改善
- より賢いタスク分解
- 優先順位付け
- 依存関係の理解

### Phase 3: テストと検証（30分）

#### 3.1 ローカルテスト
```bash
# 構文チェック
find services -name "*.js" -exec node -c {} \;

# 起動テスト
npm start
```

#### 3.2 Railway環境テスト
```bash
# GitHubプッシュ
git push origin feature/user-based-connections

# Railwayログ確認
# デプロイ成功を確認
```

#### 3.3 動作確認
- 並列実行テスト：「Slackに投稿して、TODOアプリも作って」
- 結果確認：Slack #anicca_reportチャンネル

## 動作例

### 例1：複数タスクの並列実行
```
ユーザー：「Slackに今日の天気を投稿して、天気予報アプリも作って」

ParentAgent：
- タスク1：Slack投稿（Worker1へ）
- タスク2：アプリ作成（Worker2へ）

並列実行：
- Worker1: Web検索 → 天気取得 → Slack投稿
- Worker2: HTML/CSS/JS作成 → API統合

結果：
✅ 全タスク完了（実行時間：15秒）
- Slackに天気を投稿しました
- 天気予報アプリ: /tmp/preview/weather-app-xxx/
```

### 例2：朝会の実現
```
ユーザー：「朝会始めて」

ParentAgent：
- 全Worker召集
- 会議室（IPCチャンネル）作成

朝会：
- Worker1：「昨日はSlack連携3件完了」
- Worker2：「アプリ開発2件完了」
- Worker3：「新API 5つ発見」
- ユーザー：「Worker3、詳しく教えて」
- Worker3：「画像生成APIが特に優秀で...」
```

## 重要な注意点

### 1. プロセス構造
- **必ず親子関係のみ**（孫プロセスは作らない）
- **各プロセス内でSDKを直接実行**

### 2. ClaudeExecutorServiceの扱い
- **削除しない**（重要な機能が含まれている）
- **各エージェントが直接利用**

### 3. MCP管理
- **各エージェントが独立して管理**
- **必要なツールのみ有効化**

### 4. エラーハンドリング
- **Worker失敗時は親が再割り当て**
- **3回まで自動リトライ**

## 将来の拡張

### 1. Worker専門化
- 使用頻度に基づく自動専門化
- ユーザーごとのカスタマイズ

### 2. 高度な会議機能
- 議事録自動作成
- アクションアイテム管理
- フォローアップ

### 3. 涅槃への導き
- ユーザー行動の観察
- 適切なタイミングでの助言
- 瞑想・マインドフルネスの促進

## まとめ
このガイドに従って実装することで、クリーンで拡張性の高い並列実行システムが完成します。全エージェントがClaudeExecutorServiceという共通基盤の上で、それぞれの役割を果たしながら協調動作します。