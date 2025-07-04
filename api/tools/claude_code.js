// Claude SDK版のthink_with_claude
// 並列実行版 - ParentAgentを使用

import { ClaudeExecutorService } from '../../services/claudeExecutorService.js';
import { ParentAgent } from '../../services/parallel-sdk/ParentAgent.js';
import { MockDatabase } from '../../services/mockDatabase.js';
import { getSlackTokensForUser } from '../../services/database.js';

// タスク実行状態
let taskState = {
  isExecuting: false,
  currentTask: null,
  startedAt: null
};

// ParentAgentのインスタンス（再利用）
let parentAgent = null;

async function initializeParentAgent() {
  if (!parentAgent) {
    const database = new MockDatabase();
    await database.init();
    parentAgent = new ParentAgent({
      database,
      maxConcurrentAgents: 5,  // 同時に最大5つのWorkerを実行可能
      enableTodoManager: true   // TodoManager有効化
    });
    
    // ParentAgentの初期化（TodoManagerの起動を含む）
    await parentAgent.initialize();
    
    console.log('✅ Parent Agent initialized for parallel execution');
  }
  return parentAgent;
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
    
    // ParentAgentを初期化
    const agent = await initializeParentAgent();
    
    // Slackトークンがある場合はグローバルに設定（Workerが使用）
    if (slackTokens) {
      console.log('🔗 Setting Slack tokens globally for Workers');
      global.slackTokens = slackTokens;
      global.slackBotToken = slackTokens.bot_token;
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
      // ParentAgentでタスクを処理（並列実行対応）
      const result = await agent.processUserRequest(task, {
        context: context || '',
        userId: userId || null
      });
      
      // タスク完了
      taskState.isExecuting = false;
      taskState.currentTask = null;
      taskState.startedAt = null;
      
      console.log(`✅ Task completed: ${task}`);
      
      // 結果を統合（複数のWorkerの結果をまとめる）
      const combinedResult = {
        response: result.summary || 'タスクを完了しました',
        toolsUsed: result.toolsUsed || [],
        generatedFiles: result.generatedFiles || [],
        parallelTasks: result.tasks || [],  // 並列実行されたタスクの詳細
        executionTime: result.executionTime || 0
      };
      
      // VoiceServerと同じレスポンス形式
      return res.json({
        success: true,
        result: combinedResult
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