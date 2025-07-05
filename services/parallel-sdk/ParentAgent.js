import { fork } from 'child_process';
import { EventEmitter } from 'events';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { v4: uuidv4 } = require('uuid');
import { query } from '@anthropic-ai/claude-code';
import { fileURLToPath } from 'url';
import path from 'path';

/**
 * ParentAgent (President) - 並列SDKシステムの中核
 * 
 * 役割:
 * - ユーザーからのタスクを受け取り、分析・分解
 * - 適切な子エージェントにタスクを割り振り
 * - 全体の進捗管理とユーザーへの報告
 * - エージェント間の調整
 */
export class ParentAgent extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // PresidentはClaude 4 Opusを使用
    process.env.CLAUDE_AGENT_TYPE = 'parent';
    console.log('👑 Setting CLAUDE_AGENT_TYPE to "parent" for Claude 4 Opus usage');
    
    // 基本設定
    this.agentId = 'president';
    this.name = 'President';
    this.maxConcurrentAgents = options.maxConcurrentAgents || 5;
    this.database = options.database; // データベース参照を保存
    
    // エージェント管理
    this.agents = new Map(); // agentId -> { process, type, status, tasks }
    this.taskQueue = [];
    this.activeTokens = this.maxConcurrentAgents; // 同時実行可能なタスク数
    
    // タスク管理
    this.tasks = new Map(); // taskId -> { id, description, status, assignedTo, result }
    
    // TodoManager
    this.todoManager = null;
    this.todoManagerEnabled = options.enableTodoManager !== false; // デフォルトは有効
    
    // 汎用Workerの設定
    this.workerConfig = {
      name: 'Worker',
      description: '汎用アシスタントWorker',
      scriptPath: new URL('./agents/Worker.js', import.meta.url).pathname
    };
    
    // Worker統計（将来の専門化のため）
    this.workerStats = new Map(); // workerId -> { taskTypeCount, successRate, totalTasks }
    
    // 統計情報
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      startTime: Date.now()
    };
  }

  /**
   * 初期化
   */
  async initialize() {
    console.log(`\n🎩 ${this.name} is initializing the parallel execution system...`);
    console.log(`🔧 Max concurrent agents: ${this.maxConcurrentAgents}`);
    
    // TodoManagerを起動
    if (this.todoManagerEnabled) {
      await this.spawnTodoManager();
    }
    
    // 5人の永続的なWorkerを起動
    console.log(`👥 Spawning permanent worker team...`);
    for (let i = 1; i <= 5; i++) {
      await this.spawnWorker(`Worker${i}`);
      // 少し待機して順番に起動
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`👔 ${this.name} is ready to lead the team.`);
    console.log(`✨ Team composition: ${this.agents.size} workers ready`);
    this.emit('initialized', { agentId: this.agentId });
  }

  /**
   * ユーザーからのリクエストを処理
   * @param {string} userRequest - ユーザーからの音声指示
   * @param {object} context - 追加のコンテキスト情報
   */
  async processUserRequest(userRequest, context = {}) {
    console.log(`\n📋 [${this.name}] Received request: "${userRequest}"`);
    
    const startTime = Date.now();
    
    try {
      // 1. タスクを分析・分解
      const analyzedTasks = await this.analyzeAndDecomposeTasks(userRequest, context);
      
      // 2. TodoManagerにタスクリストを送信
      if (this.todoManager && this.todoManager.status === 'ready') {
        this.todoManager.process.send({
          type: 'TASK_LIST',
          tasks: analyzedTasks.map(t => ({
            id: t.id,
            description: t.description,
            type: t.type
          })),
          userName: context.userName || 'ユーザー',
          timestamp: Date.now()
        });
      }
      
      // 3. 各タスクを適切なエージェントに割り当て
      const taskPromises = [];
      for (const task of analyzedTasks) {
        const assignment = await this.assignTask(task);
        
        // タスク完了を待つPromiseを作成
        const taskPromise = new Promise((resolve) => {
          const checkComplete = () => {
            const taskInfo = this.tasks.get(task.id);
            if (taskInfo && taskInfo.status === 'completed') {
              resolve(taskInfo);
            } else if (taskInfo && taskInfo.status === 'failed') {
              resolve(taskInfo);
            } else {
              // 100msごとにチェック
              setTimeout(checkComplete, 100);
            }
          };
          checkComplete();
        });
        
        taskPromises.push(taskPromise);
      }
      
      // 3. 全タスクの完了を待つ（タイムアウト付き）
      const timeout = 300000; // 5分
      const results = await Promise.race([
        Promise.all(taskPromises),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Task timeout')), timeout)
        )
      ]);
      
      // 4. 結果を集約
      const allToolsUsed = new Set();
      const allGeneratedFiles = [];
      const taskSummaries = [];
      
      for (const taskResult of results) {
        if (taskResult.result) {
          // ツール使用状況を集約
          if (taskResult.result.toolsUsed) {
            taskResult.result.toolsUsed.forEach(tool => allToolsUsed.add(tool));
          }
          
          // 生成ファイルを集約
          if (taskResult.result.generatedFiles) {
            allGeneratedFiles.push(...taskResult.result.generatedFiles);
          }
          
          // タスクサマリーを追加
          taskSummaries.push({
            taskId: taskResult.id,
            type: taskResult.type,
            description: taskResult.description,
            status: taskResult.status,
            result: taskResult.result?.result || taskResult.result
          });
        }
      }
      
      // 5. 総合的なサマリーを生成
      const summary = this.generateSummary(userRequest, taskSummaries);
      
      // 6. TodoManagerに全タスク完了を通知
      if (this.todoManager && this.todoManager.status === 'ready') {
        this.todoManager.process.send({
          type: 'ALL_TASKS_COMPLETE',
          summary: summary,
          totalTime: Date.now() - startTime,
          timestamp: Date.now()
        });
      }
      
      return {
        success: true,
        summary,
        toolsUsed: Array.from(allToolsUsed),
        generatedFiles: allGeneratedFiles,
        tasks: taskSummaries,
        executionTime: Date.now() - startTime
      };
      
    } catch (error) {
      console.error(`❌ [${this.name}] Error processing request:`, error);
      return {
        success: false,
        summary: 'リクエストの処理中にエラーが発生しました',
        error: error.message,
        executionTime: Date.now() - startTime
      };
    }
  }
  
  /**
   * タスク結果からサマリーを生成
   * @private
   */
  generateSummary(originalRequest, taskSummaries) {
    const completedCount = taskSummaries.filter(t => t.status === 'completed').length;
    const failedCount = taskSummaries.filter(t => t.status === 'failed').length;
    
    let summary = `「${originalRequest}」を処理しました。\n\n`;
    
    if (completedCount > 0) {
      summary += `✅ ${completedCount}個のタスクが完了:\n`;
      taskSummaries
        .filter(t => t.status === 'completed')
        .forEach(t => {
          summary += `  • ${t.description}\n`;
        });
    }
    
    if (failedCount > 0) {
      summary += `\n❌ ${failedCount}個のタスクが失敗:\n`;
      taskSummaries
        .filter(t => t.status === 'failed')
        .forEach(t => {
          summary += `  • ${t.description}\n`;
        });
    }
    
    return summary;
  }

  /**
   * タスクを分析して分解
   * @private
   */
  async analyzeAndDecomposeTasks(userRequest, context) {
    console.log(`🤔 [${this.name}] Analyzing request with AI...`);
    
    try {
      const messages = [];
      
      // AIプロンプト
      const prompt = `あなたは優秀なプロジェクトマネージャーです。
以下のリクエストを分析し、独立して実行可能なタスクに分解してください。

リクエスト: "${userRequest}"
ユーザー: ${context.userName || 'ユーザー'}

以下のJSON形式で応答してください：
{
  "tasks": [
    {
      "type": "communication|development|research|execution|creative|general",
      "description": "具体的なタスクの説明",
      "originalRequest": "このタスクで実行すべき具体的な内容",
      "priority": "high|medium|low",
      "dependencies": []
    }
  ]
}

重要な指針：
- タスクは並列実行可能なように独立させる
- 各タスクは1つのWorkerが完結できる粒度にする
- "Slackに投稿して、アプリも作って"のような場合は2つのタスクに分ける
- originalRequestには具体的な実行内容を記載`;

      // Claude SDKを使用（Opus 4）
      const queryOptions = {
        model: 'claude-3-opus-20241022',
        maxTokens: 2048,
        temperature: 0.3
      };
      
      const queryIterable = query({
        prompt,
        options: queryOptions
      });
      
      // レスポンスを収集
      let responseText = '';
      for await (const message of queryIterable) {
        if (message.type === 'assistant' && message.message?.content) {
          const content = message.message.content;
          responseText += content.map((c) => c.text || '').join('');
        }
      }
      
      // JSONを抽出してパース
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Failed to extract JSON from AI response');
      }
      
      const analysis = JSON.parse(jsonMatch[0]);
      const tasks = analysis.tasks.map(task => ({
        id: uuidv4(),
        ...task
      }));
      
      console.log(`📊 [${this.name}] AI decomposed into ${tasks.length} tasks`);
      return tasks;
      
    } catch (error) {
      console.error(`❌ AI analysis failed, falling back to keyword-based:`, error.message);
      
      // フォールバック：キーワードベースの分解
      const tasks = [];
      const requestLower = userRequest.toLowerCase();
      
      if (requestLower.includes('slack') && requestLower.includes('アプリ')) {
        // 複数タスクの例
        tasks.push({
          id: uuidv4(),
          type: 'communication',
          description: 'Slackへの投稿',
          originalRequest: userRequest.split('、')[0] || userRequest,
          priority: 'high'
        });
        tasks.push({
          id: uuidv4(),
          type: 'development',
          description: 'アプリケーション開発',
          originalRequest: userRequest.split('、')[1] || userRequest,
          priority: 'high'
        });
      } else {
        // 単一タスク
        tasks.push({
          id: uuidv4(),
          type: 'general',
          description: userRequest,
          originalRequest: userRequest,
          priority: 'medium'
        });
      }
      
      return tasks;
    }
  }

  /**
   * タスクを適切なエージェントに割り当て
   * @private
   */
  async assignTask(task) {
    console.log(`🎯 [${this.name}] Assigning task ${task.id} (${task.type})`);
    
    // タスクを記録
    this.tasks.set(task.id, {
      ...task,
      status: 'pending',
      assignedTo: null,
      startTime: Date.now()
    });
    
    // 適切なエージェントを選択
    const agent = this.getIdleWorker(task.type);
    
    if (!agent) {
      throw new Error(`No suitable agent found for task type: ${task.type}`);
    }
    
    // タスクをエージェントに送信
    agent.process.send({
      type: 'TASK_ASSIGN',
      payload: {
        taskId: task.id,
        task: task
      },
      timestamp: Date.now()
    });
    
    // タスク情報を更新
    this.tasks.get(task.id).assignedTo = agent.id;
    this.tasks.get(task.id).status = 'assigned';
    
    this.stats.totalTasks++;
    
    return {
      taskId: task.id,
      assignedTo: agent.name,
      status: 'assigned'
    };
  }

  /**
   * アイドル状態のWorkerを取得
   * @private
   */
  getIdleWorker(taskType) {
    // 既存のアイドルWorkerを探す
    // TODO: 将来的にはtaskTypeに基づいて最適なWorkerを選択
    for (const [agentId, agent] of this.agents) {
      if (agent.status === 'idle') {
        agent.status = 'busy';
        return agent;
      }
    }
    
    // 全員忙しい場合
    console.log(`⚠️ [${this.name}] All workers are busy, task will be queued`);
    return null;
  }

  /**
   * TodoManagerを起動
   * @private
   */
  async spawnTodoManager() {
    const todoManagerId = 'todo-manager';
    const todoManagerPath = new URL('./agents/TodoManager.js', import.meta.url).pathname;
    
    console.log(`📋 [${this.name}] Spawning TodoManager...`);
    
    try {
      // 子プロセスとしてTodoManagerを起動
      const childProcess = fork(todoManagerPath, [], {
        env: {
          ...process.env,
          AGENT_ID: todoManagerId,
          AGENT_NAME: 'TodoManager'
        }
      });
      
      // TodoManager情報を保存
      this.todoManager = {
        id: todoManagerId,
        name: 'TodoManager',
        process: childProcess,
        status: 'initializing',
        startTime: Date.now()
      };
      
      // メッセージハンドラーを設定
      childProcess.on('message', (message) => {
        this.handleTodoManagerMessage(message);
      });
      
      // エラーハンドラー
      childProcess.on('error', (error) => {
        console.error(`❌ [${this.name}] TodoManager error:`, error);
      });
      
      // 終了ハンドラー
      childProcess.on('exit', (code, signal) => {
        console.log(`📋 [${this.name}] TodoManager exited with code ${code}`);
        this.todoManager = null;
      });
      
      // TodoManagerの準備完了を待つ
      await new Promise((resolve) => {
        const checkReady = () => {
          if (this.todoManager && this.todoManager.status === 'ready') {
            resolve();
          } else {
            setTimeout(checkReady, 100);
          }
        };
        checkReady();
      });
      
      console.log(`✅ [${this.name}] TodoManager is ready`);
      
    } catch (error) {
      console.error(`❌ Failed to spawn TodoManager:`, error);
      this.todoManagerEnabled = false;
    }
  }
  
  /**
   * TodoManagerからのメッセージを処理
   * @private
   */
  handleTodoManagerMessage(message) {
    console.log(`📋 [${this.name}] Message from TodoManager:`, message.type);
    
    if (message.type === 'READY') {
      this.todoManager.status = 'ready';
    }
  }

  /**
   * 新しいWorkerを生成
   * @private
   * @param {string} fixedName - 固定のWorker名（例: Worker1）
   */
  async spawnWorker(fixedName = null) {
    const workerId = fixedName || `worker-${uuidv4().slice(0, 8)}`;
    const workerNumber = fixedName ? parseInt(fixedName.replace('Worker', '')) : this.agents.size + 1;
    const workerName = fixedName || `${this.workerConfig.name}${workerNumber}`;
    
    console.log(`🚀 [${this.name}] Spawning worker: ${workerName} (${workerId})`);
    
    // 子プロセスとしてWorkerを起動
    const childProcess = fork(this.workerConfig.scriptPath, [], {
      env: {
        ...process.env,
        AGENT_ID: workerId,
        AGENT_NAME: workerName,
        WORKER_NUMBER: workerNumber.toString()
      }
    });
    
    // Worker情報を保存
    const worker = {
      id: workerId,
      name: workerName,
      process: childProcess,
      status: 'idle',
      tasks: [],
      startTime: Date.now()
    };
    
    this.agents.set(workerId, worker);
    
    // Worker統計を初期化
    this.workerStats.set(workerId, {
      taskTypeCount: {},
      successRate: 0,
      totalTasks: 0
    });
    
    // メッセージハンドラーを設定
    childProcess.on('message', (message) => {
      this.handleAgentMessage(workerId, message);
    });
    
    // エラーハンドラー
    childProcess.on('error', (error) => {
      console.error(`❌ [${this.name}] Worker ${workerId} error:`, error);
      this.handleAgentError(workerId, error);
    });
    
    // 終了ハンドラー
    childProcess.on('exit', (code, signal) => {
      console.log(`👋 [${this.name}] Worker ${workerId} exited (code: ${code}, signal: ${signal})`);
      this.handleAgentExit(workerId, code, signal);
    });
    
    return worker;
  }

  /**
   * エージェントからのメッセージを処理
   * @private
   */
  handleAgentMessage(agentId, message) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    
    console.log(`📨 [${this.name}] Message from ${agent.name}:`, message.type);
    
    // デバッグ用：メッセージの詳細を表示
    if (message.payload) {
      console.log(`   └─ Payload:`, JSON.stringify(message.payload).substring(0, 500));
    }
    
    switch (message.type) {
      case 'STATUS_UPDATE':
        this.handleStatusUpdate(agentId, message);
        break;
        
      case 'TASK_COMPLETE':
        this.handleTaskComplete(agentId, message);
        break;
        
      case 'ERROR':
        this.handleAgentError(agentId, message.error);
        break;
        
      case 'LOG':
        const logLevel = message.payload?.level || 'info';
        const logMessage = message.payload?.message || '(no message)';
        console.log(`📝 [${agent.name}] ${logMessage}`);
        break;
        
      case 'READY':
        console.log(`✅ [${agent.name}] is ready`);
        agent.status = 'idle';
        break;
        
      default:
        console.log(`❓ Unknown message type from ${agent.name}:`, message);
    }
  }

  /**
   * タスクのステータス更新を処理
   * @private
   */
  handleStatusUpdate(agentId, message) {
    const taskId = message.payload?.taskId;
    const status = message.payload?.status;
    const progress = message.payload?.progress;
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      task.progress = progress || 0;
      
      // TodoManagerに進捗更新を通知
      if (this.todoManager && this.todoManager.status === 'ready') {
        this.todoManager.process.send({
          type: 'TASK_UPDATE',
          taskId: taskId,
          status: status,
          progress: progress,
          workerId: this.agents.get(agentId).name,
          timestamp: Date.now()
        });
      }
      
      // 進捗をイベントとして発信
      this.emit('taskProgress', {
        taskId: taskId,
        status: status,
        progress: progress,
        agentName: this.agents.get(agentId).name
      });
    }
  }

  /**
   * タスク完了を処理
   * @private
   */
  handleTaskComplete(agentId, message) {
    const taskId = message.payload?.taskId;
    const result = message.payload?.result;
    const task = this.tasks.get(taskId);
    const agent = this.agents.get(agentId);
    
    if (task && agent) {
      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
      
      // エージェントのステータスを更新
      agent.status = 'idle';
      agent.tasks = agent.tasks.filter(t => t !== message.taskId);
      
      // 統計を更新
      this.stats.completedTasks++;
      
      // Worker統計を更新
      const workerStats = this.workerStats.get(agentId);
      if (workerStats) {
        workerStats.totalTasks++;
        const taskType = task.type || 'general';
        workerStats.taskTypeCount[taskType] = (workerStats.taskTypeCount[taskType] || 0) + 1;
        workerStats.successRate = this.stats.completedTasks / this.stats.totalTasks;
      }
      
      // TodoManagerにタスク完了を通知
      if (this.todoManager && this.todoManager.status === 'ready') {
        this.todoManager.process.send({
          type: 'TASK_COMPLETE',
          taskId: taskId,
          result: result,
          workerId: agent.name,
          timestamp: Date.now()
        });
      }
      
      // 完了イベントを発信
      this.emit('taskCompleted', {
        taskId: taskId,
        result: result,
        agentName: agent.name,
        duration: task.completedAt - task.startTime
      });
      
      console.log(`✅ [${this.name}] Task ${message.taskId} completed by ${agent.name}`);
      
      // 30分後にアイドルエージェントを終了
      setTimeout(() => {
        if (agent.status === 'idle' && agent.tasks.length === 0) {
          this.terminateAgent(agentId);
        }
      }, 30 * 60 * 1000);
    }
  }

  /**
   * エージェントのエラーを処理
   * @private
   */
  handleAgentError(agentId, error) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    
    console.error(`❌ [${this.name}] Agent ${agent.name} error:`, error);
    
    // エラーイベントを発信
    this.emit('agentError', {
      agentId,
      agentName: agent.name,
      error
    });
    
    // Workerは永続的なので再起動はしない
    console.log(`⚠️ [${this.name}] ${agent.name} encountered an error but will remain active`);
    // エラー後もidleに戻す（タスクは再割り当て可能）
    agent.status = 'idle';
    agent.errorCount = (agent.errorCount || 0) + 1;
  }

  /**
   * エージェントの終了を処理
   * @private
   */
  handleAgentExit(agentId, code, signal) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    
    // タスクの再割り当て
    for (const taskId of agent.tasks) {
      const task = this.tasks.get(taskId);
      if (task && task.status !== 'completed') {
        console.log(`🔄 [${this.name}] Reassigning task ${taskId}...`);
        this.taskQueue.unshift(task);
      }
    }
    
    // エージェントを削除
    this.agents.delete(agentId);
  }

  /**
   * エージェントを再起動
   * @private
   */
  async restartAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    
    const { type, tasks } = agent;
    
    // 古いエージェントを終了
    this.terminateAgent(agentId);
    
    // 新しいエージェントを生成
    const newAgent = await this.spawnWorker();
    if (newAgent) {
      // タスクを再割り当て
      for (const taskId of tasks) {
        const task = this.tasks.get(taskId);
        if (task && task.status !== 'completed') {
          await this.assignTask(task);
        }
      }
    }
  }

  /**
   * エージェントを終了
   * @private
   */
  terminateAgent(agentId) {
    // Workerは永続的なので終了しない
    const agent = this.agents.get(agentId);
    if (!agent) return;
    
    console.log(`🚫 [${this.name}] ${agent.name} is permanent and will not be terminated`);
    
    // 代わりにidleに戻す
    agent.status = 'idle';
    agent.tasks = [];
  }

  /**
   * 全体のステータスを取得
   */
  getStatus() {
    const agentStatuses = [];
    for (const [agentId, agent] of this.agents) {
      agentStatuses.push({
        id: agentId,
        name: agent.name,
        type: agent.type,
        status: agent.status,
        taskCount: agent.tasks.length,
        uptime: Date.now() - agent.startTime
      });
    }
    
    const taskStatuses = [];
    for (const [taskId, task] of this.tasks) {
      taskStatuses.push({
        id: taskId,
        type: task.type,
        status: task.status,
        assignedTo: task.assignedTo,
        duration: task.completedAt ? task.completedAt - task.startTime : Date.now() - task.startTime
      });
    }
    
    return {
      president: {
        status: 'active',
        uptime: Date.now() - this.stats.startTime
      },
      agents: agentStatuses,
      tasks: taskStatuses,
      stats: this.stats
    };
  }

  /**
   * シャットダウン
   */
  async shutdown() {
    console.log(`🛑 [${this.name}] Shutting down...`);
    
    // 全エージェントを終了
    for (const agentId of this.agents.keys()) {
      this.terminateAgent(agentId);
    }
    
    this.emit('shutdown');
  }
}