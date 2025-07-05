import { IPCHandler } from '../IPCProtocol.js';
import { 
  MessageTypes, 
  TaskStatus,
  createStatusUpdateMessage,
  createTaskCompleteMessage,
  createErrorMessage,
  createLogMessage
} from '../IPCProtocol.js';
import { buildWorkerPrompt } from '../prompts/workerPrompts.js';
import { ClaudeExecutorService } from '../../claudeExecutorService.js';
import { MockDatabase } from '../../mockDatabase.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

/**
 * BaseWorker - すべてのWorkerエージェントの基底クラス
 * 
 * 汎用的なタスク処理能力を持ち、経験に基づいて
 * 段階的に専門性を獲得していく
 */
export class BaseWorker extends IPCHandler {
  constructor() {
    const agentName = process.env.AGENT_NAME || 'Worker';
    super(agentName);
    
    this.agentId = process.env.AGENT_ID;
    this.workerNumber = process.env.WORKER_NUMBER || '1';
    
    // 現在のタスク
    this.currentTask = null;
    
    // ClaudeExecutorServiceをインスタンス化（エージェント名を渡す）
    const database = new MockDatabase();
    this.executor = new ClaudeExecutorService(database, this.agentName);
    
    // Slackトークンを設定（環境変数またはglobalから）
    const slackBotToken = process.env.SLACK_BOT_TOKEN || global.slackBotToken;
    const slackUserToken = process.env.SLACK_USER_TOKEN || global.slackUserToken;
    const userId = process.env.SLACK_USER_ID || global.currentUserId;
    
    if (slackBotToken) {
      this.executor.setSlackTokens({
        bot_token: slackBotToken,
        user_token: slackUserToken,
        userId: userId || 'system'
      });
      this.log('info', '🔗 Slack tokens configured from environment');
    }
    
    // MCPサーバーを初期化（重要！）
    this.log('info', '🔧 Initializing MCP servers...');
    this.executor.initializeMCPServers().catch(error => {
      this.log('error', `Failed to initialize MCP servers: ${error.message}`);
    });
    
    // 統計情報（将来の専門化のため）
    this.stats = {
      completedTasks: 0,
      failedTasks: 0,
      taskTypes: {}
    };
    
    // プロファイルとインストラクションのパス
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    this.profilePath = path.join(__dirname, '..', 'workers', 'profiles', `${this.agentName.toLowerCase()}.json`);
    this.instructionPath = path.join(__dirname, '..', 'workers', 'instructions', `${this.agentName.toLowerCase()}.md`);
    
    console.log(`🤖 ${this.agentName} (${this.agentId}) is initializing...`);
    this.setupHandlers();
    
    // プロファイルを読み込む
    this.loadProfile();
  }
  
  /**
   * メッセージハンドラーの設定
   * @private
   */
  setupHandlers() {
    // タスク割り当て
    this.on(MessageTypes.TASK_ASSIGN, async (payload) => {
      await this.handleTaskAssignment(payload);
    });
    
    // ステータス要求
    this.on(MessageTypes.STATUS_REQUEST, () => {
      this.reportStatus();
    });
    
    // タスクキャンセル
    this.on(MessageTypes.TASK_CANCEL, (payload) => {
      this.handleTaskCancel(payload.taskId);
    });
  }
  
  
  /**
   * MCP接続を設定
   */
  setMCPConnections(connections) {
    this.mcpConnections = connections;
    this.log('info', `MCP connections configured: ${Object.keys(connections).join(', ')}`);
  }
  
  /**
   * タスク割り当てを処理
   * @private
   */
  async handleTaskAssignment(payload) {
    const { taskId, task } = payload;
    
    this.log('info', `Received task ${taskId}: ${task.description}`);
    this.currentTask = { taskId, task, startTime: Date.now() };
    
    // ステータスを更新
    this.send(createStatusUpdateMessage(taskId, TaskStatus.IN_PROGRESS, 0));
    
    try {
      // タスクを実行
      const result = await this.executeTask(task);
      
      // 統計を更新
      this.stats.completedTasks++;
      const taskType = task.type || 'general';
      this.stats.taskTypes[taskType] = (this.stats.taskTypes[taskType] || 0) + 1;
      
      // 完了を報告
      this.send(createTaskCompleteMessage(taskId, result));
      this.log('info', `Task ${taskId} completed successfully`);
      
    } catch (error) {
      // エラーを報告
      this.stats.failedTasks++;
      this.send(createErrorMessage(error, taskId));
      this.log('error', `Task ${taskId} failed: ${error.message}`);
    } finally {
      this.currentTask = null;
    }
  }
  
  /**
   * タスクを実行
   * @private
   */
  async executeTask(task) {
    // プロンプトを構築
    // console.log(`🔍 Building prompt with workerName: ${this.agentName}`);
    const systemPrompt = buildWorkerPrompt({
      taskType: task.type,
      workerStats: this.stats,
      userName: task.context?.userName,
      workerName: this.agentName
    });
    
    this.log('info', `Executing ${task.type || 'general'} task...`);
    
    // 進捗を報告
    this.send(createStatusUpdateMessage(task.id, TaskStatus.IN_PROGRESS, 25));
    
    try {
      const workingDir = '/tmp/anicca-agent-workspace';
      
      // タスク固有のプロンプトを組み立て
      const fullPrompt = `${systemPrompt}

作業ディレクトリ: ${workingDir}
プロジェクトごとにサブディレクトリを作成してください。

${this.getTaskSpecificPrompt(task)}

${task.originalRequest}`;
      
      // this.log('info', '🎯 Executing task with ClaudeExecutorService...');
      // this.log('info', `📁 Working directory: ${workingDir}`);
      
      // ClaudeExecutorServiceを使用してタスクを実行
      const result = await this.executor.executeGeneralRequest({
        type: 'general',
        parameters: { query: fullPrompt },
        context: { systemPrompt: '' }
      });
      
      // 進捗を報告
      this.send(createStatusUpdateMessage(task.id, TaskStatus.IN_PROGRESS, 90));
      
      if (!result.success) {
        throw new Error(result.error || 'Task execution failed');
      }
      
      // 結果を整形
      const formattedResult = {
        success: true,
        output: result.result || 'Task completed',
        metadata: {
          executedBy: this.agentName,
          taskType: task.type,
          duration: Date.now() - this.currentTask.startTime,
          toolsUsed: result.toolsUsed || [],
          generatedFiles: result.generatedFiles || []
        }
      };
      
      return formattedResult;
      
    } catch (error) {
      this.log('error', `Task execution error: ${error.message}`);
      throw new Error(`Task execution failed: ${error.message}`);
    }
  }
  
  /**
   * SDKメッセージをログ出力
   * @private
   */
  logSDKMessage(message) {
    if (message.type === 'tool_use') {
      this.log('info', `🔧 Using tool: ${message.name}`);
    } else if (message.type === 'assistant') {
      this.log('info', `💬 Assistant message received`);
    } else if (message.type === 'error') {
      this.log('error', `❌ Error: ${message.error}`);
    }
  }
  
  /**
   * タスク固有のプロンプトを取得
   * @private
   */
  getTaskSpecificPrompt(task) {
    let specificPrompt = `\n## 現在のタスク情報\n`;
    specificPrompt += `タスクID: ${task.id}\n`;
    specificPrompt += `タスクタイプ: ${task.type || '汎用'}\n`;
    specificPrompt += `あなたは${this.agentName}として作業しています。\n`;
    
    // アプリ作成タスクの場合
    if (task.originalRequest?.toLowerCase().includes('アプリ') || 
        task.type === 'development') {
      specificPrompt += `\n### アプリ作成の注意事項\n`;
      specificPrompt += `- 作成したアプリは必ず /tmp/preview/app-${task.id}/ に配置してください\n`;
      specificPrompt += `- index.html をエントリーポイントとして作成してください\n`;
      specificPrompt += `- 必要なすべてのファイル（CSS、JS等）を含めてください\n`;
    }
    
    // Slack関連タスクの場合
    if (task.originalRequest?.toLowerCase().includes('slack') || 
        task.type === 'communication') {
      specificPrompt += `\n### Slack操作の注意事項\n`;
      specificPrompt += `- #anicca_report チャンネルに進捗を報告してください\n`;
      specificPrompt += `- チャンネル名は必ず # を付けて指定してください\n`;
    }
    
    return specificPrompt;
  }
  
  /**
   * タスクキャンセルを処理
   * @private
   */
  handleTaskCancel(taskId) {
    if (this.currentTask && this.currentTask.taskId === taskId) {
      this.log('warn', `Task ${taskId} cancelled`);
      this.currentTask = null;
      // Claudeの実行をキャンセル（実装は後で）
    }
  }
  
  /**
   * 現在のステータスを報告
   * @private
   */
  reportStatus() {
    const status = {
      agentId: this.agentId,
      agentName: this.agentName,
      currentTask: this.currentTask ? {
        taskId: this.currentTask.taskId,
        description: this.currentTask.task.description,
        duration: Date.now() - this.currentTask.startTime
      } : null,
      stats: this.stats,
      uptime: process.uptime() * 1000
    };
    
    this.send(createStatusUpdateMessage(
      this.currentTask?.taskId || null,
      this.currentTask ? TaskStatus.IN_PROGRESS : 'idle',
      null
    ));
  }
  
  /**
   * プロファイルを読み込む
   * @private
   */
  async loadProfile() {
    try {
      const profileData = await fs.readFile(this.profilePath, 'utf-8');
      const profile = JSON.parse(profileData);
      
      // 統計情報を復元
      this.stats = {
        completedTasks: profile.totalTasks || 0,
        failedTasks: 0,
        taskTypes: profile.taskTypes || {}
      };
      
      this.personality = profile.personality;
      this.specialization = profile.specialization;
      
      this.log('info', `Profile loaded: ${this.personality}`);
    } catch (error) {
      this.log('warn', `Failed to load profile: ${error.message}`);
    }
  }
  
  /**
   * プロファイルを保存
   * @private
   */
  async saveProfile() {
    try {
      const profile = {
        id: this.agentName,
        name: this.agentName,
        totalTasks: this.stats.completedTasks,
        taskTypes: this.stats.taskTypes,
        specialization: this.specialization,
        personality: this.personality,
        lastActive: new Date().toISOString(),
        successRate: this.stats.completedTasks / (this.stats.completedTasks + this.stats.failedTasks) || 0
      };
      
      await fs.writeFile(this.profilePath, JSON.stringify(profile, null, 2));
      this.log('info', 'Profile saved');
    } catch (error) {
      this.log('error', `Failed to save profile: ${error.message}`);
    }
  }

  /**
   * クリーンアップ処理
   * @override
   */
  async cleanup() {
    this.log('info', 'Shutting down...');
    
    // プロファイルを保存
    await this.saveProfile();
    
    // 現在のタスクがあれば中断を報告
    if (this.currentTask) {
      this.send(createErrorMessage(
        new Error('Agent shutting down'),
        this.currentTask.taskId
      ));
    }
    
    // Claudeサービスのクリーンアップ（必要に応じて）
    // MCPコネクションのクローズ（必要に応じて）
  }
}

// エントリーポイント（直接実行された場合）
if (process.argv[1] === import.meta.url.replace('file://', '')) {
  const worker = new BaseWorker();
  worker.startListening();
}