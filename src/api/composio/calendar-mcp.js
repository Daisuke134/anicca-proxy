import { Composio } from '@composio/core';

export default async function handler(req, res) {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    const composio = new Composio({
      apiKey: process.env.COMPOSIO_API_KEY,
    });
    
    const serverName = `gcal-${userId}`;
    
    let mcpServer;
    try {
      mcpServer = await composio.mcp.getByName(serverName);
      console.log(`Found existing MCP server: ${serverName}`);
    } catch {
      // Auth configを動的に取得（OpenAI例と同じ方法）
      const authConfigsResponse = await composio.authConfigs.list();
      const googleCalendarAuthConfig = authConfigsResponse.items.find((config) => 
        config.name?.toLowerCase().includes('google') || 
        config.name?.toLowerCase().includes('calendar')
      );
      
      if (!googleCalendarAuthConfig) {
        throw new Error('No Google Calendar auth config found. Please create one first.');
      }
      
      mcpServer = await composio.mcp.create(
        serverName,
        [{
          toolkit: "google-calendar",
          authConfigId: googleCalendarAuthConfig.id,
          allowedTools: [
            "GOOGLECALENDAR_LIST_EVENTS",
            "GOOGLECALENDAR_CREATE_EVENT",
            "GOOGLECALENDAR_UPDATE_EVENT",
            "GOOGLECALENDAR_DELETE_EVENT",
            "GOOGLECALENDAR_GET_EVENT",
            "GOOGLECALENDAR_LIST_CALENDARS"
          ]
        }],
        { isChatAuth: true }
      );
      console.log(`Created new MCP server: ${serverName}`);
    }
    
    // 接続状態確認
    const status = await composio.mcp.getUserConnectionStatus({
      userId: userId,
      id: mcpServer.id
    });
    
    // デバッグログ追加
    console.log('Connection status:', JSON.stringify(status, null, 2));
    
    // 正しい接続判定（connectedToolkitsを確認）
    const toolkits = status.connectedToolkits || {};
    const googleCalendarToolkit = Object.values(toolkits).find(
      tk => tk.toolkit === 'google-calendar' || tk.toolkit === 'googlecalendar'
    );
    
    const isConnected = googleCalendarToolkit && googleCalendarToolkit.type === 'CONNECTED';
    
    if (!isConnected) {
      // 正しい引数順序（userId, serverId, toolkit）
      const authRequest = await composio.mcp.authorize(
        userId,              // 第1引数: userId
        mcpServer.id,        // 第2引数: serverId
        "google-calendar"    // 第3引数: toolkit名
      );
      
      return res.json({ 
        connected: false,
        authUrl: authRequest.redirectUrl,
        message: 'Google Calendar authentication required'
      });
    }
    
    const serverUrls = await composio.mcp.getServer(
      mcpServer.id,
      { userId: userId }
    );
    

    // 正しいURL取得（オブジェクトから）
    const mcpUrl = serverUrls.url?.toString();
    
    if (!mcpUrl) {
      console.error('Invalid server URLs:', serverUrls);
      throw new Error('Failed to get MCP server URL');
    }
    
    return res.json({ 
      connected: true,
      mcpUrl,  
      serverId: mcpServer.id,
      message: 'Google Calendar connected successfully'
    });
    
  } catch (error) {
    console.error('Calendar MCP error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}