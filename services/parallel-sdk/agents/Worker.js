import { BaseWorker } from './BaseWorker.js';
import { ClaudeExecutorService } from '../../claudeExecutorService.js';
import { getSlackTokensForUser } from '../../database.js';
import { previewManager } from '../utils/PreviewManager.js';
import fs from 'fs';

/**
 * Worker - 汎用Workerエージェントの実装
 * 
 * BaseWorkerを継承し、実際のClaude接続とMCP設定を行う
 */
class Worker extends BaseWorker {
  constructor() {
    super();
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
      
      // ClaudeExecutorServiceを作成
      // databaseパラメータは実際には使われていないのでnullを渡す
      this.claudeService = new ClaudeExecutorService(null);
      this.setClaudeService(this.claudeService);
      
      // getSlackTokensForUserは必要な時に直接呼べるようにしておく
      this.getSlackTokensForUser = getSlackTokensForUser;
      
      // MCP接続を設定（既存のMCPサービスを使用）
      const mcpConnections = {
        // ファイルシステム（基本）
        filesystem: true,
        
        // Web検索（Exa）
        exa: process.env.EXA_API_KEY ? true : false,
        
        // Slack
        slack: global.slackBotToken ? true : false,
        
        // GitHub
        github: process.env.GITHUB_TOKEN ? true : false,
        
        // その他の利用可能なMCP
        // 将来的に追加
      };
      
      this.setMCPConnections(mcpConnections);
      
      // ClaudeExecutorServiceにもMCP接続を設定
      if (this.claudeService) {
        this.claudeService.mcpServers = mcpConnections;
        
        // Slackトークンがある場合は設定
        if (global.slackBotToken) {
          this.claudeService.slackTokens = {
            bot_token: global.slackBotToken,
            user_token: global.slackUserToken
          };
        }
      }
      
      console.log(`✅ ${this.agentName} initialization complete`);
      console.log(`📊 Available MCPs: ${Object.entries(mcpConnections)
        .filter(([_, enabled]) => enabled)
        .map(([name]) => name)
        .join(', ')}`);
      
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
    // 特別な処理が必要な場合はここでオーバーライド
    // 例：アプリ作成後の追加処理など
    
    const result = await super.executeTask(task);
    
    // アプリ作成タスクの場合、プレビューに公開
    if (result.success && result.generatedFiles && result.generatedFiles.length > 0) {
      try {
        // アプリのルートディレクトリを特定
        const sessionDir = result.sessionDir;
        if (sessionDir && fs.existsSync(sessionDir)) {
          // プロジェクト名を推測
          const projectName = this.extractProjectName(task.originalRequest) || 'app';
          
          // PreviewManagerで公開
          const previewInfo = await previewManager.publishApp(sessionDir, {
            projectName,
            taskId: task.id,
            description: task.description,
            workerName: this.agentName
          });
          
          // 結果にプレビュー情報を追加
          result.previewUrl = previewInfo.previewUrl;
          result.appId = previewInfo.appId;
          result.metadata = {
            ...result.metadata,
            preview: previewInfo
          };
          
          console.log(`🌐 App published to preview: ${previewInfo.previewUrl}`);
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