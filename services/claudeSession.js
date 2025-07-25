import { ClaudeExecutorService } from './claudeExecutorService.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Claude SDKセッション管理クラス
 * 
 * 1つのセッションで継続的な会話を管理
 * コンテキストを保持して自然な対話を実現
 */
export class ClaudeSession {
  constructor(executorService, agentName = 'Agent') {
    this.executorService = executorService;
    this.agentName = agentName;
    this.conversationHistory = [];
    this.sessionStartTime = Date.now();
    this.isActive = true;
    this.sessionId = '';
    this.inMemoryDeviceId = null;
    
    // エージェント別のセッションファイル
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (!homeDir) {
      throw new Error('Cannot determine home directory: HOME or USERPROFILE environment variable not set');
    }
    
    // エージェント名をファイル名に含める
    const safeAgentName = agentName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    this.sessionFile = path.join(homeDir, '.anicca', `session-${safeAgentName}.json`);
    
    // セッションを読み込むか新規作成
    this.loadOrCreateSession();
    
    // 新しいセッション開始時に実行状態をリセット
    if (this.executorService.resetExecutionState) {
      this.executorService.resetExecutionState();
    }
  }
  
  /**
   * セッションIDを生成
   */
  generateSessionId() {
    // エージェント名とタイムスタンプベースのセッションIDを生成
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `ANICCA-${this.agentName}-${timestamp}-${random}`;
  }
  
  /**
   * セッションを読み込むか新規作成
   */
  loadOrCreateSession() {
    try {
      // ディレクトリが存在することを確認
      const configDir = path.dirname(this.sessionFile);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      // 既存のセッションを読み込み
      if (fs.existsSync(this.sessionFile)) {
        try {
          const fileContent = fs.readFileSync(this.sessionFile, 'utf8');
          const sessionData = JSON.parse(fileContent);
          
          // セッションデータの妥当性チェック
          if (sessionData.sessionId && sessionData.createdAt) {
            this.sessionId = sessionData.sessionId;
            this.sessionStartTime = sessionData.createdAt;
            console.log(`
♻️ Resuming ${this.agentName} Session`);
            console.log(`📋 Session ID: ${this.sessionId}`);
            console.log(`🕐 Created at: ${new Date(this.sessionStartTime).toLocaleString('ja-JP')}`);
            console.log(`📊 Conversation count: ${sessionData.conversationCount || 0}`);
            console.log('-'.repeat(50));
            
            // 最終使用時刻を更新
            this.saveSession();
            return;
          }
        } catch (parseError) {
          console.error('⚠️ Session file corrupted, creating new session:', parseError);
          // 破損したファイルを削除
          try {
            fs.unlinkSync(this.sessionFile);
            console.log('🗑️ Removed corrupted session file');
          } catch (deleteError) {
            console.error('Failed to delete corrupted file:', deleteError);
          }
        }
      }
      
      // 新規セッション作成
      this.sessionId = this.generateSessionId();
      console.log(`
🎯 New Persistent ${this.agentName} Session Created`);
      console.log(`📋 Session ID: ${this.sessionId}`);
      console.log(`🕐 Started at: ${new Date(this.sessionStartTime).toLocaleString('ja-JP')}`);
      console.log('-'.repeat(50));
      
      // セッション情報を保存
      this.saveSession();
    } catch (error) {
      console.error('❌ Failed to load session:', error);
      // エラー時は新規セッションとして扱う
      this.sessionId = this.generateSessionId();
      this.saveSession();
    }
  }
  
  /**
   * セッション情報を保存
   */
  saveSession() {
    try {
      const sessionData = {
        sessionId: this.sessionId,
        createdAt: this.sessionStartTime,
        lastUsedAt: Date.now(),
        conversationCount: Math.floor(this.conversationHistory.length / 2),
        agentName: this.agentName
      };
      
      fs.writeFileSync(this.sessionFile, JSON.stringify(sessionData, null, 2));
    } catch (error) {
      console.error('❌ Failed to save session:', error);
    }
  }

  /**
   * メッセージを送信して応答を取得
   * @param {string} userMessage - ユーザーからのメッセージ
   * @param {Object} options - オプション設定
   * @param {boolean} options.raw - 生のレスポンスを返すかどうか
   * @param {number} retryCount - リトライ回数（内部用）
   */
  async sendMessage(userMessage, options = {}, retryCount = 0) {
    console.log(`\n👤 [${this.agentName}] User: "${userMessage}"`);
    
    // 会話履歴に追加
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
      timestamp: Date.now()
    });
    
    // コンテキスト付きのプロンプトを構築
    const contextualPrompt = this.buildContextualPrompt(userMessage);
    
    const startTime = Date.now();
    
    try {
      // ExecutorServiceの実行状態を確認
      const state = this.executorService.getCurrentState();
      
      if (state.isExecuting) {
        console.log('⏳ Waiting for previous task to complete...');
        // 前のタスクが完了するまで最大10秒待機
        const maxWait = 10000;
        const waitStart = Date.now();
        while (this.executorService.getCurrentState().isExecuting) {
          await new Promise(resolve => setTimeout(resolve, 500));
          if (Date.now() - waitStart > maxWait) {
            console.log('❌ Timeout! Force resetting execution state...');
            if (this.executorService.resetExecutionState) {
              this.executorService.resetExecutionState();
            }
            break;
          }
        }
      }
      
      // ExecutorServiceを使用して実行
      const result = await this.executorService.executeAction({
        type: 'general',
        reasoning: 'Session conversation request',
        parameters: {
          query: contextualPrompt
        }
      });
      
      const endTime = Date.now();
      console.log(`⏱️ Response time: ${endTime - startTime}ms`);
      
      if (result.success && result.result) {
        // 応答を会話履歴に追加
        this.conversationHistory.push({
          role: 'assistant',
          content: result.result,
          timestamp: Date.now()
        });
        
        // rawオプションがtrueの場合は整形しない
        if (options.raw) {
          console.log(`🤖 [${this.agentName}] Claude (raw response): length=${result.result.length}`);
          // セッション情報を保存
          this.saveSession();
          return result.result;
        }
        
        // 応答を整形
        const cleanResponse = this.formatResponse(result.result);
        console.log(`🤖 [${this.agentName}] Claude: "${cleanResponse}"`);
        
        // セッション情報を保存
        this.saveSession();
        
        return cleanResponse;
      } else if (result.error === 'Another action is being executed') {
        // キューに入った場合は少し待ってリトライ
        const MAX_RETRIES = 3;
        if (retryCount >= MAX_RETRIES) {
          console.error(`❌ Max retries (${MAX_RETRIES}) exceeded`);
          throw new Error('最大リトライ回数を超えました。しばらく待ってからもう一度お試しください。');
        }
        console.log(`📋 Action was queued, waiting... (retry ${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.sendMessage(userMessage, options, retryCount + 1); // リトライ
      } else {
        throw new Error(result.error || 'No response');
      }
      
    } catch (error) {
      console.error('❌ Session error:', error);
      const errorMessage = 'すみません、エラーが発生しました。もう一度お願いします。';
      
      this.conversationHistory.push({
        role: 'assistant',
        content: errorMessage,
        timestamp: Date.now()
      });
      
      return errorMessage;
    }
  }
  
  /**
   * コンテキスト付きプロンプトを構築
   */
  buildContextualPrompt(userMessage) {
    // 最新の5つの会話を含める
    const recentHistory = this.conversationHistory.slice(-5);
    
    let prompt = `あなたは${this.agentName}です。ユーザーと自然な会話をしてください。

【重要】
- 簡潔に、1-2文で応答してください
- 実行結果は要約して伝えてください

`;
    
    if (recentHistory.length > 0) {
      prompt += '【これまでの会話】\n';
      recentHistory.forEach(msg => {
        const role = msg.role === 'user' ? 'ユーザー' : 'あなた';
        prompt += `${role}: ${msg.content}\n`;
      });
      prompt += '\n';
    }
    
    prompt += `【今回のユーザーの発言】\n${userMessage}\n\n簡潔に応答してください。`;
    
    return prompt;
  }
  
  /**
   * 応答をフォーマット
   */
  formatResponse(response) {
    // 技術的な詳細を除去して自然な会話に
    let formatted = response
      .replace(/通知を送りました[：:]\s*/g, '')
      .replace(/✅\s*/g, '')
      .replace(/Task completed/gi, '完了しました')
      .replace(/\n\n+/g, '。')
      .trim();
    
    // 長すぎる場合は最初の2文まで
    const sentences = formatted.split(/。|！|？/);
    if (sentences.length > 2) {
      formatted = sentences.slice(0, 2).join('。') + '。';
    }
    
    return formatted;
  }
  
  /**
   * セッションを終了
   */
  end() {
    this.isActive = false;
    const duration = Date.now() - this.sessionStartTime;
    console.log(`\n📊 ${this.agentName} Session paused (will resume next time)`);
    console.log(`📋 Session ID: ${this.sessionId}`);
    console.log(`⏱️  Duration: ${Math.round(duration / 1000)}s`);
    console.log(`💬 Total exchanges: ${Math.floor(this.conversationHistory.length / 2)}`);
    console.log(`🕐 Paused at: ${new Date().toLocaleString('ja-JP')}`);
    
    // セッション情報を保存
    this.saveSession();
  }
  
  /**
   * 会話をリセット（セッションは維持）
   */
  reset() {
    this.conversationHistory = [];
    console.log(`🔄 Conversation history cleared (Session: ${this.sessionId})`);
  }
  
  /**
   * 現在のセッション情報を取得
   */
  getSessionInfo() {
    return {
      sessionId: this.sessionId,
      startTime: this.sessionStartTime,
      exchanges: Math.floor(this.conversationHistory.length / 2),
      isActive: this.isActive,
      agentName: this.agentName
    };
  }
}