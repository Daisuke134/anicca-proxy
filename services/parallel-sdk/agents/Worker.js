import { BaseWorker } from './BaseWorker.js';
import { getSlackTokensForUser } from '../../database.js';
import { previewManager } from '../utils/PreviewManager.js';
import fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Worker - 汎用Workerエージェントの実装
 * 
 * BaseWorkerを継承し、実際のClaude接続とMCP設定を行う
 */
class Worker extends BaseWorker {
  constructor() {
    super();
    this.workspaceRoot = null;
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
      
      // Worker専用のワークスペースを設定
      this.workspaceRoot = `/tmp/worker-${this.workerNumber}-workspace`;
      if (!fs.existsSync(this.workspaceRoot)) {
        fs.mkdirSync(this.workspaceRoot, { recursive: true });
      }
      console.log(`📁 Worker${this.workerNumber} workspace: ${this.workspaceRoot}`);
      
      // getSlackTokensForUserは必要な時に直接呼べるようにしておく
      this.getSlackTokensForUser = getSlackTokensForUser;
      
      console.log(`✅ ${this.agentName} initialization complete`);
      console.log(`📊 ClaudeExecutorService will handle all MCP connections`);
      
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
    this.workspaceRoot = this.workspaceRoot || `/tmp/worker-${this.workerNumber}-workspace`;
    
    // 特別な処理が必要な場合はここでオーバーライド
    // 例：アプリ作成後の追加処理など
    
    const result = await super.executeTask(task);
    
    // デバッグ: タスクタイプとリクエスト内容を確認
    console.log(`🔍 Task type check:`, {
      taskType: task.type,
      originalRequest: task.originalRequest,
      includesApp: task.originalRequest?.includes('アプリ')
    });
    
    // アプリ作成タスクの場合、プレビューに公開
    if (result.success && (task.type === 'development' || task.originalRequest?.includes('アプリ'))) {
      try {
        // プロジェクト名を推測
        let projectName = this.extractProjectName(task.originalRequest) || 'app';
        const appDir = path.join(this.workspaceRoot, projectName);
        
        console.log(`📁 Checking app directory: ${appDir}`);
        
        // ワークスペース内のディレクトリを確認
        let actualAppDir = appDir;
        if (fs.existsSync(this.workspaceRoot)) {
          const dirs = fs.readdirSync(this.workspaceRoot);
          console.log(`📂 Workspace directories:`, dirs);
          
          // アプリっぽいディレクトリを探す
          const appDirs = dirs.filter(dir => 
            dir.includes('app') || 
            dir.includes('todo') || 
            dir.includes('game') || 
            dir.includes('tool')
          );
          
          if (appDirs.length > 0) {
            // 最新のディレクトリを使用
            const actualDirName = appDirs[appDirs.length - 1];
            actualAppDir = path.join(this.workspaceRoot, actualDirName);
            projectName = actualDirName; // プロジェクト名も更新
            console.log(`🎯 Found app directory: ${actualAppDir}`);
          }
        }
        
        if (fs.existsSync(actualAppDir)) {
          // PreviewManagerで公開
          const previewInfo = await previewManager.publishApp(actualAppDir, {
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
          
          // デバッグ: 結果オブジェクトを確認
          console.log(`🌐 App published to preview: ${previewInfo.previewUrl}`);
          console.log(`📊 Result object preview URL: ${result.previewUrl}`);
          console.log(`📊 Result metadata preview: ${JSON.stringify(result.metadata.preview, null, 2)}`);
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
   * Worker固有のクリーンアップ
   */
  async cleanup() {
    await super.cleanup();
    
    // ClaudeExecutorServiceのクリーンアップ
    if (this.claudeService) {
      // 必要に応じてクリーンアップ処理
    }
  }
}

// メイン処理
async function main() {
  const worker = new Worker();
  
  // 初期化
  await worker.initialize();
  
  // IPCリスニングを開始
  worker.startListening();
  
  // グレースフルシャットダウン
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    await worker.cleanup();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    await worker.cleanup();
    process.exit(0);
  });
}

// エントリーポイント
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});