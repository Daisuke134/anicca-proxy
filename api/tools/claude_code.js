// Claude SDK版のthink_with_claude
// 並列実行版 - ParentAgentを使用

import { ParentAgent } from '../../services/parallel-sdk/agents/ParentAgent.js';
import { MockDatabase } from '../../services/mockDatabase.js';
import { getSlackTokensForUser } from '../../services/database.js';
import { v4 as uuidv4 } from 'uuid';

// ParentAgentのインスタンス（再利用）
let parentAgent = null;

async function initializeParentAgent(userId = null) {
  console.log('🔄 Checking ParentAgent status...');
  if (!parentAgent) {
    console.log('📦 Creating new ParentAgent instance...');
    
    // userIdを環境変数に設定
    if (userId) {
      process.env.SLACK_USER_ID = userId;
      process.env.CURRENT_USER_ID = userId;
      console.log(`🔑 Setting userId in environment: ${userId}`);
    }
    
    // ParentAgentはBaseWorkerを継承しているので、引数なしで初期化
    parentAgent = new ParentAgent();
    
    console.log('🚀 Initializing ParentAgent...');
    // ParentAgentの初期化（Workerの起動を含む）
    await parentAgent.initialize();
    
    console.log('✅ Parent Agent initialized with persistent session');
    console.log(`📂 Session: ${parentAgent.session.getSessionInfo().sessionId}`);
  } else {
    console.log('♻️ Reusing existing ParentAgent instance');
    console.log(`📂 Session: ${parentAgent.session.getSessionInfo().sessionId}`);
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
    let task, context, userId, timezone;
    
    console.log('📥 Claude Code request:', {
      bodyKeys: Object.keys(req.body),
      hasArguments: !!req.body.arguments,
      argumentsType: typeof req.body.arguments,
      body: JSON.stringify(req.body, null, 2)
    });
    
    if (req.body.arguments) {
      // デスクトップ版形式: { arguments: { task: "...", context: "...", userId: "...", timezone: "..." } }
      const args = typeof req.body.arguments === 'string' 
        ? JSON.parse(req.body.arguments) 
        : req.body.arguments;
      task = args.task;
      context = args.context;
      userId = args.userId;
      timezone = args.timezone;
      console.log('🔧 Using arguments format:', { 
        task: task ? task.substring(0, 50) + '...' : 'none',
        hasContext: !!context,
        userId: userId || 'none',
        userIdType: typeof userId
      });
    } else {
      // Web版形式: { task: "...", context: "...", userId: "...", timezone: "..." }
      task = req.body.task;
      context = req.body.context;
      userId = req.body.userId;
      timezone = req.body.timezone;
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
        // console.log('🔐 Slack token lookup:', {
        //   userId: userId,
        //   tokensFound: !!slackTokens,
        //   hasBotToken: !!slackTokens?.bot_token,
        //   hasUserToken: !!slackTokens?.user_token
        // });
      } catch (error) {
        console.error('Failed to get Slack tokens:', error);
      }
    }
    
    // ParentAgentを初期化（userIdを渡す）
    const agent = await initializeParentAgent(userId);
    
    // Slackトークンがある場合はグローバルに設定（Workerが使用）
    if (slackTokens) {
      console.log('🔗 Setting Slack tokens globally for Workers');
      global.slackTokens = slackTokens;
      global.slackBotToken = slackTokens.bot_token;
      global.slackUserToken = slackTokens.user_token;
      global.currentUserId = userId;  // 実際のuserIdを設定
    } else {
      console.log('⚠️ No Slack tokens to set for userId:', userId || 'none');
      global.currentUserId = userId || null;  // userIdがない場合もnullで設定
    }
    
    console.log(`🚀 Starting task: ${task}`);
    
    try {
      // ParentAgentでタスクを処理（並列実行対応）
      // console.log('🎯 Calling ParentAgent.processUserRequest with:', {
      //   task: task.substring(0, 100) + '...',
      //   hasContext: !!context,
      //   userId: userId || 'none'
      // });
      
      // ParentAgentはBaseWorkerベースなので、executeTaskを使う
      const result = await agent.executeTask({
        id: uuidv4(),
        type: 'general',
        originalRequest: task,
        timezone: timezone || null,
        context: {
          context: context || '',
          userId: userId || null,
          userName: userId || 'ユーザー'
        }
      });
      
      // console.log('📊 ParentAgent result:', {
      //   success: result.success,
      //   tasksCount: result.tasks?.length || 0,
      //   executionTime: result.executionTime
      // });
      
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