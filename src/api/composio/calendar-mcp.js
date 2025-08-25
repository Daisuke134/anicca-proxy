import { Composio } from '@composio/core';
import { OpenAIProvider } from '@composio/openai';

export default async function handler(req, res) {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    console.log(`🔗 Calendar MCP request for user: ${userId}`);
    
    const composio = new Composio({
      apiKey: process.env.COMPOSIO_API_KEY,
      provider: new OpenAIProvider(),
    });
    
    const serverName = `gcal-${userId}`;
    
    let mcpServer;
    try {
      mcpServer = await composio.mcp.getByName(serverName);
      console.log(`✅ Found existing server: ${serverName}`);
    } catch {
      mcpServer = await composio.mcp.create(
        serverName,
        [{
          authConfigId: process.env.GOOGLE_CALENDAR_AUTH_CONFIG_ID,
          allowedTools: [
            "GOOGLECALENDAR_LIST_EVENTS",
            "GOOGLECALENDAR_CREATE_EVENT",
            "GOOGLECALENDAR_UPDATE_EVENT",
            "GOOGLECALENDAR_DELETE_EVENT"
          ]
        }],
        { isChatAuth: true }
      );
      console.log(`✅ Created new server: ${serverName}`);
    }
    
    const status = await composio.mcp.getUserConnectionStatus(
      userId,
      mcpServer.id
    );
    
    if (!status.connected) {
      const authRequest = await composio.mcp.authorize(
        userId,
        mcpServer.id,
        "google-calendar"
      );
      
      return res.json({ 
        connected: false,
        authUrl: authRequest.redirectUrl,
        serverId: mcpServer.id
      });
    }
    
    // 🎯 ここでURL形式を詳しく確認
    const serverUrls = await composio.mcp.getServer(
      mcpServer.id,
      userId
    );
    
    console.log('🔍 Raw serverUrls response:', JSON.stringify(serverUrls, null, 2));
    console.log('🔍 serverUrls type:', typeof serverUrls);
    console.log('🔍 serverUrls is array:', Array.isArray(serverUrls));
    
    // さまざまなアクセス方法を試す
    let mcpUrl = null;
    if (Array.isArray(serverUrls)) {
      mcpUrl = serverUrls[0]?.url?.toString();
      console.log('🔍 Array access: serverUrls[0]?.url =', serverUrls[0]?.url);
    } else if (serverUrls && typeof serverUrls === 'object') {
      console.log('🔍 Object keys:', Object.keys(serverUrls));
      mcpUrl = serverUrls.url?.toString() || serverUrls.mcpUrl?.toString();
    }
    
    return res.json({ 
      connected: true,
      mcpUrl,
      serverId: mcpServer.id,
      rawServerUrls: serverUrls,  // デバッグ用
      debug: {
        urlType: typeof serverUrls,
        isArray: Array.isArray(serverUrls),
        keys: typeof serverUrls === 'object' ? Object.keys(serverUrls) : null
      }
    });
    
  } catch (error) {
    console.error('❌ Calendar MCP error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}