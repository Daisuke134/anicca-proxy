import { BaseWorker } from './BaseWorker.js';
import { fork } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { v4: uuidv4 } = require('uuid');
import { loadClaudeMd, saveClaudeMd, appendLearning } from '../../workerMemory.js';
import { getSlackTokensForUser } from '../../database.js';
import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as os from 'os';
import fsSync from 'fs';
import { buildParentPrompts } from '../prompts/parentPrompts.js';

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
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      
      console.log(`✅ ${this.agentName} initialization complete`);
      console.log(`👔 Team composition: ${this.workers.size} workers ready`);
      
      // ParentAgentのCLAUDE.mdを読み込む
      await this.loadTeamMemory();
      
      // Desktop版専用プロンプトを設定
      const isDesktop = process.env.DESKTOP_MODE === 'true';
      if (isDesktop) {
        // parentPrompts.jsから定期タスク管理プロンプトを取得
        const parentPrompts = buildParentPrompts();
        const scheduledTaskPrompt = parentPrompts.scheduledTaskPrompt || '';
        
        this.desktopPrompt = `
【作業環境】
- Desktop版として動作中
- ワークスペース: ~/Desktop/anicca-agent-workspace/parentagent/
- CLAUDE.mdパス: ~/Desktop/anicca-agent-workspace/parentagent/CLAUDE.md

【タスク管理】
- 複数の異なるタスクは必ず別々のWorkerに割り当て
- 各Workerは独立したワークスペースで作業: ~/Desktop/anicca-agent-workspace/worker-X/
- 例: 「TODOアプリ作って、カレンダー作って」→ Worker1とWorker2に分散

【進捗管理】
- 長時間タスクの場合、進捗を定期的に報告
- 完了時はosascriptで統合通知: osascript -e 'display notification "全タスク完了！" with title "ParentAgent"'

【記憶管理】
- チーム全体の重要情報は ~/Desktop/anicca-agent-workspace/parentagent/CLAUDE.md に記録
- 各Workerの専門性や得意分野を記憶
- ユーザーの傾向や好みを蓄積

${scheduledTaskPrompt}`;
        console.log('🖥️ Desktop mode prompt configured for ParentAgent');
        console.log('📋 Scheduled task management prompt included');
      }
      
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
      // 重複タスクチェック
      if (this.lastTask && (Date.now() - this.lastTaskTime) < this.DUPLICATE_WINDOW) {
        const isDuplicate = await this.checkTaskDuplicate(this.lastTask.originalRequest, task.originalRequest);
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
      this.lastTask = task;
      this.lastTaskTime = Date.now();
      
      // 定期タスク削除のチェック
      const isDeleteRequest = await this.checkScheduledTaskDeletion(task);
      if (isDeleteRequest) {
        return isDeleteRequest; // 削除結果を返す
      }
      
      // タスク実行前にユーザーのSlackトークンを取得して設定
      const userId = task.userId || process.env.CURRENT_USER_ID || process.env.SLACK_USER_ID;
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
      // 1. Worker状況を取得
      const workerStatus = this.getWorkerStatus();
      
      // 2. Claudeでタスクを分析して割り当てを決定（定期タスクも含む）
      const assignments = await this.analyzeAndAssignTasks({
        task: task.originalRequest,
        workers: workerStatus
      });
      
      // 3. タスクを定期と通常に分類
      const scheduledTasks = [];
      const normalTasks = [];
      
      for (const assignment of assignments) {
        const subTask = {
          ...task,
          originalRequest: assignment.task
        };
        
        // 各タスクが定期タスクかチェック
        const isScheduled = await this.checkAndRegisterScheduledTask(subTask);
        if (isScheduled) {
          scheduledTasks.push({
            ...assignment,
            registered: true
          });
        } else {
          normalTasks.push(assignment);
        }
      }
      
      // 4. 統合TODOリストを投稿
      await this.postCombinedTodoList(scheduledTasks, normalTasks);
      
      // 定期タスクのみの場合は登録メッセージを返す
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
      
      // 7. タスク管理の学習を記録
      const duration = Date.now() - startTime;
      const totalTasks = normalTasks.length + scheduledTasks.length;
      await this.saveTeamLearning(`${totalTasks}個のタスク（通常:${normalTasks.length}、定期:${scheduledTasks.length}）を処理。所要時間: ${duration}ms`);
      
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
   * 定期タスクかどうかを判定し、必要なら登録
   */
  async checkAndRegisterScheduledTask(task) {
    // Desktop版では定期タスク判定をスキップ
    if (process.env.DESKTOP_MODE === 'true') {
      console.log('🖥️ Desktop mode: skipping scheduled task check, will be handled by Worker');
      return false;
    }
    
    if (!this.supabase) {
      console.log('⚠️ Supabase not initialized, skipping scheduled task check');
      return false;
    }

    const prompt = `
以下のタスクが定期実行タスクかどうか判定してください。

【タスク】
${task.originalRequest}

【定期実行の例】
- 毎日9時にSlackチェック
- 毎週月曜日に会議告知
- 6時間ごとにメール確認
- 毎月1日にレポート作成

定期実行タスクの場合、以下のJSON形式で返してください：
{
  "isScheduled": true,
  "instruction": "元の指示文そのまま",
  "frequency": "daily/weekly/hourly/every_Xh/monthly",
  "time": "HH:MM形式（該当する場合）",
  "dayOfWeek": "曜日（weeklyの場合のみ）",
  "intervalHours": 数値（every_Xhの場合のみ）,
  "taskType": "slack_check/email_check/post_message等"
}

定期実行でない場合：
{
  "isScheduled": false
}`;

    try {
      const response = await this.session.sendMessage(prompt, { raw: true });
      
      // JSONを抽出
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        console.log('Could not extract JSON from response');
        return false;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      if (parsed.isScheduled) {
        console.log(`📅 [${this.agentName}] Detected scheduled task:`, parsed);
        
        // 次回実行時刻を計算
        const nextRun = this.calculateInitialNextRun(parsed);
        
        // Supabaseに登録
        const { data, error } = await this.supabase
          .from('scheduled_tasks')
          .insert({
            user_id: task.userId || process.env.CURRENT_USER_ID || process.env.SLACK_USER_ID,
            instruction: task.originalRequest,
            frequency: parsed.frequency,
            time: parsed.time,
            day_of_week: parsed.dayOfWeek,
            interval_hours: parsed.intervalHours,
            task_type: parsed.taskType,
            config: parsed.config || {},
            next_run: nextRun
          })
          .select()
          .single();

        if (error) {
          console.error('Failed to register scheduled task:', error);
          return false;
        }

        console.log(`✅ [${this.agentName}] Scheduled task registered:`, data.id);
        
        // ユーザーに確認メッセージを送信
        await this.notifyScheduledTaskRegistered(parsed, nextRun);
        
        return true; // 定期タスクとして登録済み
      }
      
      return false; // 通常のタスク
      
    } catch (error) {
      console.error('Error checking scheduled task:', error);
      return false;
    }
  }

  /**
   * 初回実行時刻を計算
   */
  calculateInitialNextRun(taskInfo) {
    const now = new Date();
    let next = new Date();

    switch (taskInfo.frequency) {
      case 'daily':
        const [hours, minutes] = taskInfo.time.split(':').map(Number);
        next.setHours(hours, minutes, 0, 0);
        if (next <= now) {
          next.setDate(next.getDate() + 1);
        }
        break;

      case 'weekly':
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const targetDay = days.indexOf(taskInfo.dayOfWeek.toLowerCase());
        const currentDay = now.getDay();
        
        let daysToAdd = targetDay - currentDay;
        if (daysToAdd <= 0) daysToAdd += 7;
        
        next.setDate(next.getDate() + daysToAdd);
        const [whours, wminutes] = taskInfo.time.split(':').map(Number);
        next.setHours(whours, wminutes, 0, 0);
        break;

      case 'hourly':
        next.setHours(next.getHours() + 1, 0, 0, 0);
        break;

      case 'every_Xh':
        const intervalHours = taskInfo.intervalHours || 6;
        next.setHours(next.getHours() + intervalHours);
        break;

      case 'monthly':
        next.setMonth(next.getMonth() + 1, 1); // 翌月1日
        if (taskInfo.time) {
          const [mhours, mminutes] = taskInfo.time.split(':').map(Number);
          next.setHours(mhours, mminutes, 0, 0);
        }
        break;
    }

    return next.toISOString();
  }

  /**
   * 定期タスク登録完了を通知
   */
  async notifyScheduledTaskRegistered(taskInfo, nextRun) {
    const nextRunDate = new Date(nextRun);
    const formattedDate = nextRunDate.toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    let scheduleText = '';
    switch (taskInfo.frequency) {
      case 'daily':
        scheduleText = `毎日 ${taskInfo.time}`;
        break;
      case 'weekly':
        scheduleText = `毎週${taskInfo.dayOfWeek} ${taskInfo.time}`;
        break;
      case 'hourly':
        scheduleText = '毎時';
        break;
      case 'every_Xh':
        scheduleText = `${taskInfo.intervalHours}時間ごと`;
        break;
      case 'monthly':
        scheduleText = `毎月1日 ${taskInfo.time || ''}`;
        break;
    }

    const message = `mcp__http__slack_send_messageツールを使って#anicca_reportチャンネルに以下を投稿してください:

[ParentAgent] 📅 定期タスクを登録しました
- 内容: ${taskInfo.instruction}
- スケジュール: ${scheduleText}
- 次回実行: ${formattedDate}`;

    await this.executor.executeGeneralRequest({
      type: 'general',
      parameters: { query: message }
    });
  }
  
  /**
   * Claudeでタスクを分析して割り当てを決定
   */
  async analyzeAndAssignTasks(taskInfo) {
    const parentPrompts = buildParentPrompts();
    const desktopAddition = parentPrompts.taskAnalysisAddition || '';
    const scheduledTaskPrompt = parentPrompts.scheduledTaskPrompt || '';
    
    const prompt = `
${scheduledTaskPrompt}

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

${desktopAddition}

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
   * 定期タスク削除リクエストかチェックして削除
   */
  async checkScheduledTaskDeletion(task) {
    const prompt = `
以下のリクエストが定期タスクの削除を要求しているか判定してください。

【リクエスト】
${task.originalRequest}

【削除リクエストの例】
- 定期タスク削除して
- さっきの定期タスクやめて
- こんにちはの定期タスクを削除
- 毎分のタスクを取り消して
- Slackチェックの定期タスクやめて

削除リクエストの場合、以下のJSON形式で返してください：
{
  "isDeleteRequest": true,
  "targetDescription": "削除対象の説明（例：こんにちは、Slackチェック、さっきの）"
}

削除リクエストでない場合：
{
  "isDeleteRequest": false
}`;

    try {
      const response = await this.session.sendMessage(prompt, { raw: true });
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      if (parsed.isDeleteRequest) {
        console.log(`🗑️ [${this.agentName}] Scheduled task deletion requested: ${parsed.targetDescription}`);
        
        // 削除処理
        const deleteResult = await this.deleteScheduledTask(task.userId, parsed.targetDescription);
        
        return {
          success: true,
          output: deleteResult.message,
          metadata: {
            executedBy: this.agentName,
            taskType: 'scheduled_deletion',
            deleted: deleteResult.deleted
          }
        };
      }
      
      return null;
      
    } catch (error) {
      console.error('Error checking scheduled task deletion:', error);
      return null;
    }
  }

  /**
   * 定期タスクを削除
   */
  async deleteScheduledTask(userId, targetDescription) {
    if (!this.supabase) {
      return { deleted: false, message: '定期タスク管理システムが利用できません。' };
    }

    try {
      // ユーザーの定期タスクを取得
      const { data: tasks, error: fetchError } = await this.supabase
        .from('scheduled_tasks')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (fetchError) {
        console.error('Failed to fetch scheduled tasks:', fetchError);
        return { deleted: false, message: '定期タスクの取得に失敗しました。' };
      }

      if (!tasks || tasks.length === 0) {
        return { deleted: false, message: '登録されている定期タスクがありません。' };
      }

      // 削除対象を特定
      let targetTask = null;
      
      if (targetDescription.includes('さっき') || targetDescription.includes('最新') || targetDescription.includes('最後')) {
        // 最新のタスクを削除
        targetTask = tasks[0];
      } else {
        // 説明に一致するタスクを検索
        targetTask = tasks.find(task => 
          task.instruction.includes(targetDescription) ||
          task.task_type.includes(targetDescription)
        );
      }

      if (!targetTask) {
        return { deleted: false, message: `「${targetDescription}」に該当する定期タスクが見つかりません。` };
      }

      // タスクを削除（実際には無効化）
      const { error: updateError } = await this.supabase
        .from('scheduled_tasks')
        .update({ status: 'inactive' })
        .eq('id', targetTask.id);

      if (updateError) {
        console.error('Failed to delete scheduled task:', updateError);
        return { deleted: false, message: '定期タスクの削除に失敗しました。' };
      }

      // Slackに削除通知
      const deleteMessage = `mcp__http__slack_send_messageツールを使って#anicca_reportチャンネルに以下を投稿してください:

[ParentAgent] 🗑️ 定期タスクを削除しました
- 削除内容: ${targetTask.instruction}`;

      await this.executor.executeGeneralRequest({
        type: 'general',
        parameters: { query: deleteMessage }
      });

      // 更新されたTODOリストを投稿
      await this.postUpdatedTodoList(userId);

      return { 
        deleted: true, 
        message: `定期タスク「${targetTask.instruction}」を削除しました。` 
      };

    } catch (error) {
      console.error('Error deleting scheduled task:', error);
      return { deleted: false, message: 'エラーが発生しました。' };
    }
  }

  /**
   * 更新されたTODOリストを投稿
   */
  async postUpdatedTodoList(userId) {
    let todoContent = '[ParentAgent] 📋 TODOリスト（更新）\n';
    
    // 定期タスクを取得
    if (this.supabase) {
      const { data: scheduledTasks } = await this.supabase
        .from('scheduled_tasks')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: true });
      
      if (scheduledTasks && scheduledTasks.length > 0) {
        todoContent += '\n【定期タスク】\n';
        for (const task of scheduledTasks) {
          todoContent += `☐ ${task.instruction}\n`;
        }
      }
    }
    
    // 現在実行中の通常タスク
    const activeTasks = Array.from(this.tasks.values()).filter(t => t.status !== 'completed');
    if (activeTasks.length > 0) {
      todoContent += '\n【通常タスク】\n';
      for (const taskInfo of activeTasks) {
        todoContent += `☐ ${taskInfo.task.originalRequest} (${taskInfo.assignedTo})\n`;
      }
    }
    
    const query = `mcp__http__slack_send_messageを使って#anicca_reportチャンネルに以下を投稿してください:\n\n${todoContent}`;
    
    await this.executor.executeGeneralRequest({
      type: 'general',
      parameters: { query }
    });
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
  
}

// エントリーポイント（直接実行された場合）
if (process.argv[1] === import.meta.url.replace('file://', '')) {
  const parentAgent = new ParentAgent();
  parentAgent.initialize().then(() => {
    parentAgent.startListening();
  });
}