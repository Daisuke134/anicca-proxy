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
import { query } from '@anthropic-ai/claude-code';
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
    
    // MCP接続（後で設定）
    this.mcpConnections = null;
    
    // ワークスペース
    this.workspaceRoot = null;
    
    // Slackトークン
    this.slackTokens = null;
    
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
    const systemPrompt = buildWorkerPrompt({
      taskType: task.type,
      workerStats: this.stats,
      userName: task.context?.userName
    });
    
    this.log('info', `Executing ${task.type || 'general'} task...`);
    
    // 進捗を報告
    this.send(createStatusUpdateMessage(task.id, TaskStatus.IN_PROGRESS, 25));
    
    try {
      const messages = [];
      const workingDir = this.workspaceRoot || '/tmp/anicca-agent-workspace';
      
      // プロンプトを組み立て
      const fullPrompt = `${systemPrompt}

作業ディレクトリ: ${workingDir}
プロジェクトごとにサブディレクトリを作成してください。

${this.getTaskSpecificPrompt(task)}

${task.originalRequest}`;
      
      // AbortControllerを作成
      const abortController = new AbortController();
      
      this.log('info', '🎯 Executing task with Claude Code SDK...');
      this.log('info', `📁 Working directory: ${workingDir}`);
      
      // SDKオプションを設定
      const queryOptions = {
        abortController: abortController,
        maxTurns: 30,
        mcpServers: this.mcpConnections || {},
        cwd: workingDir,
        permissionMode: 'bypassPermissions',
        appendSystemPrompt: this.slackTokens ? `
【最重要：Slack報告は必須】
あなたはSlackに接続されています。以下のルールを必ず守ってください。

1. タスク開始前に必ず：
   #anicca_reportチャンネルに報告
   
2. タスク完了時（結果を返す前に必ず）：
   #anicca_reportチャンネルに報告

【絶対的ルール】
- 必ず#anicca_reportチャンネルを使用
- チャンネルが存在しない場合は必ず作成する` : ''
      };
      
      // Claude SDKを直接呼び出し
      const queryIterable = query({
        prompt: fullPrompt,
        options: queryOptions
      });
      
      // メッセージを収集
      for await (const message of queryIterable) {
        messages.push(message);
        this.logSDKMessage(message);
      }
      
      // 進捗を報告
      this.send(createStatusUpdateMessage(task.id, TaskStatus.IN_PROGRESS, 90));
      
      // 結果を取得
      let textResult = '';
      const resultMessage = messages.find(m => m.type === 'result');
      if (resultMessage && resultMessage.result) {
        textResult = resultMessage.result;
      } else {
        const assistantMessages = messages.filter(m => m.type === 'assistant');
        if (assistantMessages.length > 0) {
          const lastAssistant = assistantMessages[assistantMessages.length - 1];
          if (lastAssistant.message?.content) {
            const content = lastAssistant.message.content;
            textResult = content.map((c) => c.text || '').join('\n');
          }
        }
      }
      
      // 結果を整形
      const formattedResult = {
        success: true,
        output: textResult || 'Task completed',
        metadata: {
          executedBy: this.agentName,
          taskType: task.type,
          duration: Date.now() - this.currentTask.startTime
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