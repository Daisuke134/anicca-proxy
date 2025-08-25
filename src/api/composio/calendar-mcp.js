import { Composio } from '@composio/core';

export default async function handler(req, res) {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    console.log(`[Calendar MCP] Starting for userId: ${userId}`);
    
    const composio = new Composio({
      apiKey: process.env.COMPOSIO_API_KEY,
    });
    
    const serverName = `gcal-${userId}`;
    
    let mcpServer;
    try {
      mcpServer = await composio.mcp.getByName(serverName);
      console.log(`[Calendar MCP] Found existing MCP server: ${serverName}`);
    } catch {
      console.log(`[Calendar MCP] Creating new MCP server: ${serverName}`);
      
      // Auth configを動的に取得
      let authConfigsResponse;
      try {
        authConfigsResponse = await composio.authConfigs.list();
        console.log(`[Calendar MCP] Found ${authConfigsResponse.items.length} auth configs`);
        
        // デバッグ: 全Auth Configsをログ出力
        authConfigsResponse.items.forEach((config, index) => {
          console.log(`[Calendar MCP] Auth Config ${index}: name="${config.name}", id="${config.id}"`);
        });
      } catch (error) {
        console.error('[Calendar MCP] Failed to list auth configs:', error);
        throw new Error('Failed to retrieve auth configurations from Composio');
      }
      
      const googleCalendarAuthConfig = authConfigsResponse.items.find((config) => 
        config.name?.toLowerCase().includes('google') || 
        config.name?.toLowerCase().includes('calendar')
      );
      
      if (!googleCalendarAuthConfig) {
        console.error('[Calendar MCP] No Google Calendar auth config found');
        console.error('[Calendar MCP] Available auth configs:', authConfigsResponse.items.map(c => c.name));
        throw new Error('No Google Calendar auth config found. Please create one at platform.composio.dev');
      }
      
      console.log(`[Calendar MCP] Using auth config: ${googleCalendarAuthConfig.name} (${googleCalendarAuthConfig.id})`);
      
      // ✅ 正しい形式でMCPサーバーを作成（公式リポジトリ準拠）
      try {
        mcpServer = await composio.mcp.create(
          serverName,                                    // 第1引数: サーバー名（文字列）
          [                                              // 第2引数: ツールキット設定の配列
            {
              toolkit: "googlecalendar",                 // 必須フィールド（公式インターフェース準拠）
              authConfigId: googleCalendarAuthConfig.id, // authConfigId（単数形、公式ドキュメント準拠）
              allowedTools: []                           // 空配列 = 全ツールを許可
            }
          ],
          {                                              // 第3引数: 認証オプション
            isChatAuth: true
          }
        );
        console.log(`[Calendar MCP] Successfully created MCP server: ${serverName} with ID: ${mcpServer.id}`);
      } catch (createError) {
        console.error('[Calendar MCP] Failed to create MCP server:', createError);
        console.error('[Calendar MCP] Error details:', JSON.stringify(createError, null, 2));
        throw new Error(`Failed to create MCP server: ${createError.message}`);
      }
    }
    
    // 接続状態確認
    console.log(`[Calendar MCP] Checking connection status for server: ${mcpServer.id}`);
    let status;
    try {
      status = await composio.mcp.getUserConnectionStatus({
        userId: userId,
        id: mcpServer.id
      });
      console.log('[Calendar MCP] Connection status:', JSON.stringify(status, null, 2));
    } catch (statusError) {
      console.error('[Calendar MCP] Failed to get connection status:', statusError);
      throw new Error(`Failed to check connection status: ${statusError.message}`);
    }
    
    // 正しい接続判定（connectedToolkitsを確認）
    const toolkits = status.connectedToolkits || {};
    const googleCalendarToolkit = Object.values(toolkits).find(
      tk => tk.toolkit === 'google-calendar' || tk.toolkit === 'googlecalendar'
    );
    
    const isConnected = googleCalendarToolkit && googleCalendarToolkit.type === 'CONNECTED';
    console.log(`[Calendar MCP] Is connected: ${isConnected}`);
    
    if (!isConnected) {
      console.log('[Calendar MCP] Not connected, starting authorization flow');
      
      try {
        // 正しい引数順序（userId, serverId, toolkit）
        const authRequest = await composio.mcp.authorize(
          userId,              // 第1引数: userId
          mcpServer.id,        // 第2引数: serverId
          "google-calendar"    // 第3引数: toolkit名
        );
        
        console.log('[Calendar MCP] Authorization URL generated');
        
        return res.json({ 
          connected: false,
          authUrl: authRequest.redirectUrl,
          message: 'Google Calendar authentication required',
          debug: {
            serverId: mcpServer.id,
            serverName: serverName
          }
        });
      } catch (authError) {
        console.error('[Calendar MCP] Failed to generate auth URL:', authError);
        throw new Error(`Failed to generate authentication URL: ${authError.message}`);
      }
    }
    
    console.log('[Calendar MCP] Already connected, getting server URLs');
    
    let serverUrls;
    try {
      serverUrls = await composio.mcp.getServer(
        mcpServer.id,
        { userId: userId }
      );
      console.log('[Calendar MCP] Server URLs retrieved:', JSON.stringify(serverUrls, null, 2));
    } catch (urlError) {
      console.error('[Calendar MCP] Failed to get server URLs:', urlError);
      throw new Error(`Failed to get server URLs: ${urlError.message}`);
    }
    
    // 正しいURL取得（v3形式に対応）
    const mcpUrl = mcpServer.mcp_url || serverUrls.mcp_url || serverUrls.url?.toString();
    
    if (!mcpUrl) {
      console.error('[Calendar MCP] No valid MCP URL found in response');
      console.error('[Calendar MCP] mcpServer:', JSON.stringify(mcpServer, null, 2));
      console.error('[Calendar MCP] serverUrls:', JSON.stringify(serverUrls, null, 2));
      throw new Error('Failed to get MCP server URL from Composio');
    }
    
    console.log(`[Calendar MCP] Successfully connected with MCP URL: ${mcpUrl}`);
    
    return res.json({ 
      connected: true,
      mcpUrl,  
      serverId: mcpServer.id,
      message: 'Google Calendar connected successfully',
      debug: {
        serverName: serverName,
        toolkit: googleCalendarToolkit?.toolkit
      }
    });
    
  } catch (error) {
    console.error('[Calendar MCP] Fatal error:', error);
    console.error('[Calendar MCP] Stack trace:', error.stack);
    
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}