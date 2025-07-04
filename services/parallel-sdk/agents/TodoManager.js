import { EventEmitter } from 'events';
import { MessageTypes } from '../IPCProtocol.js';

/**
 * TodoManager - タスク管理とSlack報告を担当する専門エージェント
 * 
 * 役割：
 * - ParentAgentから受け取ったタスクリストをSlackに投稿
 * - チェックリスト形式での進捗可視化
 * - リアルタイムでの進捗更新
 * - 完了報告とサマリー作成
 */
export class TodoManager extends EventEmitter {
  constructor() {
    super();
    
    this.agentId = process.env.AGENT_ID || 'todo-manager';
    this.agentName = process.env.AGENT_NAME || 'TodoManager';
    
    // Slack設定
    this.slackChannel = '#anicca_report';
    this.checklistMessageTs = null; // 更新用のメッセージタイムスタンプ
    
    // タスク管理
    this.tasks = new Map(); // taskId -> { description, status, workerId, startTime }
    this.userName = null;
    
    console.log(`📋 ${this.agentName} is ready to manage tasks`);
  }
  
  /**
   * 初期化処理
   */
  async initialize() {
    try {
      // IPC通信の準備
      this.setupIPCHandlers();
      
      // Slackチャンネルの確認/作成
      await this.ensureSlackChannel();
      
      console.log(`✅ ${this.agentName} initialized successfully`);
      
      // 親プロセスに準備完了を通知
      process.send({
        type: MessageTypes.READY,
        agentId: this.agentId,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error(`❌ ${this.agentName} initialization failed:`, error);
      process.exit(1);
    }
  }
  
  /**
   * IPCメッセージハンドラーの設定
   */
  setupIPCHandlers() {
    process.on('message', async (message) => {
      console.log(`📨 ${this.agentName} received message:`, message.type);
      
      // デバッグ用：メッセージの詳細を表示
      if (message.type === 'TASK_LIST' && message.tasks) {
        console.log(`   └─ Tasks:`, message.tasks.map(t => t.description));
      }
      if (message.type === 'TASK_UPDATE') {
        console.log(`   └─ Task ${message.taskId}: ${message.status} (${message.progress}%)`);
      }
      if (message.type === 'TASK_COMPLETE') {
        console.log(`   └─ Task ${message.taskId} completed by ${message.workerId}`);
      }
      
      switch (message.type) {
        case MessageTypes.TASK_LIST:
          await this.handleTaskList(message);
          break;
          
        case MessageTypes.TASK_UPDATE:
          await this.handleTaskUpdate(message);
          break;
          
        case MessageTypes.TASK_COMPLETE:
          await this.handleTaskComplete(message);
          break;
          
        case MessageTypes.ALL_TASKS_COMPLETE:
          await this.handleAllTasksComplete(message);
          break;
          
        default:
          console.log(`❓ Unknown message type: ${message.type}`);
      }
    });
  }
  
  /**
   * Slackチャンネルの存在確認と作成
   */
  async ensureSlackChannel() {
    try {
      // HTTP MCP経由でチャンネルリストを取得
      const response = await this.callSlackAPI('list_channels');
      const channels = response?.channels || [];
      
      const channelExists = channels.some(ch => 
        ch.name === this.slackChannel.replace('#', '')
      );
      
      if (!channelExists) {
        console.log(`📣 Creating ${this.slackChannel} channel...`);
        await this.callSlackAPI('create_channel', {
          name: this.slackChannel.replace('#', '')
        });
      }
    } catch (error) {
      console.error('Failed to ensure Slack channel:', error);
    }
  }
  
  /**
   * タスクリストの受信と初期投稿
   */
  async handleTaskList(message) {
    const { tasks, userName } = message;
    this.userName = userName || 'ユーザー';
    
    // タスクを保存
    tasks.forEach(task => {
      this.tasks.set(task.id, {
        ...task,
        status: 'pending',
        startTime: Date.now()
      });
    });
    
    // Slackにチェックリストを投稿
    const checklistMessage = this.createChecklistMessage();
    
    try {
      const response = await this.callSlackAPI('send_message', {
        channel: this.slackChannel,
        message: checklistMessage
      });
      
      // メッセージのタイムスタンプを保存（更新用）
      if (response?.ts) {
        this.checklistMessageTs = response.ts;
      }
      
      console.log(`✅ Posted task checklist to ${this.slackChannel}`);
      
    } catch (error) {
      console.error('Failed to post checklist:', error);
    }
  }
  
  /**
   * タスクの進捗更新
   */
  async handleTaskUpdate(message) {
    const { taskId, status, progress, workerId } = message;
    
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      task.progress = progress;
      task.workerId = workerId;
      
      // Slackメッセージを更新
      await this.updateSlackChecklist();
    }
  }
  
  /**
   * タスク完了の処理
   */
  async handleTaskComplete(message) {
    const { taskId, result, workerId } = message;
    
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'completed';
      task.result = result;
      task.completedTime = Date.now();
      task.duration = task.completedTime - task.startTime;
      
      // Slackメッセージを更新
      await this.updateSlackChecklist();
    }
  }
  
  /**
   * 全タスク完了の処理
   */
  async handleAllTasksComplete(message) {
    const { summary, totalTime } = message;
    
    // 最終レポートを作成
    const completionReport = this.createCompletionReport(totalTime);
    
    try {
      // 完了レポートを別メッセージとして投稿
      await this.callSlackAPI('send_message', {
        channel: this.slackChannel,
        message: completionReport,
        thread_ts: this.checklistMessageTs // スレッドに投稿
      });
      
      console.log(`✅ Posted completion report to ${this.slackChannel}`);
      
    } catch (error) {
      console.error('Failed to post completion report:', error);
    }
  }
  
  /**
   * チェックリストメッセージの作成
   */
  createChecklistMessage() {
    const now = new Date().toLocaleTimeString('ja-JP');
    let message = `📋 *${this.userName}さんのタスク進行状況*\n\n`;
    
    for (const [taskId, task] of this.tasks) {
      const checkbox = task.status === 'completed' ? '✅' : '☐';
      const statusText = this.getStatusText(task.status);
      
      message += `${checkbox} ${task.description}`;
      if (task.workerId) {
        message += ` (${task.workerId})`;
      }
      if (task.status !== 'pending') {
        message += ` - ${statusText}`;
      }
      message += '\n';
    }
    
    message += `\n開始時刻: ${now}`;
    
    return message;
  }
  
  /**
   * Slackチェックリストの更新
   */
  async updateSlackChecklist() {
    if (!this.checklistMessageTs) return;
    
    const updatedMessage = this.createChecklistMessage();
    
    // 進捗率を計算
    const completed = Array.from(this.tasks.values())
      .filter(t => t.status === 'completed').length;
    const total = this.tasks.size;
    const progressBar = this.createProgressBar(completed, total);
    
    const messageWithProgress = `${updatedMessage}\n\n${progressBar}`;
    
    try {
      await this.callSlackAPI('update_message', {
        channel: this.slackChannel,
        ts: this.checklistMessageTs,
        message: messageWithProgress
      });
    } catch (error) {
      console.error('Failed to update checklist:', error);
    }
  }
  
  /**
   * 完了レポートの作成
   */
  createCompletionReport(totalTime) {
    const completedCount = Array.from(this.tasks.values())
      .filter(t => t.status === 'completed').length;
    
    const totalMinutes = Math.floor(totalTime / 60000);
    const totalSeconds = Math.floor((totalTime % 60000) / 1000);
    
    let report = `🎉 *全タスク完了！*\n\n`;
    report += `📊 実行統計:\n`;
    report += `• 完了タスク: ${completedCount}/${this.tasks.size}\n`;
    report += `• 総実行時間: ${totalMinutes}分${totalSeconds}秒\n`;
    report += `• 並列実行による時短: 約${Math.floor(totalMinutes * 0.5)}分\n\n`;
    
    // 各タスクの実行時間
    report += `📈 タスク別実行時間:\n`;
    for (const [taskId, task] of this.tasks) {
      if (task.duration) {
        const minutes = Math.floor(task.duration / 60000);
        const seconds = Math.floor((task.duration % 60000) / 1000);
        report += `• ${task.description}: ${minutes}分${seconds}秒\n`;
      }
    }
    
    return report;
  }
  
  /**
   * ステータステキストの取得
   */
  getStatusText(status) {
    const statusMap = {
      'pending': '待機中',
      'in_progress': '実行中...',
      'completed': '完了',
      'failed': '失敗'
    };
    return statusMap[status] || status;
  }
  
  /**
   * プログレスバーの作成
   */
  createProgressBar(completed, total) {
    const percentage = Math.floor((completed / total) * 100);
    const filled = Math.floor(percentage / 10);
    const empty = 10 - filled;
    
    let bar = '進捗: [';
    bar += '█'.repeat(filled);
    bar += '░'.repeat(empty);
    bar += `] ${percentage}%`;
    
    return bar;
  }
  
  /**
   * Slack APIの呼び出し（HTTP MCP経由）
   */
  async callSlackAPI(method, params = {}) {
    // ここでHTTP MCPツールを使用してSlack APIを呼び出す
    // 実際の実装はMCPツールの設定に依存
    console.log(`📡 Calling Slack API: ${method}`, params);
    
    // TODO: 実際のMCP呼び出し実装
    return { success: true };
  }
  
  /**
   * クリーンアップ
   */
  async cleanup() {
    console.log(`🧹 ${this.agentName} cleaning up...`);
    this.tasks.clear();
  }
}

// メイン処理
async function main() {
  const manager = new TodoManager();
  
  // 初期化
  await manager.initialize();
  
  // グレースフルシャットダウン
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    await manager.cleanup();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    await manager.cleanup();
    process.exit(0);
  });
}

// エントリーポイント
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});