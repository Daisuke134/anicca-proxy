# ANICCA並列SDK 移行計画書

## 概要
現在の二重プロセス構造（Worker → ClaudeExecutorService → SDK）を、シンプルな構造（Worker内でSDK直接実行）に移行する計画書。

## 基本方針

### 重要な決定事項
1. **ClaudeExecutorServiceは削除しない**（そのまま使用）
2. **全エージェントがClaudeExecutorServiceの機能を使う**
3. **孫プロセスを作らない**（各プロセス内でSDKを直接実行）

## 現在の問題点

```
現在の構造（失敗）：
ParentAgent（親プロセス）
    └── Worker（子プロセス）
         └── ClaudeExecutorService → SDK（孫プロセス）❌
         
エラー: Claude Code process exited with code 1
原因: 子プロセスから更に子プロセスを起動しようとしている
```

## 目標とする構造

```
目標の構造：
メインプロセス
    └── ParentAgent（管理）
         ├── President（子プロセス + SDK直接実行）
         ├── Worker1（子プロセス + SDK直接実行）
         ├── Worker2（子プロセス + SDK直接実行）
         ├── Worker3（子プロセス + SDK直接実行）
         ├── Worker4（子プロセス + SDK直接実行）
         └── Worker5（子プロセス + SDK直接実行）
```

## UXフロー

1. **ユーザー**: 「Slackに投稿して、TODOアプリも作って」
2. **ANICCA**: 音声認識 → President呼び出し
3. **President**: タスク分解（SDKでAI分析）
   - Task1: Slack投稿 → Worker1へ
   - Task2: アプリ作成 → Worker2へ
4. **Worker1 & Worker2**: 並列実行
   - それぞれMCPツール使用
   - 完了後Presidentに報告
5. **President**: 結果集約 → Slack報告
6. **ユーザー**: Slackで完了確認

## ファイル構成

```
/services/
├── claudeExecutorService.js          # 【維持】基盤として使用
│
├── parallel-sdk/
│   ├── ParentAgent.js               # President管理（fork起動）
│   │
│   ├── agents/
│   │   ├── President.js             # NEW: タスク分解役
│   │   ├── Worker.js                # 修正: SDK直接実行
│   │   ├── BaseWorker.js            # 修正: 共通処理
│   │   └── TodoManager.js           # 維持: TODO管理
│   │
│   ├── workers/                     # 維持: 人格設定
│   │   ├── profiles/
│   │   └── instructions/
│   │
│   ├── prompts/                     # 維持: プロンプト
│   │   ├── presidentPrompt.js
│   │   └── workerPrompts.js
│   │
│   └── utils/
│       └── IPCProtocol.js           # 維持: プロセス間通信
```

## 移行手順

### Phase 1: 準備（10分）
1. 現在の状態をコミット
2. 動作中のプロセスを停止
3. このドキュメントを確認

### Phase 2: BaseWorker.jsの修正（30分）
1. ClaudeExecutorServiceへの依存を削除
2. ClaudeExecutorServiceのexecuteGeneralRequestの中身を移植
   - SDK呼び出し部分
   - MCP設定部分
   - プロンプト組み立て部分
3. 子プロセスを起動しない形に修正

### Phase 3: Worker.jsの修正（20分）
1. ClaudeExecutorServiceのインスタンス化を削除
2. SDKとMCPを直接管理するよう変更
3. 人格設定の読み込みは維持

### Phase 4: President.jsの新規作成（20分）
1. BaseWorkerを継承
2. タスク分解ロジックを実装（SDKでAI判断）
3. Worker管理機能を追加
4. 結果集約とSlack報告機能

### Phase 5: ParentAgent.jsの調整（15分）
1. President.jsを起動するよう変更
2. IPCメッセージのルーティング調整
3. 不要なコードの削除

### Phase 6: テストとデバッグ（30分）
1. 構文チェック
   ```bash
   find services -name "*.js" -exec node -c {} \;
   ```
2. GitHubへプッシュ（Railway自動デプロイ）
3. 並列実行テスト
4. Slack報告の確認

## 技術的詳細

### SDK実行方法の変更

**現在（失敗）:**
```javascript
// Worker.js
this.claudeService = new ClaudeExecutorService();
const result = await this.claudeService.executeGeneralRequest(task);
```

**変更後:**
```javascript
// Worker.js
import { query } from '@anthropic-ai/claude-code';
// ClaudeExecutorServiceのexecuteGeneralRequestの中身を直接実行
const result = await query({
  prompt: task.originalRequest,
  options: { mcpServers, cwd, ... }
});
```

### MCP設定

全エージェントが同じMCPツールにアクセス：
- filesystem（ファイル操作）
- slack（Slack API）
- exa（Web検索）
- github（GitHub操作）

### プロセス管理

- President: 常時起動
- Worker1-5: タスク時に起動（または常時起動）
- 各プロセスは独立してSDKを実行
- IPCで通信

## 成功基準

- [ ] Worker起動時にエラーが出ない
- [ ] 並列実行が可能
- [ ] Slack報告が正常動作
- [ ] メモリ使用量が適切
- [ ] Railway環境で安定動作

## リスクと対策

| リスク | 対策 |
|--------|------|
| SDK直接実行で新たなエラー | ClaudeExecutorServiceのコードを参考に慎重に移植 |
| メモリ不足 | 同時実行数を制限（最大5） |
| IPC通信の不具合 | 既存のIPCProtocolを活用 |

## まとめ

この移行により：
1. **シンプルな構造**になる
2. **既存の資産**を活用できる
3. **並列実行**が実現する
4. **保守性**が向上する

全員がClaudeExecutorServiceの機能を使い、役割（President/Worker）だけが異なるクリーンな設計になります。