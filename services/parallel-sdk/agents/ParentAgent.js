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
      
      // ワークスペース全体を復元（loadMemoryがloadTeamMemoryも呼ぶ）
      await this.loadMemory();
      
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
      
      // Web版専用プロンプトを設定
      if (!isDesktop) {
        // parentPrompts.jsから定期タスク管理プロンプトを取得
        const parentPrompts = buildParentPrompts();
        const scheduledTaskPrompt = parentPrompts.scheduledTaskPrompt || '';
        
        this.webPrompt = `
【作業環境】
- Web版として動作中
- ワークスペース: /tmp/parent-workspace/
- CLAUDE.mdパス: /tmp/parent-workspace/CLAUDE.md

【タスク管理】
- 複数の異なるタスクは必ず別々のWorkerに割り当て
- 各Workerは独立したワークスペースで作業: /tmp/worker-X/
- 例: 「TODOアプリ作って、カレンダー作って」→ Worker1とWorker2に分散

【記憶管理】
- チーム全体の重要情報は /tmp/parent-workspace/CLAUDE.md に記録
- 各Workerの専門性や得意分野を記憶
- ユーザーの傾向や好みを蓄積

${scheduledTaskPrompt}`;
        console.log('🌐 Web mode prompt configured for ParentAgent');
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
      requestTime: Date.now()
    };
    
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
      
      // Desktop版では定期タスク削除チェックをスキップ
      if (process.env.DESKTOP_MODE !== 'true') {
        // Web版のみ定期タスク削除をチェック
        const isDeleteRequest = await this.checkScheduledTaskDeletion(enhancedTask);
        if (isDeleteRequest) {
          return isDeleteRequest; // 削除結果を返す
        }
      }
      
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
      
      // 1. Worker状況を取得
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
        assignments = await this.analyzeAndAssignTasks({
          task: task.originalRequest,
          workers: workerStatus
        });
      }
      
      // 3. タスクを定期と通常に分類
      const scheduledTasks = [];
      const normalTasks = [];
      
      for (const assignment of assignments) {
        const subTask = {
          ...task,
          originalRequest: assignment.task
        };
        
        // 各タスクが定期タスクかチェック
        const isScheduled = await this.checkAndRegisterScheduledTask(subTask, assignment.worker);
        if (isScheduled) {
          // 定期タスクの場合、WorkerにCLAUDE.md記録を指示
          const workerTask = {
            ...task,
            id: `${task.id}-scheduled-${assignment.worker}`,
            originalRequest: `このタスクをCLAUDE.mdに定期タスクとして記録してください：${assignment.task}`
          };
          
          // Workerに記録指示を送信
          await this.assignSpecificTaskToWorker(assignment.worker, workerTask);
          
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
  async checkAndRegisterScheduledTask(task, assignedWorker = null) {
    // Desktop版では定期タスク判定をスキップ
    if (process.env.DESKTOP_MODE === 'true') {
      console.log('🖥️ Desktop mode: skipping scheduled task check, will be handled by Worker');
      return false;
    }
    
    // すでに定期タスクとして実行されている場合はスキップ（無限ループ防止）
    if (task.type === 'scheduled') {
      console.log('📅 Skipping scheduled task check for already scheduled task');
      return false;
    }
    
    if (!this.supabase) {
      console.log('⚠️ Supabase not initialized, skipping scheduled task check');
      return false;
    }

    const prompt = `
以下のタスクが定期実行タスクかどうか判定してください。
${task.timezone ? `ユーザーのタイムゾーン: ${task.timezone}` : ''}

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
  "instruction": "頻度や時間の情報を除いたタスク内容のみ（例：「聖書の一節を15分おきに#anicca_reportチャンネルに送信」→「聖書の一節を#anicca_reportチャンネルに送信」）",
  "frequency": "daily/weekly/hourly/every_Xh/monthly",
  "time": "HH:MM形式（該当する場合）",
  "dayOfWeek": "曜日（weeklyの場合のみ）",
  "intervalHours": 数値（every_Xhの場合のみ）,
  "taskType": "slack_check/email_check/post_message等",
  "timezone": ${task.timezone ? `"${task.timezone}"` : 'null'},
  "nextRun": "次回実行時刻をISO 8601形式のUTCで（例: 2025-01-24T00:00:00Z または 2025-01-24T00:00:00+00:00）"
}

重要な指示：
${task.timezone ? `- timeで指定された時刻は、ユーザーのタイムゾーン（${task.timezone}）のローカル時間として解釈してください
- nextRunは必ずUTC時刻に変換して返してください（末尾はZまたは+00:00形式で）
- 例：timezone="${task.timezone}"でtime="09:00"の場合、そのタイムゾーンの9時をUTCに変換してnextRunに設定` : '- タイムゾーン情報がないため、timeはUTCとして解釈してください'}
- 現在時刻: ${new Date().toISOString()}
- nextRunの計算ルール：
  * 指定時刻が現在時刻より未来（1分後でも）の場合は、必ず今日のその時刻に設定
  * 指定時刻が現在時刻を過ぎている場合のみ、明日のその時刻に設定
  * 例：現在1:47で「1:50に実行」の場合、今日の1:50に設定（明日ではない）
- nextRunの形式は必ず2025-01-24T00:00:00Zまたは2025-01-24T00:00:00+00:00の形式で返す（+00だけはNG）

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
        
        // Supabaseに登録
        const { data, error } = await this.supabase
          .from('scheduled_tasks')
          .insert({
            user_id: task.userId || process.env.CURRENT_USER_ID || process.env.SLACK_USER_ID,
            instruction: parsed.instruction,
            frequency: parsed.frequency,
            time: parsed.time,
            day_of_week: parsed.dayOfWeek,
            interval_hours: parsed.intervalHours,
            task_type: parsed.taskType,
            config: parsed.config || {},
            next_run: parsed.nextRun,
            assigned_to: assignedWorker, // Worker割り当て情報を追加
            timezone: parsed.timezone || task.timezone || null // タイムゾーンを追加
          })
          .select()
          .single();

        if (error) {
          console.error('Failed to register scheduled task:', error);
          return false;
        }

        console.log(`✅ [${this.agentName}] Scheduled task registered:`, data.id);
        
        // ユーザーに確認メッセージを送信
        await this.notifyScheduledTaskRegistered(parsed, parsed.nextRun);
        
        return true; // 定期タスクとして登録済み
      }
      
      return false; // 通常のタスク
      
    } catch (error) {
      console.error('Error checking scheduled task:', error);
      return false;
    }
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
      // JSON返却を期待せず、直接実行
      console.log(`🎯 [${this.agentName}] Executing unified task analysis...`);
      await this.session.sendMessage(prompt);
      
      // 処理完了 - 結果は自動的にexecuteTaskに返される
      console.log(`✅ [${this.agentName}] Task analysis and execution completed`);
      
      // 空の配列を返す（後方互換性のため）
      return [];
    } catch (error) {
      console.error(`❌ [${this.agentName}] Failed to analyze tasks:`, error);
      console.error(`❌ Full error details:`, error.message);
      console.error(`❌ Error stack:`, error.stack);
      
      // エラーの場合も空の配列を返す
      return [];
    }
  }
  
  /**
   * 定期タスク削除リクエストかチェックして削除
   */
  async checkScheduledTaskDeletion(task) {
    // taskオブジェクトから直接userIdを取得
    const userId = task.userId;
    
    if (!userId || userId === 'system') {
      console.error('[DELETION_CHECK] Invalid userId:', userId);
      return null;
    }
    
    console.log('[DELETION_CHECK] Checking deletion for userId:', userId);
    
    // ユーザーの定期タスク一覧を取得
    let userTasks = [];
    if (this.supabase) {
      const { data } = await this.supabase
        .from('scheduled_tasks')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      
      if (data) {
        userTasks = data;
        console.log('[DELETION_CHECK] Found active tasks:', userTasks.length);
      }
    }
    
    const prompt = `
以下のリクエストが定期タスクの削除を要求しているか判定してください。

【リクエスト】
${task.originalRequest}

【現在の定期タスク一覧】
${userTasks.map((t, i) => `${i+1}. ${t.instruction} (ID: ${t.id})`).join('\n')}

【削除リクエストの例】
- 定期タスク削除して
- さっきの定期タスクやめて
- こんにちはの定期タスクを削除
- 毎分のタスクを取り消して
- Slackチェックの定期タスクやめて

削除リクエストの場合、該当するタスクのIDを特定して以下のJSON形式で返してください：
{
  "isDeleteRequest": true,
  "taskId": "削除するタスクのID",
  "targetDescription": "削除対象の説明"
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
      console.log(`[DELETION_CHECK] Parsed response:`, parsed);
      console.log(`[DELETION_CHECK] Task info:`, { taskId: parsed.taskId, userId: task.userId });
      
      if (parsed.isDeleteRequest) {
        console.log(`🗑️ [${this.agentName}] Scheduled task deletion requested: ${parsed.targetDescription}`);
        
        // taskIdが存在しない場合のチェック
        if (!parsed.taskId) {
          console.error(`[DELETION_CHECK] ERROR: No taskId found in parsed response`);
          return {
            success: false,
            output: '削除するタスクのIDが特定できませんでした。',
            metadata: {
              executedBy: this.agentName,
              taskType: 'scheduled_deletion',
              deleted: false
            }
          };
        }
        
        // 削除処理 - task.userIdを使用
        const deleteResult = await this.deleteScheduledTask(task.userId, parsed.taskId);
        
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
  async deleteScheduledTask(userId, taskId) {
    if (!this.supabase) {
      return { deleted: false, message: '定期タスク管理システムが利用できません。' };
    }

    try {
      // Supabaseクライアントの状態確認
      console.log(`[DELETE] Supabase client status:`, this.supabase ? 'initialized' : 'not initialized');
      if (this.supabase && this.supabase.auth) {
        const { data: { user } } = await this.supabase.auth.getUser();
        console.log(`[DELETE] Supabase auth user:`, user ? { id: user.id, email: user.email } : 'No user');
      }
      
      // 削除処理開始ログ
      console.log(`[DELETE] Attempting to update task ${taskId} for user ${userId}`);
      
      // 指定されたタスクを取得
      const { data: targetTask, error: fetchError } = await this.supabase
        .from('scheduled_tasks')
        .select('*')
        .eq('id', taskId)
        .eq('user_id', userId)
        .single();

      if (fetchError || !targetTask) {
        console.error('Failed to fetch scheduled task:', fetchError);
        return { deleted: false, message: '指定された定期タスクが見つかりません。' };
      }

      // 取得したタスクの詳細ログ
      console.log(`[DELETE] Target task:`, targetTask);
      console.log(`[DELETE] userId comparison: DB="${targetTask.user_id}" vs Request="${userId}"`);

      // 更新クエリ実行前ログ
      console.log(`[DELETE] Executing update query...`);
      
      // タスクを削除（実際には無効化）- selectを追加して結果を取得
      const { data: updateData, error: updateError, count } = await this.supabase
        .from('scheduled_tasks')
        .update({ 
          status: 'inactive',
          updated_at: new Date().toISOString()
        })
        .eq('id', String(targetTask.id))
        .eq('user_id', userId)
        .eq('status', 'active')
        .select();

      // 更新結果の詳細ログ
      console.log(`[DELETE] Update result:`, { updateData, updateError, count });

      if (updateError) {
        console.error('Failed to delete scheduled task:', updateError);
        return { deleted: false, message: '定期タスクの削除に失敗しました。' };
      }

      // 更新後の検証
      const { data: verifyData, error: verifyError } = await this.supabase
        .from('scheduled_tasks')
        .select('*')
        .eq('id', taskId)
        .single();
      
      console.log(`[DELETE] Verification after update:`, verifyData);
      if (verifyError) {
        console.log(`[DELETE] Verification error:`, verifyError);
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