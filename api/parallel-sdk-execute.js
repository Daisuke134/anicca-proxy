import { ParentAgent } from '../services/parallel-sdk/agents/ParentAgent.js';

let parentAgent = null;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, task } = req.body;
    
    if (!userId || !task) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // ParentAgentを初期化（まだない場合）
    if (!parentAgent) {
      console.log('🚀 Initializing ParentAgent for scheduled tasks...');
      parentAgent = new ParentAgent();
      await parentAgent.initialize();
    }
    
    // 環境変数を設定
    process.env.CURRENT_USER_ID = userId;
    process.env.SLACK_USER_ID = userId;
    
    // タスクを実行
    console.log(`📋 Executing task for user ${userId}:`, task);
    
    const result = await parentAgent.executeTask({
      ...task,
      userId
    });
    
    return res.status(200).json({
      success: true,
      result
    });
    
  } catch (error) {
    console.error('Task execution error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}