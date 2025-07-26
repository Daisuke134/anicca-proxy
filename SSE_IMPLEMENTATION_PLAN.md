# SSE実装計画 - Web版逐次音声報告

## 概要
Web版でもDesktop版と同じように、各Workerのタスク完了時・進捗更新時に音声報告を実現する。

## TODOリスト

1. **Worker.jsにsendStatusUpdateメソッドを追加**
2. **workerPrompts.jsに進捗報告の指示を追加**
3. **ParentAgent.jsのSTATUS_UPDATEハンドラーを実装**
4. **claude_code.jsにSSEモードを追加**
5. **page.tsxにSSE受信処理を追加**
6. **必要なインポートを追加**
7. **逐次音声報告の動作テスト**

## 具体的な実装内容

### 1. Worker.jsの修正
**ファイル**: `/services/parallel-sdk/agents/Worker.js`
**場所**: line 366付近（`removeScheduledTask`メソッドの後）

```javascript
/**
 * 進捗を報告
 */
async sendStatusUpdate(progress, percentage = null) {
  if (this.currentTask && process.send) {
    process.send(createStatusUpdateMessage(
      this.currentTask.id,
      'in_progress',
      { progress, percentage }
    ));
    console.log(`📊 [${this.agentName}] 進捗報告: ${progress}`);
  }
}
```

**インポート追加**（ファイル先頭）:
```javascript
import { createStatusUpdateMessage } from '../IPCProtocol.js';
```

### 2. workerPrompts.jsの修正
**ファイル**: `/services/parallel-sdk/prompts/workerPrompts.js`
**場所**: line 151付近（「## 利用可能なツール」の前）

```javascript
## 進捗報告について
- 長時間のタスク（アプリ作成など）では、重要な節目で進捗を報告
- 以下のように報告してください：
  await this.sendStatusUpdate("データベース設計を完了しました", 30);
  await this.sendStatusUpdate("UIコンポーネントを実装中です", 60);
  await this.sendStatusUpdate("テストを実行しています", 90);
- 報告は簡潔に、現在の作業内容を説明
```

### 3. ParentAgent.jsの修正
**ファイル**: `/services/parallel-sdk/agents/ParentAgent.js`
**場所**: line 650-652（STATUS_UPDATEケース）

```javascript
case 'STATUS_UPDATE':
  const updateInfo = message.payload;
  const taskInfo = this.tasks.get(updateInfo.taskId);
  if (taskInfo) {
    // 進捗情報を保存
    taskInfo.lastUpdate = updateInfo.progress;
    taskInfo.percentage = updateInfo.progress?.percentage;
    
    // Web版でもコールバックを呼び出し
    if (this.onStatusUpdate) {
      this.onStatusUpdate({
        workerName: worker.name,
        progress: updateInfo.progress.progress,
        percentage: updateInfo.progress.percentage,
        taskId: updateInfo.taskId
      });
    }
  }
  break;
```

### 4. claude_code.jsの修正
**ファイル**: `/api/tools/claude_code.js`
**場所**: line 171付近（`console.log('🚀 Starting task: ${task}');`の後）

```javascript
// SSEモードの判定
if (req.headers['x-stream-mode'] === 'true') {
  // SSEヘッダーを設定
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx用
  
  // keep-aliveタイマー（2分ごと）
  const keepAliveInterval = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 120000);
  
  // ParentAgentにコールバックを設定
  agent.onTaskComplete = (taskInfo) => {
    res.write(`data: ${JSON.stringify({
      type: 'task_complete',
      workerName: taskInfo.workerName,
      task: taskInfo.task,
      taskId: taskInfo.taskId
    })}\n\n`);
  };
  
  agent.onStatusUpdate = (updateInfo) => {
    res.write(`data: ${JSON.stringify({
      type: 'status_update',
      workerName: updateInfo.workerName,
      progress: updateInfo.progress,
      percentage: updateInfo.percentage,
      taskId: updateInfo.taskId
    })}\n\n`);
  };
  
  // タスク実行（非同期）
  agent.executeTask({
    id: uuidv4(),
    type: 'general',
    originalRequest: task,
    userId: userId || null,
    timezone: timezone || null,
    context: {
      context: context || '',
      userId: userId || null,
      userName: userId || 'ユーザー'
    }
  }).then(result => {
    // 最終結果を送信
    res.write(`data: ${JSON.stringify({
      type: 'all_complete',
      result: result
    })}\n\n`);
    
    // クリーンアップ
    clearInterval(keepAliveInterval);
    res.end();
  }).catch(error => {
    console.error('Task execution error:', error);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error.message
    })}\n\n`);
    clearInterval(keepAliveInterval);
    res.end();
  });
  
  return; // 早期リターン
}

// 以下、通常の処理が続く...
```

### 5. page.tsxの修正
**ファイル**: `/anicca-web/app/page.tsx`
**場所**: line 181付近（`const response = await fetch(toolsUrl, {`の前）

```javascript
// claude_codeの場合はSSEモードで処理
if (name === 'claude_code') {
  const response = await fetch(toolsUrl, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'X-Stream-Mode': 'true'  // SSEモードを有効化
    },
    body: JSON.stringify(requestBody)
  });
  
  // SSEストリームを読み取る
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    // デコードしてバッファに追加
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // 最後の不完全な行を保持
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          
          switch (data.type) {
            case 'task_complete':
              // タスク完了を音声報告
              dataChannelRef.current?.send(JSON.stringify({
                type: 'response.create',
                response: {
                  modalities: ['audio'],
                  instructions: `${data.workerName}が「${data.task}」を完了しました`
                }
              }));
              break;
              
            case 'status_update':
              // 進捗を音声報告
              dataChannelRef.current?.send(JSON.stringify({
                type: 'response.create',
                response: {
                  modalities: ['audio'],
                  instructions: data.progress
                }
              }));
              break;
              
            case 'all_complete':
              // 最終結果をOpenAIに送信
              dataChannelRef.current?.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: call_id,
                  output: JSON.stringify(data.result.result || data.result)
                }
              }));
              
              // 完了報告
              setTimeout(() => {
                dataChannelRef.current?.send(JSON.stringify({
                  type: 'response.create',
                  response: { modalities: ['text', 'audio'] }
                }));
              }, 100);
              break;
              
            case 'error':
              console.error('Task error:', data.error);
              break;
          }
        } catch (e) {
          console.error('SSE parse error:', e);
        }
      }
    }
  }
  
  return; // 通常のレスポンス処理をスキップ
}

// 以下、他のツールの処理が続く...
```

## 実装後の動作

### 複数タスクの場合
1. ユーザー：「TODOアプリ作って、天気調べて、Slackに報告して」
2. Anicca：「3つのタスクを開始します」
3. （Worker2完了）Anicca：「Worker2が天気情報の取得を完了しました」
4. （Worker1進捗）Anicca：「データベース設計を完了しました」
5. （Worker3完了）Anicca：「Worker3がSlackへの投稿を完了しました」
6. （Worker1進捗）Anicca：「UIコンポーネントを実装中です」
7. （Worker1完了）Anicca：「Worker1がTODOアプリの作成を完了しました」
8. Anicca：「全てのタスクが完了しました」

### 長時間単独タスクの場合
1. ユーザー：「本格的なチャットアプリ作って」
2. Anicca：「チャットアプリの作成を開始します」
3. （5分後）Anicca：「要件定義とアーキテクチャ設計を完了しました」
4. （20分後）Anicca：「バックエンドAPIの実装を完了しました」
5. （40分後）Anicca：「フロントエンドの基本UIを実装中です」
6. （1時間後）Anicca：「リアルタイム通信機能を実装しています」
7. （1時間30分後）Anicca：「テストとデバッグを実行中です」
8. （2時間後）Anicca：「Worker1がチャットアプリの作成を完了しました」

## 注意事項

1. **Railway環境のタイムアウト対策**
   - keep-aliveを2分ごとに送信（コメント行なので音声報告されない）
   - 5分以上の無通信を防ぐ

2. **エラーハンドリング**
   - ストリーム中断時の処理
   - タスク実行エラー時の処理

3. **Slack報告の削除**
   - 実装完了後、`postProgressUpdate`や`postCompletionUpdate`を削除可能
   - 音声報告で十分なため

## テスト方法

1. 複数タスクを依頼：「アプリ作って、データ分析して、報告書作って」
2. 各Workerの完了時に音声報告が来ることを確認
3. 長時間タスクで進捗報告が来ることを確認
4. 5分以上のタスクでも接続が維持されることを確認