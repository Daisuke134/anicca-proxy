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
      // Auth configを動的に取得
      const authConfigsResponse = await composio.authConfigs.list();
      console.log('Available auth configs:', authConfigsResponse.items.map(cfg => ({
        id: cfg.id,
        name: cfg.name,
        toolkit: cfg.toolkit
      })));
      
      const googleCalendarAuthConfig = authConfigsResponse.items.find((config) => 
        config.name?.toLowerCase().includes('google') || 
        config.name?.toLowerCase().includes('calendar')
      );
      
      if (!googleCalendarAuthConfig) {
        throw new Error('No Google Calendar auth config found. Please create one first.');
      }
      
      console.log('Using auth config:', {
        id: googleCalendarAuthConfig.id,
        name: googleCalendarAuthConfig.name
      });
      
      // 正しいAPIシグネチャでMCP作成
      try {
        mcpServer = await composio.mcp.create(
          serverName,  // 第1引数: サーバー名（文字列）
          [{           // 第2引数: 設定の配列
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
          { isChatAuth: false }  // 第3引数: デスクトップアプリなのでfalse
        );
        console.log(`Created new MCP server:`, {
          id: mcpServer.id,
          name: mcpServer.name,
          toolkits: mcpServer.toolkits
        });
      } catch (createError) {
        console.error('MCP create error details:', createError);
        throw new Error(`Failed to create MCP server: ${createError.message}`);
      }
    }
    
    // 接続状態確認
    let status;
    try {
      status = await composio.mcp.getUserConnectionStatus(
        userId,
        mcpServer.id
      );
      console.log('Connection status full response:', JSON.stringify(status, null, 2));
    } catch (statusError) {
      console.error('Failed to get connection status:', statusError);
      throw new Error(`Failed to check connection status: ${statusError.message}`);
    }
    
    // 正しい接続判定（connectedToolkitsを確認）
    const toolkits = status.connectedToolkits || {};
    const googleCalendarToolkit = Object.values(toolkits).find(
      tk => tk.toolkit === 'google-calendar' || tk.toolkit === 'googlecalendar'
    );
    
    const isConnected = googleCalendarToolkit && googleCalendarToolkit.type === 'CONNECTED';
    
    if (!isConnected) {
      try {
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
      } catch (authError) {
        console.error('Authorization error:', authError);
        throw new Error(`Failed to initiate authorization: ${authError.message}`);
      }
    }
    
    // サーバーURL取得
    let serverUrls;
    try {
      serverUrls = await composio.mcp.getServer(
        mcpServer.id,
        userId
      );
      console.log('Server URLs response:', JSON.stringify(serverUrls, null, 2));
    } catch (urlError) {
      console.error('Failed to get server URLs:', urlError);
      throw new Error(`Failed to get MCP server URLs: ${urlError.message}`);
    }
    
    // URLを正しく取得（配列の最初の要素のserver_url）
    const mcpUrl = serverUrls[0]?.server_url || serverUrls.server_url || serverUrls.url;
    
    if (!mcpUrl) {
      console.error('Invalid server URLs structure:', serverUrls);
      throw new Error('Failed to get MCP server URL from response');
    }
    
    return res.json({ 
      connected: true,
      mcpUrl,  
      serverId: mcpServer.id,
      message: 'Google Calendar connected successfully'
    });
    
  } catch (error) {
    console.error('Calendar MCP error full stack:', error.stack);
    console.error('Calendar MCP error details:', {
      message: error.message,
      name: error.name,
      code: error.code
    });
    
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}