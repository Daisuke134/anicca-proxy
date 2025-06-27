import { aciMcpService } from '../../services/aciMcpService.js';

// MCPサービスの初期化（一度だけ）
let isInitialized = false;

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // MCPサービスを初期化（初回のみ）
    if (!isInitialized) {
      await aciMcpService.initialize();
      isInitialized = true;
    }
    
    // ACI MCPを使って接続済みサービスを確認
    // 現在はSlackのみサポート
    const searchResult = await aciMcpService.searchFunctions('slack list channels');
    
    const connectedServices = [];
    
    // Slack機能が見つかれば接続済みとみなす
    if (searchResult && searchResult.content && searchResult.content.length > 0) {
      try {
        const content = searchResult.content[0];
        if (content.type === 'text') {
          const functions = JSON.parse(content.text);
          const hasSlack = Array.isArray(functions) && 
            functions.some(f => f.app_name?.toLowerCase().includes('slack'));
          
          if (hasSlack) {
            connectedServices.push('slack');
          }
        }
      } catch (e) {
        console.error('Failed to parse ACI response:', e);
      }
    }
    
    return res.status(200).json({
      success: true,
      connectedServices: connectedServices,
      availableServices: ['slack', 'google-calendar', 'github', 'gmail']
    });
    
  } catch (error) {
    console.error('Connected services error:', error);
    res.status(500).json({
      error: 'Failed to get connected services',
      message: error.message
    });
  }
}