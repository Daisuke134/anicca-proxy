import { BaseWorker } from './BaseWorker.js';
import { fork } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { v4: uuidv4 } = require('uuid');
import { loadClaudeMd, saveClaudeMd, appendLearning } from '../../workerMemory.js';

/**
 * ParentAgent - BaseWorkerベースの司令塔エージェント
 * 
 * 役割:
 * - タスクの割り振り
 * - TODOリスト形式でSlack報告
 * - 子エージェント（Worker）の管理
 */
export class ParentAgent extends BaseWorker {
  constructor() {
    // ParentAgentとして初期化
    process.env.AGENT_NAME = 'ParentAgent';
    process.env.AGENT_ID = 'parent-agent';
    super();
    
    // PresidentはClaude 4 Opusを使用
    process.env.CLAUDE_AGENT_TYPE = 'parent';
    console.log('👑 Setting CLAUDE_AGENT_TYPE to "parent" for Claude 4 Opus usage');
    
    // エージェント管理
    this.workers = new Map(); // workerId -> { process, name, status }
    this.tasks = new Map(); // taskId -> { task, assignedTo, status }
    this.maxWorkers = 5;
    
    // Workerの設定
    this.workerScriptPath = new URL('./Worker.js', import.meta.url).pathname;
    
    console.log(`👑 ${this.agentName} is initializing as the team leader...`);
  }
  
  /**
   * 初期化処理
   */
  async initialize() {
    try {
      console.log(`🎩 ${this.agentName} is starting initialization...`);
      
      // 5人の永続的なWorkerを起動
      console.log(`👥 Spawning permanent worker team...`);
      for (let i = 1; i <= this.maxWorkers; i++) {
        await this.spawnWorker(`Worker${i}`);
        // 少し待機して順番に起動
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      console.log(`✅ ${this.agentName} initialization complete`);
      console.log(`👔 Team composition: ${this.workers.size} workers ready`);
      
      // ParentAgentのCLAUDE.mdを読み込む
      await this.loadTeamMemory();
      
    } catch (error) {
      console.error(`❌ ${this.agentName} initialization failed:`, error);
      process.exit(1);
    }
  }
  
  /**
   * チーム全体の記憶を読み込む
   */
  async loadTeamMemory() {
    try {
      const userId = process.env.SLACK_USER_ID || process.env.CURRENT_USER_ID || global.currentUserId || 'system';
      this.teamMemory = await loadClaudeMd(userId, 'ParentAgent');
      
      if (this.teamMemory) {
        console.log(`📚 [${this.agentName}] Loaded team memory (${this.teamMemory.length} chars)`);
      }
    } catch (error) {
      console.error(`Failed to load team memory: ${error.message}`);
    }
  }
  
  /**
   * チーム管理の学習内容を保存
   */
  async saveTeamLearning(learning) {
    try {
      const userId = process.env.SLACK_USER_ID || process.env.CURRENT_USER_ID || global.currentUserId || 'system';
      await appendLearning(userId, 'ParentAgent', learning);
      console.log(`💾 [${this.agentName}] Saved team learning: ${learning}`);
    } catch (error) {
      console.error(`Failed to save team learning: ${error.message}`);
    }
  }
  
  /**
   * タスクを受け取って処理（BaseWorkerのexecuteTaskをオーバーライド）
   */
  async executeTask(task) {
    console.log(`📋 [${this.agentName}] Received main task: ${task.originalRequest}`);
    
    const startTime = Date.now();
    
    try {
      // 1. Worker状況を取得
      const workerStatus = this.getWorkerStatus();
      
      // 2. Claudeでタスクを分析して割り当てを決定
      const assignments = await this.analyzeAndAssignTasks({
        task: task.originalRequest,
        workers: workerStatus
      });
      
      // 3. 各タスクのTODOリストを投稿
      for (const assignment of assignments) {
        const subTask = {
          ...task,
          originalRequest: assignment.task
        };
        await this.postTodoList(subTask, assignment.worker);
      }
      
      // 4. 各タスクを並列で実行
      const taskPromises = assignments.map(async (assignment, index) => {
        const subTaskId = `${task.id}-${index}`;
        const subTask = {
          ...task,
          id: subTaskId,
          originalRequest: assignment.task
        };
        
        // タスクを記録
        this.tasks.set(subTaskId, {
          task: subTask,
          assignedTo: assignment.worker,
          status: 'assigned'
        });
        
        // Workerに割り当て
        await this.assignSpecificTaskToWorker(assignment.worker, subTask);
        
        // 完了を待つ
        return await this.waitForTaskCompletion(subTaskId);
      });
      
      // 5. 全タスクの完了を待つ
      const results = await Promise.all(taskPromises);
      
      // 6. 全体の完了報告
      if (assignments.length > 1) {
        // 複数タスクの場合は全体の完了報告
        let completedItems = '';
        assignments.forEach((assignment, index) => {
          completedItems += `✅ ${assignment.task} (${assignment.worker})\n`;
        });
        
        const query = `mcp__http__slack_send_messageを使って#anicca_reportチャンネルに以下を投稿してください:

[ParentAgent] ✅ 全タスク完了！
${completedItems}`;
        
        await this.executor.executeGeneralRequest({
          type: 'general',
          parameters: { query }
        });
      } else if (assignments.length === 1) {
        // 単一タスクの場合は従来の完了報告
        await this.postCompletionReport(task, assignments[0].worker, results[0]);
      }
      
      // 7. タスク管理の学習を記録
      const duration = Date.now() - startTime;
      await this.saveTeamLearning(`${assignments.length}個のタスクを並列処理。所要時間: ${duration}ms`);
      
      return {
        success: true,
        output: results.map(r => r?.output || 'Task completed').join('\n\n'),
        metadata: {
          executedBy: this.agentName,
          assignments: assignments,
          taskCount: assignments.length,
          duration: duration
        }
      };
      
    } catch (error) {
      console.error(`❌ [${this.agentName}] Task execution error:`, error);
      throw error;
    }
  }
  
  /**
   * TODOリストをSlackに投稿
   */
  async postTodoList(task, workerName) {
    const query = `mcp__http__slack_send_messageを使って#anicca_reportチャンネルに以下を投稿してください:

[ParentAgent] 📋 TODOリスト
☐ ${task.originalRequest} (${workerName})`;
    
    await this.executor.executeGeneralRequest({
      type: 'general',
      parameters: { query }
    });
  }
  
  /**
   * 完了報告をSlackに投稿
   */
  async postCompletionReport(task, workerName, result) {
    const previewUrl = result?.metadata?.preview?.previewUrl || '';
    const query = `mcp__http__slack_send_messageを使って#anicca_reportチャンネルに以下を投稿してください:

[ParentAgent] ✅ 全タスク完了！
✅ ${task.originalRequest} (${workerName})
${previewUrl ? `成果物: ${previewUrl}` : ''}`;
    
    await this.executor.executeGeneralRequest({
      type: 'general',
      parameters: { query }
    });
  }
  
  /**
   * 進捗更新をSlackに投稿（複数タスクの場合に使用）
   */
  async postProgressUpdate(task, completedWorkerName) {
    // 現在のタスク状況を集計
    const totalTasks = this.tasks.size;
    const completedTasks = Array.from(this.tasks.values()).filter(t => t.status === 'completed').length;
    
    // 単一タスクの場合は進捗更新不要（完了報告で十分）
    if (totalTasks === 1) {
      return;
    }
    
    // 複数タスクの場合の進捗更新
    let statusList = '';
    for (const [taskId, taskInfo] of this.tasks) {
      const status = taskInfo.status === 'completed' ? '✅' : '☐';
      statusList += `${status} ${taskInfo.task.originalRequest} (${taskInfo.assignedTo})\n`;
    }
    
    const query = `mcp__http__slack_send_messageを使って#anicca_reportチャンネルに以下を投稿してください:

[ParentAgent] 🔄 TODOリスト更新
${statusList}
進捗: ${completedTasks}/${totalTasks}完了`;
    
    await this.executor.executeGeneralRequest({
      type: 'general',
      parameters: { query }
    });
  }
  
  
  /**
   * タスクをWorkerに割り振る
   */
  async assignTaskToWorker(task) {
    const worker = this.getIdleWorker();
    if (!worker) {
      throw new Error('No idle workers available');
    }
    
    // タスクを記録
    this.tasks.set(task.id, {
      task: task,
      assignedTo: worker.name,
      status: 'assigned'
    });
    
    // IPCでタスクを送信
    worker.process.send({
      type: 'TASK_ASSIGN',
      payload: {
        taskId: task.id,
        task: task
      },
      timestamp: Date.now()
    });
    
    worker.status = 'busy';
    
    console.log(`🎯 [${this.agentName}] Assigned task to ${worker.name}`);
    return worker.name;
  }
  
  /**
   * アイドル状態のWorkerを取得
   */
  getIdleWorker() {
    for (const [workerId, worker] of this.workers) {
      if (worker.status === 'idle') {
        return worker;
      }
    }
    return null;
  }
  
  /**
   * タスク完了を待つ
   */
  async waitForTaskCompletion(taskId) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const taskInfo = this.tasks.get(taskId);
        if (taskInfo && taskInfo.status === 'completed') {
          clearInterval(checkInterval);
          resolve(taskInfo.result);
        }
      }, 1000);
      
      // タイムアウト設定（5分）
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve({ error: 'Task timeout' });
      }, 300000);
    });
  }
  
  
  /**
   * Workerを起動
   */
  async spawnWorker(workerName) {
    // ParentAgent自身が受け取ったuserIdを優先的に使用
    const userId = process.env.SLACK_USER_ID || process.env.CURRENT_USER_ID || global.currentUserId || 'system';
    console.log(`🚀 [${this.agentName}] Spawning ${workerName} with userId: ${userId}`);
    
    // 子プロセスとしてWorkerを起動（Slackトークンも渡す）
    const childProcess = fork(this.workerScriptPath, [], {
      env: {
        ...process.env,
        AGENT_ID: `worker-${workerName.toLowerCase()}`,
        AGENT_NAME: workerName,
        WORKER_NUMBER: workerName.replace('Worker', ''),
        // Slackトークンを環境変数で渡す
        SLACK_BOT_TOKEN: global.slackBotToken || '',
        SLACK_USER_TOKEN: global.slackUserToken || '',
        SLACK_USER_ID: userId,  // 確実にuserIdを渡す
        CURRENT_USER_ID: userId  // 念のため別名でも渡す
      }
    });
    
    // Worker情報を保存
    const worker = {
      id: `worker-${workerName.toLowerCase()}`,
      name: workerName,
      process: childProcess,
      status: 'idle'
    };
    
    this.workers.set(worker.id, worker);
    
    // メッセージハンドラーを設定
    childProcess.on('message', (message) => {
      this.handleWorkerMessage(worker.id, message);
    });
    
    // エラーハンドラー
    childProcess.on('error', (error) => {
      console.error(`❌ [${this.agentName}] Worker ${workerName} error:`, error);
    });
    
    // 終了ハンドラー
    childProcess.on('exit', (code, signal) => {
      console.log(`👋 [${this.agentName}] Worker ${workerName} exited (code: ${code}, signal: ${signal})`);
      this.workers.delete(worker.id);
    });
    
    return worker;
  }
  
  /**
   * Workerからのメッセージを処理
   */
  handleWorkerMessage(workerId, message) {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    
    console.log(`📨 [${this.agentName}] Message from ${worker.name}:`, message.type);
    
    switch (message.type) {
      case 'READY':
        console.log(`✅ ${worker.name} is ready`);
        worker.status = 'idle';
        break;
        
      case 'STATUS_UPDATE':
        // 進捗更新（必要に応じてSlackに投稿）
        break;
        
      case 'TASK_COMPLETE':
        const taskId = message.payload?.taskId;
        const taskInfo = this.tasks.get(taskId);
        if (taskInfo) {
          taskInfo.status = 'completed';
          taskInfo.result = message.payload?.result;
          worker.status = 'idle';
          console.log(`✅ [${this.agentName}] Task completed by ${worker.name}`);
          
          // 進捗更新をSlackに投稿
          this.postProgressUpdate(taskInfo.task, worker.name).catch(error => {
            console.error(`Failed to post progress update: ${error.message}`);
          });
        }
        break;
        
      case 'LOG':
        console.log(`📝 [${worker.name}] ${message.payload?.message}`);
        break;
        
      default:
        console.log(`❓ Unknown message type from ${worker.name}:`, message);
    }
  }
  
  /**
   * タスクタイプを分析
   * @private
   */
  analyzeTaskType(request) {
    if (!request) return null;
    
    const lowerRequest = request.toLowerCase();
    
    if (lowerRequest.includes('アプリ') || lowerRequest.includes('app')) {
      return 'アプリ開発';
    } else if (lowerRequest.includes('修正') || lowerRequest.includes('fix')) {
      return 'バグ修正';
    } else if (lowerRequest.includes('デザイン') || lowerRequest.includes('ui')) {
      return 'デザイン';
    } else if (lowerRequest.includes('slack') || lowerRequest.includes('メッセージ')) {
      return 'コミュニケーション';
    }
    
    return '一般';
  }
  
  /**
   * Worker状況を取得
   */
  getWorkerStatus() {
    const status = {};
    for (const [workerId, worker] of this.workers) {
      status[worker.name] = worker.status;
    }
    return status;
  }
  
  /**
   * Claudeでタスクを分析して割り当てを決定
   */
  async analyzeAndAssignTasks(taskInfo) {
    const prompt = `
以下のタスクを分析して、空いているWorkerに割り当ててください。

【タスク】
${taskInfo.task}

【Worker状況】
${JSON.stringify(taskInfo.workers, null, 2)}

【ルール】
- busyのWorkerは避けて、idleのWorkerだけに割り当ててください
- **重要**: 2つ以上の異なるタスクがある場合は、必ず別々のWorkerに割り当ててください
- タスクの難易度に関係なく、異なる種類のタスクは並列処理のために分割してください
- ユーザーが「複数のWorkerに分けて」と明示的に指示した場合は、必ずその通りに実行してください
- 同じ種類のタスクを無理に分割する必要はありません
- 例：以下のようなタスクは必ず3人の別々のWorkerに割り当ててください
  - 「TODOアプリ作成」「聖書の言葉を送信」「ニュース検索」
  - 「アプリ作成して、メッセージ送って、調査して」

【応答形式】
必ず以下のJSON形式で返してください：
{
  "assignments": [
    { "worker": "Worker名", "task": "具体的なタスク内容" },
    ...
  ]
}

例1（複数タスク）:
{
  "assignments": [
    { "worker": "Worker1", "task": "聖書の言葉をSlackに投稿" },
    { "worker": "Worker2", "task": "TODOアプリを作成" },
    { "worker": "Worker4", "task": "ニュース記事を探してSlackに投稿" }
  ]
}

例2（単一タスク）:
{
  "assignments": [
    { "worker": "Worker1", "task": "ウェブサイトのデザインを改善する" }
  ]
}`;

    try {
      // ParentAgentもClaudeSessionを持っているので、それを使う
      // rawオプションを使用して生のレスポンスを取得
      const response = await this.session.sendMessage(prompt, { raw: true });
      
      // デバッグ: Claudeのレスポンスを確認
      console.log(`📝 [${this.agentName}] Claude raw response length:`, response.length);
      console.log(`📝 [${this.agentName}] First 200 chars:`, response.substring(0, 200));
      
      // レスポンスからJSONを抽出（Markdownコードブロックも考慮）
      let jsonStr;
      
      // まずMarkdownコードブロック内のJSONを探す
      const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1];
        console.log(`📝 [${this.agentName}] Found JSON in code block:`, jsonStr);
      } else {
        // コードブロックがない場合は、純粋なJSONを探す
        const jsonMatch = response.match(/\{[\s\S]*"assignments"[\s\S]*\}/);
        if (!jsonMatch) {
          console.error(`❌ No JSON found in response. Full response:`, response);
          throw new Error('Failed to find JSON in Claude response');
        }
        jsonStr = jsonMatch[0];
        console.log(`📝 [${this.agentName}] Found JSON without code block:`, jsonStr);
      }
      
      // JSONをパース
      const parsed = JSON.parse(jsonStr);
      console.log(`🎯 [${this.agentName}] Task assignments:`, parsed.assignments);
      
      return parsed.assignments;
    } catch (error) {
      console.error(`❌ [${this.agentName}] Failed to analyze tasks:`, error);
      console.error(`❌ Full error details:`, error.message);
      console.error(`❌ Error stack:`, error.stack);
      
      // フォールバック: 単一タスクとして扱う
      const idleWorker = this.getIdleWorker();
      return [{
        worker: idleWorker ? idleWorker.name : 'Worker1',
        task: taskInfo.task
      }];
    }
  }
  
  /**
   * 特定のWorkerに特定のタスクを割り当て
   */
  async assignSpecificTaskToWorker(workerName, task) {
    const worker = Array.from(this.workers.values()).find(w => w.name === workerName);
    if (!worker) {
      throw new Error(`Worker ${workerName} not found`);
    }
    
    if (worker.status === 'busy') {
      console.warn(`⚠️ [${this.agentName}] Worker ${workerName} is busy, but assigning anyway`);
    }
    
    // IPCでタスクを送信
    worker.process.send({
      type: 'TASK_ASSIGN',
      payload: {
        taskId: task.id,
        task: task
      },
      timestamp: Date.now()
    });
    
    worker.status = 'busy';
    console.log(`🎯 [${this.agentName}] Assigned task to ${worker.name}: ${task.originalRequest.substring(0, 50)}...`);
  }
  
}

// エントリーポイント（直接実行された場合）
if (process.argv[1] === import.meta.url.replace('file://', '')) {
  const parentAgent = new ParentAgent();
  parentAgent.initialize().then(() => {
    parentAgent.startListening();
  });
}