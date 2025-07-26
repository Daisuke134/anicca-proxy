import { BaseWorker } from './BaseWorker.js';
import { fork } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { v4: uuidv4 } = require('uuid');
import { loadWorkspace, saveWorkspace } from '../../workerMemory.js';
import { getSlackTokensForUser } from '../../database.js';
import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as os from 'os';
import fsSync from 'fs';
import fs from 'fs';
import { buildParentPrompts, generateUnifiedTaskAnalysisPrompt } from '../prompts/parentPrompts.js';

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
    
    // ParentAgent専用のワークスペースを設定
    const isDesktop = process.env.DESKTOP_MODE === 'true';
    this.workspaceRoot = isDesktop 
      ? path.join(os.homedir(), 'Desktop', 'anicca-agent-workspace', 'parentagent')
      : '/tmp/parent-workspace';
    
    // ワークスペースディレクトリを作成
    if (!fsSync.existsSync(this.workspaceRoot)) {
      fsSync.mkdirSync(this.workspaceRoot, { recursive: true });
    }
    console.log(`📁 ParentAgent workspace: ${this.workspaceRoot}`);
    console.log(`🖥️ Running in ${isDesktop ? 'Desktop' : 'Web'} mode`);
    
    // Supabase初期化
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (supabaseUrl && supabaseServiceKey) {
      this.supabase = createClient(supabaseUrl, supabaseServiceKey);
    }
    
    // 重複送信防止用
    this.lastTask = null;
    this.lastTaskTime = 0;
    this.DUPLICATE_WINDOW = 30000; // 30秒以内の同じタスクは重複とみなす
    
    // 現在のタスクのuserIdを保持
    this.currentUserId = null;
    
    console.log(`👑 ${this.agentName} is initializing as the team leader...`);
  }
  
  /**
   * 初期化処理
   */
  async initialize() {
    try {
      console.log(`🎩 ${this.agentName} is starting initialization...`);
      
      // Workerは遅延起動（最初のタスク受信時にuserIdと共に起動）
      console.log(`👥 Workers will be spawned on first task with correct userId`);
      
      console.log(`✅ ${this.agentName} initialization complete`);
      console.log(`👔 Workers will be spawned on demand`);
      
      // ワークスペース全体を復元（loadMemoryがloadTeamMemoryも呼ぶ）
      await this.loadMemory();
      
      
    } catch (error) {
      console.error(`❌ ${this.agentName} initialization failed:`, error);
      process.exit(1);
    }
  }
  
  /**
   * Slackトークンを設定してMCPサーバーを再初期化
   */
  setSlackTokens(tokens) {
    this.log('info', '🔑 Setting Slack tokens for ParentAgent');
    
    // トークンを保存
    this.slackTokens = tokens;
    
    // ExecutorServiceにトークンを設定
    if (this.executor) {
      this.executor.setSlackTokens(tokens);
      
      // MCPサーバーを再初期化
      this.executor.initializeMCPServers();
      this.log('info', '✅ MCP servers re-initialized with Slack tokens');
    }
  }

  
  /**
   * タスクを受け取って処理（BaseWorkerのexecuteTaskをオーバーライド）
   */
  async executeTask(task) {
    console.log(`📋 [${this.agentName}] Received main task: ${task.originalRequest}`);
    
    // taskオブジェクトに必ずuserIdを含める
    const taskUserId = task.userId || process.env.CURRENT_USER_ID || process.env.SLACK_USER_ID || 'system';
    console.log(`[TASK] userId sources:`, {
      'task.userId': task.userId,
      'env.CURRENT_USER_ID': process.env.CURRENT_USER_ID,
      'env.SLACK_USER_ID': process.env.SLACK_USER_ID,
      'final': taskUserId
    });
    
    // taskオブジェクトを拡張
    const enhancedTask = {
      ...task,
      userId: taskUserId,
      requestTime: Date.now(),
      timezone: task.timezone || 'Asia/Tokyo'  // timezoneを追加
    };
    
    // currentUserIdを保存
    this.currentUserId = taskUserId;
    
    const startTime = Date.now();
    
    try {
      // 重複タスクチェック
      if (this.lastTask && (Date.now() - this.lastTaskTime) < this.DUPLICATE_WINDOW) {
        const isDuplicate = await this.checkTaskDuplicate(this.lastTask.originalRequest, enhancedTask.originalRequest);
        if (isDuplicate) {
          console.log(`🚫 [${this.agentName}] Duplicate task detected, skipping...`);
          return {
            success: true,
            output: '同じタスクが既に処理中です。重複実行を防ぎました。',
            metadata: {
              executedBy: this.agentName,
              skipped: true,
              reason: 'duplicate'
            }
          };
        }
      }
      
      // タスクを記録
      this.lastTask = enhancedTask;
      this.lastTaskTime = Date.now();
      
      
      // タスク実行前にユーザーのSlackトークンを取得して設定
      const userId = enhancedTask.userId;
      if (userId) {
        const isDesktop = process.env.DESKTOP_MODE === 'true';
        
        let slackTokens = null;
        
        if (isDesktop && process.env.SLACK_BOT_TOKEN) {
          // Desktop版：環境変数から取得
          this.log('info', '🔑 Using Slack tokens from environment variables (Desktop mode)');
          slackTokens = {
            bot_token: process.env.SLACK_BOT_TOKEN,
            user_token: process.env.SLACK_USER_TOKEN || '',
            userId: userId
          };
        } else if (!isDesktop) {
          // Web版：Supabaseから取得
          this.log('info', `🔑 Getting Slack tokens for user: ${userId}`);
          try {
            slackTokens = await getSlackTokensForUser(userId);
          } catch (error) {
            this.log('error', `❌ Failed to get Slack tokens: ${error.message}`);
          }
        }
        
        if (slackTokens && slackTokens.bot_token) {
          this.log('info', '✅ Slack tokens found, configuring MCP...');
          
          // ExecutorServiceにトークンを設定
          this.executor.setSlackTokens({
            bot_token: slackTokens.bot_token,
            user_token: slackTokens.user_token,
            userId: userId
          });
          
          // Desktop版の場合、トークンを保存しておく
          if (isDesktop) {
            this.slackTokens = {
              bot_token: slackTokens.bot_token,
              user_token: slackTokens.user_token,
              userId: userId
            };
            this.log('info', '💾 Stored Slack tokens for Desktop mode');
          }
          
          // MCPサーバーを再初期化
          this.executor.initializeMCPServers();
          this.log('info', '✅ MCP servers re-initialized with Slack tokens');
        } else {
          this.log('warn', '⚠️ No Slack tokens found for user');
        }
      }
      
      // 定期タスク実行時（Cronからの自動実行）は早期リターン
      if (task.type === 'scheduled' && task.assignedTo) {
        console.log(`📅 [${this.agentName}] Executing scheduled task directly`);
        
        // assignedToで指定されたWorkerに直接送信
        const taskId = `${task.id || Date.now()}`;
        this.tasks.set(taskId, {
          task: task,
          assignedTo: task.assignedTo,
          status: 'assigned'
        });
        
        await this.assignSpecificTaskToWorker(task.assignedTo, task);
        const result = await this.waitForTaskCompletion(taskId);
        
        return {
          success: true,
          output: '定期タスクを実行しました',
          metadata: {
            executedBy: this.agentName,
            taskType: 'scheduled_execution',
            result: result
          }
        };
      }
      
      // 1. Workerが起動していない場合は起動
      if (this.workers.size === 0) {
        console.log(`🚀 [${this.agentName}] First task received, spawning workers with userId: ${this.currentUserId}`);
        for (let i = 1; i <= this.maxWorkers; i++) {
          await this.spawnWorkerWithUserId(`Worker${i}`, this.currentUserId);
          // 少し待機して順番に起動
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        console.log(`✅ [${this.agentName}] ${this.maxWorkers} workers spawned with userId: ${this.currentUserId}`);
      }
      
      // 2. Worker状況を取得
      const workerStatus = this.getWorkerStatus();
      
      // 2. assignedToがある場合（定期タスク実行）は直接そのWorkerに割り当て
      let assignments;
      if (task.assignedTo) {
        assignments = [{
          worker: task.assignedTo,
          task: task.originalRequest
        }];
        console.log(`📅 [${this.agentName}] Using pre-assigned worker for scheduled task: ${task.assignedTo}`);
      } else {
        // 通常のタスク分析と割り当て
        const result = await this.analyzeAndAssignTasks({
          task: task.originalRequest,
          workers: workerStatus
        });
        
        // resultから assignments と message を取得
        assignments = result.assignments || [];
        const message = result.message;
        
        // 定期タスク確認など、assignmentsが空でmessageがある場合
        if (assignments.length === 0 && message) {
          return {
            success: true,
            output: message,
            metadata: {
              executedBy: this.agentName,
              taskType: 'information'
            }
          };
        }
      }
      
      // 3. すべてのタスクを通常タスクとして扱う（Workerが定期タスク判定を行う）
      const scheduledTasks = [];
      const normalTasks = [...assignments];
      
      // 4. 統合TODOリストを投稿
      await this.postCombinedTodoList(scheduledTasks, normalTasks);
      
      // 定期タスクのみの場合は登録メッセージを返す（現在は常にfalseなので実行されない）
      if (normalTasks.length === 0 && scheduledTasks.length > 0) {
        return {
          success: true,
          output: `${scheduledTasks.length}個の定期タスクを登録しました。`,
          metadata: {
            executedBy: this.agentName,
            taskType: 'scheduled_registration',
            scheduledCount: scheduledTasks.length
          }
        };
      }
      
      // 5. 通常タスクのみを並列で実行
      const taskPromises = normalTasks.map(async (assignment, index) => {
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
      if (normalTasks.length > 0) {
        await this.postCompletionUpdate(normalTasks, scheduledTasks, results);
      }
      
      // 7. タスク処理完了
      const duration = Date.now() - startTime;
      const totalTasks = normalTasks.length + scheduledTasks.length;
      
      // 応答メッセージを構築
      let outputMessage = '';
      if (normalTasks.length > 0) {
        outputMessage += `${normalTasks.length}個のタスクを完了しました`;
      }
      if (scheduledTasks.length > 0) {
        if (outputMessage) outputMessage += '、';
        outputMessage += `${scheduledTasks.length}個の定期タスクを登録しました`;
      }
      
      
      return {
        success: true,
        output: outputMessage || 'タスクを処理しました',
        metadata: {
          executedBy: this.agentName,
          normalTasks: normalTasks,
          scheduledTasks: scheduledTasks,
          taskCount: totalTasks,
          duration: duration
        }
      };
      
    } catch (error) {
      console.error(`❌ [${this.agentName}] Task execution error:`, error);
      throw error;
    }
  }
  
  /**
   * 統合TODOリストをSlackに投稿
   */
  async postCombinedTodoList(scheduledTasks, normalTasks) {
    // Desktop版チェック
    const isDesktop = process.env.DESKTOP_MODE === 'true';
    if (isDesktop) {
      console.log('🖥️ Desktop版: TODOリスト投稿をスキップ');
      return;
    }
    
    let todoContent = '[ParentAgent] 📋 TODOリスト\n';
    
    // 定期タスクセクション
    if (scheduledTasks.length > 0) {
      todoContent += '\n【定期タスク】\n';
      for (const task of scheduledTasks) {
        todoContent += `☐ ${task.task}\n`;
      }
    }
    
    // 通常タスクセクション
    if (normalTasks.length > 0) {
      todoContent += '\n【通常タスク】\n';
      for (const task of normalTasks) {
        todoContent += `☐ ${task.task} (${task.worker})\n`;
      }
    }
    
    // TODOリストがある場合のみ投稿
    if (scheduledTasks.length > 0 || normalTasks.length > 0) {
      const query = `mcp__http__slack_send_messageを使って#anicca_reportチャンネルに以下を投稿してください:\n\n${todoContent}`;
      
      await this.executor.executeGeneralRequest({
        type: 'general',
        parameters: { query }
      });
    }
  }
  
  /**
   * 完了更新をSlackに投稿
   */
  async postCompletionUpdate(normalTasks, scheduledTasks, results) {
    // Desktop版チェック
    const isDesktop = process.env.DESKTOP_MODE === 'true';
    if (isDesktop) {
      console.log('🖥️ Desktop版: 完了更新投稿をスキップ');
      return;
    }
    
    let updateContent = '[ParentAgent] 🔄 TODOリスト更新\n';
    
    // 定期タスクセクション
    if (scheduledTasks.length > 0) {
      updateContent += '\n【定期タスク】\n';
      for (const task of scheduledTasks) {
        updateContent += `✅ ${task.task} (登録完了)\n`;
      }
    }
    
    // 通常タスクセクション
    if (normalTasks.length > 0) {
      updateContent += '\n【通常タスク】\n';
      normalTasks.forEach((task, index) => {
        const result = results[index];
        const previewUrl = result?.previewUrl || result?.metadata?.preview?.previewUrl || '';
        updateContent += `✅ ${task.task} (${task.worker})`;
        if (previewUrl) {
          updateContent += `\n   🌐 アプリを見る: ${previewUrl}`;
        }
        updateContent += '\n';
      });
    }
    
    const totalCount = normalTasks.length + scheduledTasks.length;
    updateContent += `\n進捗: ${totalCount}/${totalCount}完了`;
    
    const query = `mcp__http__slack_send_messageを使って#anicca_reportチャンネルに以下を投稿してください:\n\n${updateContent}`;
    
    await this.executor.executeGeneralRequest({
      type: 'general',
      parameters: { query }
    });
  }
  
  /**
   * 完了報告をSlackに投稿（旧メソッド、後方互換性のため残す）
   */
  async postCompletionReport(task, workerName, result) {
    // デバッグ: 受け取った結果を確認
    console.log(`📊 [${this.agentName}] Received result from ${workerName}:`, {
      hasResult: !!result,
      hasMetadata: !!result?.metadata,
      hasPreview: !!result?.metadata?.preview,
      previewUrl: result?.metadata?.preview?.previewUrl
    });
    
    // previewUrlをトップレベルとmetadataの両方から探す
    const previewUrl = result?.previewUrl || result?.metadata?.preview?.previewUrl || '';
    
    console.log(`🔍 [${this.agentName}] Preview URL found: ${previewUrl ? 'Yes' : 'No'}`);
    
    const query = `mcp__http__slack_send_messageを使って#anicca_reportチャンネルに以下を投稿してください:

[ParentAgent] ✅ 全タスク完了！
✅ ${task.originalRequest} (${workerName})
${previewUrl ? `\n🌐 アプリを見る: ${previewUrl}` : ''}`;
    
    await this.executor.executeGeneralRequest({
      type: 'general',
      parameters: { query }
    });
  }
  
  /**
   * 進捗更新をSlackに投稿（複数タスクの場合に使用）
   */
  async postProgressUpdate(task, completedWorkerName) {
    // Desktop版チェック
    const isDesktop = process.env.DESKTOP_MODE === 'true';
    if (isDesktop) {
      console.log(`🖥️ Desktop版: ${completedWorkerName}のタスク完了（進捗更新スキップ）`);
      return;
    }
    
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
   * 指定されたuserIdでWorkerを起動
   */
  async spawnWorkerWithUserId(workerName, userId) {
    console.log(`🚀 [${this.agentName}] Spawning ${workerName} with userId: ${userId}`);
    
    // 子プロセスとしてWorkerを起動（Slackトークンも渡す）
    const childProcess = fork(this.workerScriptPath, [], {
      env: {
        ...process.env,
        AGENT_ID: `worker-${workerName.toLowerCase()}`,
        AGENT_NAME: workerName,
        WORKER_NUMBER: workerName.replace('Worker', ''),
        // Desktop版判定を確実に渡す
        DESKTOP_MODE: process.env.DESKTOP_MODE,
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
      status: 'idle',
      stats: {}
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
   * Workerを起動（後方互換性のため維持）
   */
  async spawnWorker(workerName) {
    // currentUserIdを優先的に使用
    const userId = this.currentUserId || process.env.SLACK_USER_ID || process.env.CURRENT_USER_ID || global.currentUserId || 'system';
    return this.spawnWorkerWithUserId(workerName, userId);
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
          
          // Desktop版の場合はリアルタイム報告
          const isDesktop = process.env.DESKTOP_MODE === 'true';
          if (isDesktop && this.onTaskComplete) {
            // コールバック経由で完了を通知
            this.onTaskComplete({
              workerName: worker.name,
              task: taskInfo.task.originalRequest || taskInfo.task.task || taskInfo.task.description,
              taskId: taskId,
              completedAt: new Date().toISOString()
            });
          }
          
          // 進捗更新をSlackに投稿
          this.postProgressUpdate(taskInfo.task, worker.name).catch(error => {
            console.error(`Failed to post progress update: ${error.message}`);
          });
        }
        break;
        
      case 'LOG':
        console.log(`📝 [${worker.name}] ${message.payload?.message}`);
        break;
        
      // HEARTBEATは削除（不要なため）
        
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
    const isDesktop = process.env.DESKTOP_MODE === 'true';
    
    // 統合プロンプトを使用
    const prompt = generateUnifiedTaskAnalysisPrompt(
      {
        task: taskInfo.task,
        workers: taskInfo.workers,
        timezone: taskInfo.timezone // Web版の場合のみ使用
      },
      isDesktop
    );
    
    try {
      // Claudeからの応答を取得してJSONをパース
      console.log(`🎯 [${this.agentName}] Executing unified task analysis...`);
      const response = await this.session.sendMessage(prompt, { raw: true });
      
      // JSONを抽出
      const jsonMatch = response.match(/\{[\s\S]*"assignments"[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`❌ No JSON found in response. Full response:`, response);
        return [];
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`🎯 [${this.agentName}] Task assignments:`, parsed.assignments);
      
      return parsed; // 全体を返す（messageフィールドも含めて）
    } catch (error) {
      console.error(`❌ [${this.agentName}] Failed to analyze tasks:`, error);
      console.error(`❌ Full error details:`, error.message);
      console.error(`❌ Error stack:`, error.stack);
      
      // エラーの場合も空のオブジェクトを返す
      return { assignments: [] };
    }
  }
  



  /**
   * タスクが重複しているかをチェック
   */
  async checkTaskDuplicate(previousTask, currentTask) {
    const prompt = `
以下の2つのタスクが同じ内容かどうか判定してください。
表現が違っても、実質的に同じ作業を指示している場合は「同じ」と判定してください。

前のタスク: ${previousTask}
今のタスク: ${currentTask}

判定結果を「同じ」または「違う」の一言で答えてください。
`;

    try {
      const response = await this.session.sendMessage(prompt, { raw: true });
      const result = response.toLowerCase();
      
      // 「同じ」という言葉が含まれていれば重複とみなす
      return result.includes('同じ');
    } catch (error) {
      console.error(`❌ [${this.agentName}] Failed to check duplicate:`, error);
      // エラーの場合は安全のため重複ではないとみなす
      return false;
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
    
    // Desktop版の場合、Slackトークンも一緒に送る
    const isDesktop = process.env.DESKTOP_MODE === 'true';
    const payload = {
      taskId: task.id,
      task: task
    };
    
    if (isDesktop && this.slackTokens) {
      payload.slackTokens = this.slackTokens;
      console.log(`🔑 [${this.agentName}] Sending Slack tokens to ${worker.name} (Desktop mode)`);
    }
    
    // IPCでタスクを送信
    worker.process.send({
      type: 'TASK_ASSIGN',
      payload: payload,
      timestamp: Date.now()
    });
    
    worker.status = 'busy';
    console.log(`🎯 [${this.agentName}] Assigned task to ${worker.name}: ${task.originalRequest.substring(0, 50)}...`);
  }
  
  /**
   * 全てのWorkerを適切にシャットダウン
   */
  async shutdown() {
    console.log(`🛑 [${this.agentName}] Shutting down all workers...`);
    
    // 全てのWorkerにシャットダウンメッセージを送信
    for (const [workerId, worker] of this.workers) {
      if (worker.process && !worker.process.killed) {
        console.log(`🛑 Sending shutdown signal to ${worker.name}...`);
        
        // シャットダウンメッセージを送信
        worker.process.send({
          type: 'SHUTDOWN',
          timestamp: Date.now()
        });
      }
    }
    
    // 少し待機してWorkerが正常終了する時間を与える
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // まだ生きているWorkerを強制終了
    for (const [workerId, worker] of this.workers) {
      if (worker.process && !worker.process.killed) {
        console.log(`⚠️ Force killing ${worker.name}...`);
        worker.process.kill('SIGTERM');
      }
    }
    
    this.workers.clear();
    console.log(`✅ [${this.agentName}] All workers shut down`);
  }
  
}

// エントリーポイント（直接実行された場合）
if (process.argv[1] === import.meta.url.replace('file://', '')) {
  const parentAgent = new ParentAgent();
  parentAgent.initialize().then(() => {
    parentAgent.startListening();
  });
}