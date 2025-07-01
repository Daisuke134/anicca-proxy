// Claude SDK版のthink_with_claude
// デスクトップ版と同じClaudeExecutorServiceを使用

import { ClaudeExecutorService } from '../../services/claudeExecutorService.js';
import { MockDatabase } from '../../services/mockDatabase.js';
import { getSlackTokensForUser } from '../../services/database.js';

// タスク実行状態
let taskState = {
  isExecuting: false,
  currentTask: null,
  startedAt: null
};

// ClaudeExecutorServiceのインスタンス（再利用）
let claudeService = null;

async function initializeService() {
  if (!claudeService) {
    const database = new MockDatabase();
    await database.init();
    claudeService = new ClaudeExecutorService(database);
    console.log('✅ Claude Executor Service initialized for Vercel');
  }
  return claudeService;
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 両方の形式に対応
    let task, context, userId;
    
    console.log('📥 Claude Code request:', {
      bodyKeys: Object.keys(req.body),
      hasArguments: !!req.body.arguments,
      argumentsType: typeof req.body.arguments,
      body: JSON.stringify(req.body, null, 2)
    });
    
    if (req.body.arguments) {
      // デスクトップ版形式: { arguments: { task: "...", context: "...", userId: "..." } }
      const args = typeof req.body.arguments === 'string' 
        ? JSON.parse(req.body.arguments) 
        : req.body.arguments;
      task = args.task;
      context = args.context;
      userId = args.userId;
      console.log('🔧 Using arguments format:', { 
        task: task ? task.substring(0, 50) + '...' : 'none',
        hasContext: !!context,
        userId: userId || 'none',
        userIdType: typeof userId
      });
    } else {
      // Web版形式: { task: "...", context: "...", userId: "..." }
      task = req.body.task;
      context = req.body.context;
      userId = req.body.userId;
      console.log('🔧 Using direct format:', { 
        task: task ? task.substring(0, 50) + '...' : 'none',
        hasContext: !!context,
        userId: userId || 'none',
        userIdType: typeof userId
      });
    }
    
    if (!task) {
      return res.status(400).json({ error: 'Task is required' });
    }

    // userIdがある場合はSlackトークンを取得
    let slackTokens = null;
    if (userId) {
      try {
        slackTokens = await getSlackTokensForUser(userId);
        console.log('🔐 Slack token lookup:', {
          userId: userId,
          tokensFound: !!slackTokens,
          hasBotToken: !!slackTokens?.bot_token,
          hasUserToken: !!slackTokens?.user_token
        });
      } catch (error) {
        console.error('Failed to get Slack tokens:', error);
      }
    }
    
    // ClaudeExecutorServiceを初期化
    const service = await initializeService();
    
    // Slackトークンがある場合は設定
    if (slackTokens) {
      console.log('🔗 Setting Slack tokens in ClaudeExecutorService');
      service.setSlackTokens(slackTokens);
    } else {
      console.log('⚠️ No Slack tokens to set for userId:', userId || 'none');
    }
    
    // 実行状態をチェック（VoiceServerと同じ）
    if (taskState.isExecuting) {
      const elapsed = Date.now() - (taskState.startedAt || 0);
      const elapsedSeconds = Math.floor(elapsed / 1000);
      return res.json({
        success: false,
        error: 'busy',
        message: `現在「${taskState.currentTask}」を実行中です（${elapsedSeconds}秒経過）`,
        currentTask: taskState.currentTask,
        elapsedTime: elapsedSeconds
      });
    }
    
    // タスク実行開始
    taskState.isExecuting = true;
    taskState.currentTask = task;
    taskState.startedAt = Date.now();
    
    console.log(`🚀 Starting task: ${task}`);
    
    try {
      // VoiceServerと同じ形式でexecuteAction呼び出し
      const result = await service.executeAction({
        type: 'general',
        reasoning: task,
        parameters: {
          query: task  // ClaudeExecutorServiceが期待するフォーマット
        },
        context: context || ''
      });
      
      // タスク完了
      taskState.isExecuting = false;
      taskState.currentTask = null;
      taskState.startedAt = null;
      
      console.log(`✅ Task completed: ${task}`);
      
      // VoiceServerと同じレスポンス形式
      return res.json({
        success: true,
        result: {
          response: result.result || 'タスクを完了しました',
          toolsUsed: result.toolsUsed || [],
          generatedFiles: result.generatedFiles || []
        }
      });
      
    } catch (error) {
      // エラー時も状態をリセット
      taskState.isExecuting = false;
      taskState.currentTask = null;
      taskState.startedAt = null;
      
      console.error('Claude execution error:', error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Claude execution failed'
      });
    }

  } catch (error) {
    console.error('think_with_claude error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
} 