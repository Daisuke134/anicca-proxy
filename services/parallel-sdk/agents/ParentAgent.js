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
      const userId = global.currentUserId || 'system';
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
      const userId = global.currentUserId || 'system';
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
      // 1. 空いているWorkerを取得
      const worker = this.getIdleWorker();
      if (!worker) {
        throw new Error('No idle workers available');
      }
      
      // 2. TODOリストをSlackに投稿
      await this.postTodoList(task, worker.name);
      
      // 3. Workerにタスクを割り振る
      await this.assignTaskToWorker(task);
      
      // 4. タスク完了を待つ
      const taskResult = await this.waitForTaskCompletion(task.id);
      
      // 5. 完了報告をSlackに投稿
      await this.postCompletionReport(task, worker.name, taskResult);
      
      // 6. タスク管理の学習を記録
      const taskType = this.analyzeTaskType(task.originalRequest);
      if (taskType) {
        await this.saveTeamLearning(`${worker.name}が${taskType}タスクを完了。所要時間: ${Date.now() - startTime}ms`);
      }
      
      return {
        success: true,
        output: taskResult?.output || 'Task completed',
        metadata: {
          executedBy: this.agentName,
          assignedTo: worker.name,
          taskId: task.id
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
    console.log(`🚀 [${this.agentName}] Spawning worker: ${workerName}`);
    
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
        SLACK_USER_ID: global.currentUserId || ''
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
}

// エントリーポイント（直接実行された場合）
if (process.argv[1] === import.meta.url.replace('file://', '')) {
  const parentAgent = new ParentAgent();
  parentAgent.initialize().then(() => {
    parentAgent.startListening();
  });
}