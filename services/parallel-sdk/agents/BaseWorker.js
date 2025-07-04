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
    
    // Claudeサービス（後で注入）
    this.claudeService = null;
    
    // MCP接続（後で設定）
    this.mcpConnections = null;
    
    // 統計情報（将来の専門化のため）
    this.stats = {
      completedTasks: 0,
      failedTasks: 0,
      taskTypes: {}
    };
    
    console.log(`🤖 ${this.agentName} (${this.agentId}) is initializing...`);
    this.setupHandlers();
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
   * Claudeサービスを設定
   */
  setClaudeService(claudeService) {
    this.claudeService = claudeService;
    this.log('info', 'Claude service configured');
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
    if (!this.claudeService) {
      throw new Error('Claude service not configured');
    }
    
    // プロンプトを構築
    const prompt = buildWorkerPrompt({
      taskType: task.type,
      workerStats: this.stats,
      userName: task.context?.userName
    });
    
    this.log('info', `Executing ${task.type || 'general'} task...`);
    
    // 進捗を報告
    this.send(createStatusUpdateMessage(task.id, TaskStatus.IN_PROGRESS, 25));
    
    try {
      // Claudeに実行を依頼
      const result = await this.claudeService.executeGeneralRequest({
        prompt: task.originalRequest,
        systemPrompt: prompt,
        context: {
          ...task.context,
          taskId: task.id,
          taskType: task.type,
          agentName: this.agentName
        },
        mcpServers: this.mcpConnections,
        // エージェント専用のプロンプト追加
        appendSystemPrompt: this.getTaskSpecificPrompt(task)
      });
      
      // 進捗を報告
      this.send(createStatusUpdateMessage(task.id, TaskStatus.IN_PROGRESS, 90));
      
      // 結果を整形
      const formattedResult = {
        success: true,
        output: result.output || result,
        metadata: {
          executedBy: this.agentName,
          taskType: task.type,
          duration: Date.now() - this.currentTask.startTime
        }
      };
      
      return formattedResult;
      
    } catch (error) {
      // エラーの詳細を含めて返す
      throw new Error(`Task execution failed: ${error.message}`);
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
   * クリーンアップ処理
   * @override
   */
  async cleanup() {
    this.log('info', 'Shutting down...');
    
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