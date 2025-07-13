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
    │   └── BaseWorker.js            # Workerの基底クラス
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
3. ParentAgent（ClaudeExecutorService経由）
    ├── タスク分析・分解（executor.executeGeneralRequest）
    └── Worker割り当て
         ↓
4. Worker1〜5（並列実行、ClaudeExecutorService経由）
    ├── executor.executeGeneralRequest実行
    ├── 自動でMCP利用（Slack通知含む）
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

#### 1.2 ClaudeExecutorServiceの利用方法（30分）
**実装方針**：
- ClaudeExecutorServiceをインスタンス化（継承ではなく合成）
- 孫プロセスを作らない（同一プロセス内で実行）

**具体的な実装**：
```javascript
// ParentAgentとWorkerの両方で
constructor() {
  this.executor = new ClaudeExecutorService(database);
  this.executor.setSlackTokens(slackTokens);
}

// タスク実行時
async executeTask(request) {
  return this.executor.executeGeneralRequest({
    type: 'general',
    parameters: { query: request }
  });
}
```

**なぜインスタンス化か**：
- 継承より柔軟（複数のexecutorを持てる）
- 責任分離が明確
- 既存のClaudeExecutorServiceをそのまま活用

#### 1.3 BaseWorker.jsの調整（20分）
- executeTaskメソッドを修正してexecutor経由に
- SDK直接呼び出しを削除
- MCP設定とプロキシ設定を削除（executorに任せる）

### Phase 2: ParentAgentの強化（30分）

#### 2.1 ClaudeExecutorService統合
- analyzeAndDecomposeTasksをexecutor経由に変更
- SDK直接呼び出しを削除
- TodoManager関連を削除（ParentAgentが直接Slack通知）

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
- **各エージェントがインスタンス化して利用**
- **database引数は形式的に渡す（実際は使われない）**

### 3. MCP管理
- **ClaudeExecutorServiceが一元管理**
- **全エージェントが同じMCP設定を利用**
- **HTTP MCP、BrowserBase MCP、ElevenLabs MCPなど全て使用可能**

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