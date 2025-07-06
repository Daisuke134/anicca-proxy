import { BaseWorker } from './BaseWorker.js';
import { fork } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { v4: uuidv4 } = require('uuid');
import { PRESIDENT_PROMPT } from '../prompts/workerPrompts.js';

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
    
    console.log(`👑 ${this.name} is initializing as the team leader...`);
  }
  
  /**
   * 初期化処理
   */
  async initialize() {
    try {
      console.log(`🎩 ${this.name} is starting initialization...`);
      
      // 5人の永続的なWorkerを起動
      console.log(`👥 Spawning permanent worker team...`);
      for (let i = 1; i <= this.maxWorkers; i++) {
        await this.spawnWorker(`Worker${i}`);
        // 少し待機して順番に起動
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      console.log(`✅ ${this.name} initialization complete`);
      console.log(`👔 Team composition: ${this.workers.size} workers ready`);
      
    } catch (error) {
      console.error(`❌ ${this.name} initialization failed:`, error);
      process.exit(1);
    }
  }
  
  /**
   * タスクを受け取って処理（BaseWorkerのexecuteTaskをオーバーライド）
   */
  async executeTask(task) {
    console.log(`📋 [${this.name}] Received main task: ${task.originalRequest}`);
    
    try {
      // プロンプトベースで全てを処理
      const prompt = `
${PRESIDENT_PROMPT}

【受け取ったタスク】
${task.originalRequest}

【実行手順】
1. 最適なWorkerを選んで、そのWorkerの名前（Worker1〜Worker5）を決める
2. 選んだWorkerにタスクを割り振る（内部的に処理されます）
3. #anicca_reportチャンネルにTODOリストを投稿:
   [ParentAgent] 📋 TODOリスト
   ☐ ${task.originalRequest} (Worker{番号})
4. Workerの完了を待つ
5. 完了したら#anicca_reportチャンネルに報告:
   [ParentAgent] ✅ 全タスク完了！
   ✅ ${task.originalRequest} (Worker{番号})

必ずmcp__http__slack_send_messageツールを使用してSlackに投稿してください。
`;

      // セッションを使用して実行
      const result = await this.session.sendMessage(prompt);
      
      // TODO: 実際のWorker割り振りロジックをここに実装
      // 今は仮実装
      const assignedWorker = await this.assignTaskToWorker(task);
      const taskResult = await this.waitForTaskCompletion(task.id);
      
      return {
        success: true,
        output: result,
        metadata: {
          executedBy: this.name,
          assignedTo: assignedWorker,
          taskId: task.id
        }
      };
      
    } catch (error) {
      console.error(`❌ [${this.name}] Task execution error:`, error);
      throw error;
    }
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
    
    console.log(`🎯 [${this.name}] Assigned task to ${worker.name}`);
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
    console.log(`🚀 [${this.name}] Spawning worker: ${workerName}`);
    
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
      console.error(`❌ [${this.name}] Worker ${workerName} error:`, error);
    });
    
    // 終了ハンドラー
    childProcess.on('exit', (code, signal) => {
      console.log(`👋 [${this.name}] Worker ${workerName} exited (code: ${code}, signal: ${signal})`);
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
    
    console.log(`📨 [${this.name}] Message from ${worker.name}:`, message.type);
    
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
          console.log(`✅ [${this.name}] Task completed by ${worker.name}`);
        }
        break;
        
      case 'LOG':
        console.log(`📝 [${worker.name}] ${message.payload?.message}`);
        break;
        
      default:
        console.log(`❓ Unknown message type from ${worker.name}:`, message);
    }
  }
}

// エントリーポイント（直接実行された場合）
if (process.argv[1] === import.meta.url.replace('file://', '')) {
  const parentAgent = new ParentAgent();
  parentAgent.initialize().then(() => {
    parentAgent.startListening();
  });
}