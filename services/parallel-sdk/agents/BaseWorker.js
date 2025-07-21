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
import { ClaudeSession } from '../../claudeSession.js';
import { MockDatabase } from '../../mockDatabase.js';
import { loadClaudeMd, saveClaudeMd, appendLearning } from '../../workerMemory.js';
import { getSlackTokensForUser } from '../../database.js';
import fs from 'fs/promises';
import fsSync from 'fs';
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
    // AGENT_NAMEを先に取得（super()の前に必要）
    const agentName = process.env.AGENT_NAME || 'Worker';
    super(agentName);
    
    this.agentId = process.env.AGENT_ID;
    this.workerNumber = process.env.WORKER_NUMBER || '1';
    
    // 現在のタスク
    this.currentTask = null;
    
    // ClaudeExecutorServiceをインスタンス化（エージェント名を渡す）
    const database = new MockDatabase();
    this.executor = new ClaudeExecutorService(database, this.agentName);
    
    // 永続的なセッションを作成
    this.session = new ClaudeSession(this.executor, this.agentName);
    console.log(`📂 [${this.agentName}] Persistent session initialized`);
    
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
    // 初期化を同期的に待つ
    this.initMCPServers();
    
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
    
    // CLAUDE.mdを読み込む
    this.loadMemory();
    
    // 初期化完了を通知
    this.sendReady();
  }
  
  /**
   * MCPサーバーを初期化
   */
  initMCPServers() {
    try {
      this.executor.initializeMCPServers();
      this.log('info', '✅ MCP servers initialized successfully');
    } catch (error) {
      this.log('error', `❌ Failed to initialize MCP servers: ${error.message}`);
      // MCPが使えなくても続行（エラーはログに記録済み）
    }
  }
  
  /**
   * CLAUDE.mdを読み込む
   */
  async loadMemory() {
    try {
      const userId = process.env.SLACK_USER_ID || process.env.CURRENT_USER_ID || global.currentUserId || 'system';
      console.log(`📚 [${this.agentName}] Loading CLAUDE.md for userId: ${userId}`);
      this.claudeMd = await loadClaudeMd(userId, this.agentName);
      
      if (this.claudeMd) {
        this.log('info', `📚 Loaded CLAUDE.md (${this.claudeMd.length} chars)`);
        
        // CLAUDE.mdの内容をシステムプロンプトに追加
        this.memoryContext = `\n## あなたの記憶（CLAUDE.md）\n${this.claudeMd}\n`;
      }
    } catch (error) {
      this.log('error', `Failed to load CLAUDE.md: ${error.message}`);
      this.memoryContext = '';
    }
  }
  
  /**
   * 学習内容をCLAUDE.mdに保存
   */
  async saveMemory(learning) {
    try {
      const userId = process.env.SLACK_USER_ID || process.env.CURRENT_USER_ID || global.currentUserId || 'system';
      console.log(`💾 [${this.agentName}] Saving to CLAUDE.md for userId: ${userId}`);
      
      // 学習内容を追記
      await appendLearning(userId, this.agentName, learning);
      
      // 更新後のCLAUDE.mdを再読み込み
      await this.loadMemory();
      
      this.log('info', `💾 Saved learning to CLAUDE.md: ${learning}`);
    } catch (error) {
      this.log('error', `Failed to save to CLAUDE.md: ${error.message}`);
    }
  }
  
  /**
   * 準備完了を親に通知
   */
  sendReady() {
    if (process.send) {
      process.send({
        type: 'READY',
        payload: {
          agentName: this.agentName,
          agentId: this.agentId
        },
        timestamp: Date.now()
      });
    }
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
    const { taskId, task, slackTokens } = payload;
    
    this.log('info', `Received task ${taskId}: ${task.originalRequest || task.task || task.description || 'No description'}`);
    this.currentTask = { taskId, task, startTime: Date.now() };
    
    // Desktop版でSlackトークンが渡された場合
    if (slackTokens) {
      this.log('info', '🔑 Received Slack tokens from ParentAgent (Desktop mode)');
      this.executor.setSlackTokens(slackTokens);
      // MCPサーバーを再初期化
      this.executor.initializeMCPServers();
      this.log('info', '✅ MCP servers re-initialized with received tokens');
    }
    
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
      
      // タスク完了後もプロセスを維持（アイドル状態へ）
      await this.enterIdleMode();
      
    } catch (error) {
      // エラーを報告
      this.stats.failedTasks++;
      this.send(createErrorMessage(error, taskId));
      this.log('error', `Task ${taskId} failed: ${error.message}`);
      
      // エラー後もプロセスを維持
      await this.enterIdleMode();
    } finally {
      this.currentTask = null;
    }
  }
  
  /**
   * タスクを実行
   * @private
   */
  async executeTask(task) {
    this.log('info', `Executing ${task.type || 'general'} task...`);
    
    // 進捗を報告
    this.send(createStatusUpdateMessage(task.id, TaskStatus.IN_PROGRESS, 25));
    
    try {
      // Desktop版以外の場合のみSupabaseからトークン取得
      if (process.env.DESKTOP_MODE !== 'true') {
        // タスク実行前にユーザーのSlackトークンを取得して設定
        const userId = task.userId || process.env.CURRENT_USER_ID || process.env.SLACK_USER_ID;
        if (userId && typeof getSlackTokensForUser === 'function') {
          this.log('info', `🔑 Getting Slack tokens for user: ${userId}`);
          try {
            const slackTokens = await getSlackTokensForUser(userId);
            if (slackTokens && slackTokens.bot_token) {
              this.log('info', '✅ Slack tokens found, configuring MCP...');
              
              // ExecutorServiceにトークンを設定
              this.executor.setSlackTokens({
                bot_token: slackTokens.bot_token,
                user_token: slackTokens.user_token,
                userId: userId
              });
              
              // MCPサーバーを再初期化
              this.executor.initializeMCPServers();
              this.log('info', '✅ MCP servers re-initialized with Slack tokens');
            } else {
              this.log('warn', '⚠️ No Slack tokens found for user');
            }
          } catch (error) {
            this.log('error', `❌ Failed to get Slack tokens: ${error.message}`);
          }
        }
      }
      
      // Worker専用の作業ディレクトリを使用（Worker.jsで設定済み）
      const workingDir = this.workspaceRoot || `/tmp/worker-${this.workerNumber}-workspace`;
      
      // Desktop版チェック
      const isDesktop = process.env.DESKTOP_MODE === 'true';
      
      // Worker用プロンプトを構築
      const prompt = `
${buildWorkerPrompt({
  taskType: task.type,
  workerStats: this.stats,
  userName: task.context?.userName,
  workerName: this.agentName
})}

${this.memoryContext || ''}

【受け取ったタスク】
${task.originalRequest}

${isDesktop ? `
【実行手順】
1. タスクを実行

2. 重要な学習事項があれば ${workingDir}/CLAUDE.md に記録:
   - ユーザーの好みや傾向（例：ダークモード好き）
   - 新しく学んだ技術やパターン
   - 今後に活かせる知見
   - 「覚えて」と言われた内容は必ず記録
` : `
【実行手順】
1. まず#anicca_reportチャンネルに開始報告:
   [${this.agentName}] 🚀 タスク開始: ${task.originalRequest}

2. タスクを実行

3. 完了したら#anicca_reportチャンネルに報告:
   [${this.agentName}] ✅ タスク完了: ${task.originalRequest}
   
   【重要】アプリ作成タスクの場合:
   - ローカルパス（/tmp/...）は投稿しないでください
   - 「場所: /tmp/...」という形式は使わないでください
   - プレビューURLは別途自動的に投稿されます

4. 重要な学習事項があれば ${workingDir}/CLAUDE.md に記録:
   - ユーザーの好みや傾向（例：ダークモード好き）
   - 新しく学んだ技術やパターン
   - 今後に活かせる知見
   - 「覚えて」と言われた内容は必ず記録

必ずmcp__http__slack_send_messageツールを使用してSlackに投稿してください。
`}

作業ディレクトリ: ${workingDir}
プロジェクトごとにサブディレクトリを作成してください。
`;
      
      // セッションを使用して実行
      const result = await this.session.sendMessage(prompt);
      
      // 進捗を報告
      this.send(createStatusUpdateMessage(task.id, TaskStatus.IN_PROGRESS, 90));
      
      // 結果を整形
      const taskStartTime = this.currentTask?.startTime || Date.now();
      const formattedResult = {
        success: true,
        output: result,
        metadata: {
          executedBy: this.agentName,
          taskType: task.type,
          duration: Date.now() - taskStartTime
        }
      };
      
      // WorkerがCLAUDE.mdに保存した内容をSupabaseに転送
      await this.syncClaudeMdToSupabase(workingDir);
      
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
    let currentTaskInfo = null;
    if (this.currentTask) {
      const startTime = this.currentTask.startTime || Date.now();
      currentTaskInfo = {
        taskId: this.currentTask.taskId,
        description: this.currentTask.task.description,
        duration: Date.now() - startTime
      };
    }
    
    const status = {
      agentId: this.agentId,
      agentName: this.agentName,
      currentTask: currentTaskInfo,
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
   * アイドルモードに入る
   * タスク完了後もプロセスを維持し、定期的にheartbeatを送信
   */
  async enterIdleMode() {
    this.log('info', `💤 ${this.agentName} entering idle mode...`);
    
    // 即座に一度heartbeatを送信
    this.send({
      type: MessageTypes.HEARTBEAT,
      payload: {
        status: 'idle',
        agentName: this.agentName,
        stats: this.stats
      }
    });
    
    // 定期的なheartbeat送信（30秒ごと）
    if (!this.heartbeatInterval) {
      this.heartbeatInterval = setInterval(() => {
        this.send({
          type: MessageTypes.HEARTBEAT,
          payload: {
            status: 'idle',
            agentName: this.agentName,
            stats: this.stats,
            timestamp: Date.now()
          }
        });
      }, 30000); // 30秒ごと
    }
  }

  /**
   * CLAUDE.mdをSupabaseに同期
   * @private
   */
  async syncClaudeMdToSupabase(workingDir) {
    try {
      // Desktop版チェック
      const isDesktop = process.env.DESKTOP_MODE === 'true';
      if (isDesktop) {
        this.log('info', '🖥️ Desktop版: Supabase同期をスキップ');
        return;
      }
      
      const claudeMdPath = path.join(workingDir, 'CLAUDE.md');
      
      // ファイルが存在するか確認
      if (fsSync.existsSync(claudeMdPath)) {
        this.log('info', `📄 Found CLAUDE.md at ${claudeMdPath}`);
        
        // ファイルを読み込む
        const content = await fs.readFile(claudeMdPath, 'utf-8');
        const userId = process.env.SLACK_USER_ID || process.env.CURRENT_USER_ID || global.currentUserId || 'system';
        
        // デバッグ: userIdの取得元を確認
        console.log(`🔍 [${this.agentName}] syncClaudeMdToSupabase userId sources:`, {
          SLACK_USER_ID: process.env.SLACK_USER_ID || 'not set',
          CURRENT_USER_ID: process.env.CURRENT_USER_ID || 'not set',
          globalCurrentUserId: global.currentUserId || 'not set',
          finalUserId: userId
        });
        
        // 既存の内容と新しい内容をマージ
        const existingContent = await loadClaudeMd(userId, this.agentName);
        let mergedContent = existingContent;
        
        // 新しい内容を追加（重複を避ける）
        if (!existingContent.includes(content)) {
          mergedContent = existingContent + '\n' + content;
        }
        
        // Supabase Storageに保存
        await saveClaudeMd(userId, this.agentName, mergedContent);
        this.log('info', `✅ Synced CLAUDE.md to Supabase for ${this.agentName}`);
        
        // ローカルファイルを削除（オプション）
        // await fs.unlink(claudeMdPath);
      } else {
        this.log('info', `No CLAUDE.md found at ${claudeMdPath}`);
      }
    } catch (error) {
      this.log('error', `Failed to sync CLAUDE.md: ${error.message}`);
    }
  }
  
  /**
   * クリーンアップ処理
   * @override
   */
  async cleanup() {
    this.log('info', 'Shutting down...');
    
    // heartbeatインターバルをクリア
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
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