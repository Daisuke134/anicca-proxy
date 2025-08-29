import { Composio } from '@composio/core';
import { OpenAIResponsesProvider } from '@composio/openai';

export default async function handler(req, res) {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    const composio = new Composio({
      apiKey: process.env.COMPOSIO_API_KEY,
      provider: new OpenAIResponsesProvider(),
    });
    
    const serverName = `gcal-${userId}`;
    
    let mcpServer;
    try {
      mcpServer = await composio.mcp.getByName(serverName);
      console.log(`Found existing MCP server: ${serverName}`);
    } catch (error) {
      console.log(`📝 Creating new MCP server: ${serverName}`);
      
      // Auth configを動的に取得
      const authConfigsResponse = await composio.authConfigs.list();
      const googleCalendarAuthConfig = authConfigsResponse.items.find((config) => 
        config.name?.toLowerCase().includes('google') || 
        config.name?.toLowerCase().includes('calendar')
      );
      
      if (!googleCalendarAuthConfig) {
        throw new Error('No Google Calendar auth config found. Please create one first.');
      }
      
      // MCPサーバーを作成（戻り値を使わない）
      await composio.mcp.create(
        serverName,
        [
          {
            authConfigId: googleCalendarAuthConfig.id,
            allowedTools: [
              "GOOGLECALENDAR_LIST_CALENDARS",
              "GOOGLECALENDAR_EVENTS_LIST",
              "GOOGLECALENDAR_CREATE_EVENT",
              "GOOGLECALENDAR_UPDATE_EVENT",
              "GOOGLECALENDAR_DELETE_EVENT",
              "GOOGLECALENDAR_FIND_EVENT"
            ]
          }
        ],
        {
          isChatAuth: false
        }
      );

      // 作成したサーバーの詳細を取得
      const newServer = await composio.mcp.getByName(serverName);
      mcpServer = newServer;
      console.log(`✅ MCP server created: ${newServer.id}`);
    }
    
    // 接続状態確認
    const status = await composio.mcp.getUserConnectionStatus(
      userId,
      mcpServer.id
    );
    
    // デバッグログ追加
    console.log('Connection status:', JSON.stringify(status, null, 2));
    
    // 正しい接続判定（connectedToolkitsを確認）
    const toolkits = status.connectedToolkits || {};
    const googleCalendarToolkit = Object.values(toolkits).find(
      tk => tk.toolkit === 'google-calendar' || tk.toolkit === 'googlecalendar'
    );
    
    const isConnected = googleCalendarToolkit && googleCalendarToolkit.type === 'CONNECTED';
    
    if (!isConnected) {
      // 正しい引数順序（serverId, userId, toolkit）
      const authRequest = await composio.mcp.authorize(
        mcpServer.id,    // 第1引数: serverId
        userId,          // 第2引数: userId
        "google-calendar" // 第3引数: toolkit名
      );
      
      return res.json({ 
        connected: false,
        authUrl: authRequest.redirectUrl,
        message: 'Google Calendar authentication required'
      });
    }
    
    const serverUrls = await composio.mcp.getServer(
      mcpServer.id,
      userId,
      {
        limitTools: [
          "GOOGLECALENDAR_LIST_CALENDARS",
          "GOOGLECALENDAR_EVENTS_LIST",
          "GOOGLECALENDAR_CREATE_EVENT",
          "GOOGLECALENDAR_UPDATE_EVENT",
          "GOOGLECALENDAR_DELETE_EVENT",
          "GOOGLECALENDAR_FIND_EVENT"
        ],
        isChatAuth: true
      }
    );
    
    const mcpUrl = serverUrls[0]?.server_url;
    
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
