import { BaseWorker } from './BaseWorker.js';
import { getSlackTokensForUser } from '../../database.js';
import { previewManager } from '../utils/PreviewManager.js';
import fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import cron from 'node-cron';

/**
 * Worker - 汎用Workerエージェントの実装
 * 
 * BaseWorkerを継承し、実際のClaude接続とMCP設定を行う
 */
class Worker extends BaseWorker {
  constructor() {
    super();
    this.workspaceRoot = null;
    this.cronJobs = new Map(); // cron管理用
  }
  
  /**
   * 初期化処理
   */
  async initialize() {
    try {
      console.log(`🚀 ${this.agentName} is starting initialization...`);
      
      // Workerエージェントタイプを設定
      process.env.CLAUDE_AGENT_TYPE = 'worker';
      console.log('🏷️ Setting CLAUDE_AGENT_TYPE to "worker"');
      
      // Worker専用のワークスペースを設定（Desktop版の判定）
      const isDesktop = process.env.DESKTOP_MODE === 'true';
      this.workspaceRoot = isDesktop 
        ? path.join(os.homedir(), 'Desktop', 'anicca-agent-workspace', `worker-${this.workerNumber}`)
        : `/tmp/worker-${this.workerNumber}-workspace`;
      
      if (!fs.existsSync(this.workspaceRoot)) {
        fs.mkdirSync(this.workspaceRoot, { recursive: true });
      }
      console.log(`📁 Worker${this.workerNumber} workspace: ${this.workspaceRoot}`);
      console.log(`🖥️ Running in ${isDesktop ? 'Desktop' : 'Web'} mode`);
      
      // ClaudeExecutorServiceにWorker専用のworkspaceRootを設定
      if (this.executor && this.executor.setWorkspaceRoot) {
        this.executor.setWorkspaceRoot(this.workspaceRoot);
      }
      
      // getSlackTokensForUserは必要な時に直接呼べるようにしておく
      this.getSlackTokensForUser = getSlackTokensForUser;
      
      console.log(`✅ ${this.agentName} initialization complete`);
      console.log(`📊 ClaudeExecutorService will handle all MCP connections`);
      
      // ワークスペース全体を復元（CLAUDE.md含む）
      await this.loadMemory();
      
      // 定期タスクを初期化（scheduled_tasks.jsonが復元された後）
      await this.initializeScheduledTasks();
      
      // 準備完了を親に通知（IPCHandlerが自動的に行う）
      
    } catch (error) {
      console.error(`❌ ${this.agentName} initialization failed:`, error);
      process.exit(1);
    }
  }
  
  /**
   * カスタムタスク処理（必要に応じてオーバーライド）
   */
  async executeTask(task) {
    // Worker専用のworkspaceRootを確認（既に初期化時に設定済みのはず）
    const isDesktop = process.env.DESKTOP_MODE === 'true';
    this.workspaceRoot = this.workspaceRoot || (isDesktop 
      ? path.join(os.homedir(), 'Desktop', 'anicca-agent-workspace', `worker-${this.workerNumber}`)
      : `/tmp/worker-${this.workerNumber}-workspace`);
    
    // デバッグ: ユーザーID確認
    console.log(`🔍 [${this.agentName}] Task userId sources:`, {
      taskUserId: task.userId || 'not set',
      CURRENT_USER_ID: process.env.CURRENT_USER_ID || 'not set',
      SLACK_USER_ID: process.env.SLACK_USER_ID || 'not set',
      globalCurrentUserId: global.currentUserId || 'not set'
    });
    
    // 特別な処理が必要な場合はここでオーバーライド
    // 例：アプリ作成後の追加処理など
    
    const result = await super.executeTask(task);
    
    // アプリ作成タスクの場合のみプレビューURL処理を実行
    const isAppCreationTask = task.originalRequest && /アプリ|ゲーム|サイト|ページ|ツール|ダッシュボード|作成|作って|作る/.test(task.originalRequest);
    
    if (!isAppCreationTask && result.success) {
      console.log(`📝 Skipping preview URL check (not an app creation task): ${task.originalRequest?.substring(0, 50)}...`);
    }
    
    // 成果物ベースでWebプロジェクトを検出してプレビュー公開
    if (result.success && isAppCreationTask) {
      try {
        console.log(`🔍 Checking for web projects in workspace: ${this.workspaceRoot}`);
        
        if (fs.existsSync(this.workspaceRoot)) {
          const dirs = fs.readdirSync(this.workspaceRoot);
          console.log(`📂 Workspace directories:`, dirs);
          
          // 各ディレクトリをチェックしてindex.htmlを探す
          for (const dir of dirs) {
            // CLAUDE.mdなどのファイルはスキップ
            if (dir.endsWith('.md') || dir.endsWith('.txt')) continue;
            
            const fullPath = path.join(this.workspaceRoot, dir);
            
            // ディレクトリでない場合はスキップ
            if (!fs.statSync(fullPath).isDirectory()) continue;
            
            const indexPath = path.join(fullPath, 'index.html');
            
            // index.htmlが存在すればWebプロジェクトとして公開
            if (fs.existsSync(indexPath)) {
              console.log(`🌐 Found web project with index.html: ${fullPath}`);
              const projectName = dir;
              
              // Desktop版チェック
              const isDesktop = process.env.DESKTOP_MODE === 'true';
              if (!isDesktop) {
                // Web版のみPreviewManagerで公開
                const previewInfo = await previewManager.publishApp(fullPath, {
                  projectName,
                  taskId: task.id,
                  description: task.description,
                  workerName: this.agentName,
                  workerNumber: this.workerNumber,
                  userId: process.env.CURRENT_USER_ID || task.userId
                });
                
                // 結果にプレビュー情報を追加
                result.previewUrl = previewInfo.previewUrl;
                result.appId = previewInfo.appId;
                result.metadata = {
                  ...result.metadata,
                  preview: previewInfo
                };
              } else {
                console.log(`🖥️ Desktop版: プレビューURL生成をスキップ`);
              }
              
              // デバッグ: 結果オブジェクトを確認（Web版のみ）
              if (!isDesktop) {
                console.log(`🌐 App published to preview: ${result.previewUrl}`);
                console.log(`📊 Result object preview URL: ${result.previewUrl}`);
                console.log(`📊 Result metadata preview: ${JSON.stringify(result.metadata.preview, null, 2)}`);
                
                // プレビューURLをSlackに追加投稿
                try {
                  const slackMessage = `[${this.agentName}] 🌐 アプリを見る: ${result.previewUrl}`;
                  
                  // ClaudeセッションでSlackに投稿
                  const slackPrompt = `mcp__http__slack_send_messageツールを使って#anicca_reportチャンネルに以下を投稿してください:
${slackMessage}

これはアプリのプレビューURLです。投稿後は「投稿しました」とだけ返答してください。`;
                  
                  await this.session.sendMessage(slackPrompt);
                  console.log(`📮 Preview URL posted to Slack`);
                } catch (error) {
                  console.error(`Failed to post preview URL to Slack:`, error);
                }
              }
              
              // 最初のWebプロジェクトのみ公開（複数ある場合）
              break;
            }
          }
        }
      } catch (error) {
        console.error('Failed to publish app to preview:', error);
      }
    }
    
    return result;
  }
  
  /**
   * リクエストからプロジェクト名を抽出
   * @private
   */
  extractProjectName(request) {
    if (!request) return null;
    
    // 「〜アプリ」「〜ゲーム」「〜ツール」などのパターンを抽出
    const patterns = [
      /(\S+)アプリ/,
      /(\S+)ゲーム/,
      /(\S+)ツール/,
      /(\S+)ダッシュボード/,
      /(\S+)システム/,
      /(\S+)サイト/,
      /(\S+)ページ/
    ];
    
    for (const pattern of patterns) {
      const match = request.match(pattern);
      if (match) {
        return match[1];
      }
    }
    
    return null;
  }

  /**
   * 定期タスクを初期化
   */
  async initializeScheduledTasks() {
    const tasksPath = path.join(this.workspaceRoot, 'scheduled_tasks.json');
    
    if (fs.existsSync(tasksPath)) {
      const content = fs.readFileSync(tasksPath, 'utf8');
      const { tasks } = JSON.parse(content);
      
      tasks.forEach(task => {
        this.registerCronJob(task);
      });
      
      console.log(`📅 [${this.agentName}] ${tasks.length}個の定期タスクを登録しました`);
      
      // ファイル監視を設定
      this.watchScheduledTasks(tasksPath);
    }
  }

  /**
   * scheduled_tasks.jsonを監視
   */
  watchScheduledTasks(tasksPath) {
    console.log(`👁️ [${this.agentName}] scheduled_tasks.jsonを監視開始`);
    
    fs.watchFile(tasksPath, { interval: 1000 }, async () => {
      console.log(`📝 [${this.agentName}] scheduled_tasks.jsonが変更されました`);
      
      try {
        // 新しい内容を読み込む
        const content = fs.readFileSync(tasksPath, 'utf8');
        const { tasks } = JSON.parse(content);
        
        // 新規タスクを検出して登録
        tasks.forEach(task => {
          if (!this.cronJobs.has(task.id)) {
            this.registerCronJob(task);
            console.log(`➕ [${this.agentName}] 新規定期タスク検出・登録: ${task.description}`);
          }
        });
        
        // 削除されたタスクを検出して停止
        for (const [taskId, job] of this.cronJobs) {
          if (!tasks.find(t => t.id === taskId)) {
            job.stop();
            this.cronJobs.delete(taskId);
            console.log(`➖ [${this.agentName}] 定期タスク削除検出・停止: ${taskId}`);
          }
        }
      } catch (error) {
        console.error(`❌ [${this.agentName}] scheduled_tasks.json読み込みエラー:`, error);
      }
    });
  }

  /**
   * cronジョブを登録
   */
  registerCronJob(task) {
    const job = cron.schedule(task.schedule, async () => {
      console.log(`🔔 [${this.agentName}] 定期タスク実行: ${task.description}`);
      
      // Desktop版で定期タスク実行時はSlackトークンを取得
      if (process.env.DESKTOP_MODE === 'true') {
        try {
          const userId = process.env.CURRENT_USER_ID || process.env.SLACK_USER_ID || global.currentUserId;
          
          if (userId) {
            console.log(`🔑 [${this.agentName}] Fetching Slack tokens for scheduled task...`);
            
            // voiceServerからSlackトークンを取得
            const response = await fetch('http://localhost:8085/api/tools/slack', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'getTokens',
                arguments: {},
                userId: userId
              })
            });
            
            if (response.ok) {
              const data = await response.json();
              if (data.bot_token) {
                // ExecutorServiceにトークンを設定
                if (this.executor) {
                  this.executor.setSlackTokens({
                    bot_token: data.bot_token,
                    user_token: data.user_token,
                    userId: userId
                  });
                  
                  // MCPサーバーを再初期化
                  this.executor.initializeMCPServers();
                  console.log(`✅ [${this.agentName}] Slack tokens set for scheduled task`);
                }
              }
            } else {
              console.log(`⚠️ [${this.agentName}] Failed to fetch Slack tokens for scheduled task`);
            }
          }
        } catch (error) {
          console.error(`❌ [${this.agentName}] Error fetching Slack tokens:`, error);
        }
      }
      
      // 自分自身のhandleTaskAssignmentを直接呼ぶ
      await this.handleTaskAssignment({
        taskId: Date.now().toString(),
        task: {
          originalRequest: task.command,
          userId: task.userId || process.env.CURRENT_USER_ID || process.env.SLACK_USER_ID,
          isScheduledTask: true  // 定期タスクフラグを追加
        }
      });
    }, {
      timezone: task.timezone,
      scheduled: true
    });
    
    this.cronJobs.set(task.id, job);
    console.log(`⏰ [${this.agentName}] Cron登録: ${task.description} (${task.schedule})`);
  }

  /**
   * 定期タスクを追加（動的）
   */
  async addScheduledTask(task) {
    // JSONに追加後、即座にcron登録
    this.registerCronJob(task);
    console.log(`➕ [${this.agentName}] 定期タスク追加: ${task.description}`);
  }

  /**
   * 定期タスクを削除
   */
  async removeScheduledTask(taskId) {
    const job = this.cronJobs.get(taskId);
    if (job) {
      job.stop();
      this.cronJobs.delete(taskId);
      console.log(`➖ [${this.agentName}] 定期タスク削除: ${taskId}`);
    }
  }
  
  /**
   * Worker固有のクリーンアップ
   */
  async cleanup() {
    console.log(`🛑 [${this.agentName}] Starting cleanup...`);
    
    // 全てのcronジョブを停止
    for (const [taskId, job] of this.cronJobs) {
      job.stop();
      console.log(`⏹️ [${this.agentName}] Stopped cron job: ${taskId}`);
    }
    this.cronJobs.clear();
    
    // 親クラスのクリーンアップを呼ぶ
    await super.cleanup();
    
    // ClaudeExecutorServiceのクリーンアップ
    if (this.claudeService) {
      // 必要に応じてクリーンアップ処理
    }
    
    console.log(`✅ [${this.agentName}] Cleanup completed`);
  }
}

// メイン処理
async function main() {
  const worker = new Worker();
  
  // 初期化
  await worker.initialize();
  
  // IPCリスニングを開始
  worker.startListening();
  
  // 親からのメッセージを処理
  process.on('message', async (message) => {
    if (message.type === 'SHUTDOWN') {
      console.log(`🛑 [${worker.agentName}] Received shutdown signal from parent`);
      await worker.cleanup();
      process.exit(0);
    }
  });
  
}

// エントリーポイント
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});