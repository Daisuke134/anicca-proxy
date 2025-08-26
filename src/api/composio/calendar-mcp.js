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
        
        // 🔍 全Auth Configsの完全構造を出力
        console.log('[Calendar MCP] ===== ALL AUTH CONFIGS =====');
        authConfigsResponse.items.forEach((config, index) => {
          console.log(`[Calendar MCP] ===== Auth Config ${index} =====`);
          console.log(JSON.stringify(config, null, 2));
          console.log('[Calendar MCP] =================================');
        });
      } catch (error) {
        console.error('[Calendar MCP] Failed to list auth configs:', error);
        throw new Error('Failed to retrieve auth configurations from Composio');
      }
      
      const googleCalendarAuthConfig = authConfigsResponse.items.find((config) => 
        config.name?.toLowerCase().includes('google') || 
        config.name?.toLowerCase().includes('calendar') ||
        config.toolkit === 'googlecalendar' ||
        config.toolkit === 'google-calendar' ||
        config.integrationName === 'googlecalendar' ||
        config.app === 'googlecalendar' ||
        config.service === 'googlecalendar'
      );
      
      if (!googleCalendarAuthConfig) {
        console.error('[Calendar MCP] No Google Calendar auth config found');
        console.error('[Calendar MCP] Available configs summary:', 
          authConfigsResponse.items.map(c => ({
            name: c.name,
            id: c.id,
            toolkit: c.toolkit,
            app: c.app,
            service: c.service,
            integrationName: c.integrationName,
            type: c.type
          }))
        );
        throw new Error('No Google Calendar auth config found. Please create one at platform.composio.dev');
      }
      
      // 🔍 選択されたAuth Configの完全詳細
      console.log('[Calendar MCP] ===== SELECTED AUTH CONFIG =====');
      console.log(JSON.stringify(googleCalendarAuthConfig, null, 2));
      console.log('[Calendar MCP] ================================');
      
      // 🔍 Auth Config IDの形式確認
      console.log(`[Calendar MCP] Auth Config ID format check:`, {
        id: googleCalendarAuthConfig.id,
        startsWithAc: googleCalendarAuthConfig.id?.startsWith('ac_'),
        length: googleCalendarAuthConfig.id?.length,
        type: typeof googleCalendarAuthConfig.id
      });
      
      // 🔍 Auth Config構造の確認
      console.log('[Calendar MCP] Full Auth Config structure check:', {
        hasToolkit: !!googleCalendarAuthConfig.toolkit,
        toolkit: googleCalendarAuthConfig.toolkit,
        hasType: !!googleCalendarAuthConfig.type,
        type: googleCalendarAuthConfig.type,
        hasStatus: !!googleCalendarAuthConfig.status,
        status: googleCalendarAuthConfig.status,
        hasScopes: !!googleCalendarAuthConfig.scopes,
        hasIntegrationName: !!googleCalendarAuthConfig.integrationName,
        integrationName: googleCalendarAuthConfig.integrationName
      });
      
      // 🔍 複数のtoolkit名で段階的試行
      const attempts = [
        { toolkit: googleCalendarAuthConfig.toolkit?.slug || googleCalendarAuthConfig.toolkit, source: 'from-auth-config' },
        { toolkit: "googlecalendar", source: 'hardcoded-single' },
        { toolkit: "google-calendar", source: 'hardcoded-hyphen' },
        { toolkit: "google_calendar", source: 'hardcoded-underscore' }
      ].filter(attempt => attempt.toolkit && typeof attempt.toolkit === 'string'); // 文字列のtoolkitのみ
      
      console.log('[Calendar MCP] Will try these toolkit names:', attempts);
      
      let mcpServer = null;
      let lastError = null;
      
      for (const attempt of attempts) {
        console.log(`[Calendar MCP] ===== TRYING ${attempt.source.toUpperCase()}: ${attempt.toolkit} =====`);
        
        // 🔍 作成前のConfig検証
        const configToCreate = {
          toolkit: attempt.toolkit,
          authConfigId: googleCalendarAuthConfig.id,
          allowedTools: []
        };
        
        console.log('[Calendar MCP] Config to create - field validation:', {
          hasToolkit: !!configToCreate.toolkit,
          toolkitValue: configToCreate.toolkit,
          toolkitType: typeof configToCreate.toolkit,
          hasAuthConfigId: !!configToCreate.authConfigId,
          authConfigIdValue: configToCreate.authConfigId,
          authConfigIdType: typeof configToCreate.authConfigId,
          hasAllowedTools: !!configToCreate.allowedTools,
          allowedToolsIsArray: Array.isArray(configToCreate.allowedTools),
          allowedToolsLength: configToCreate.allowedTools.length
        });
        
        console.log('[Calendar MCP] Full config object:', JSON.stringify(configToCreate, null, 2));
        
        try {
          mcpServer = await composio.mcp.create(
            serverName,
            [configToCreate],
            { isChatAuth: true }
          );
          console.log(`[Calendar MCP] ✅ SUCCESS with ${attempt.source} (${attempt.toolkit})`);
          console.log(`[Calendar MCP] Created MCP server: ${serverName} with ID: ${mcpServer.id}`);
          break;
        } catch (createError) {
          console.error(`[Calendar MCP] ❌ FAILED with ${attempt.source} (${attempt.toolkit})`);
          console.error('[Calendar MCP] Full error object:', createError);
          console.error('[Calendar MCP] Error name:', createError.name);
          console.error('[Calendar MCP] Error message:', createError.message);
          console.error('[Calendar MCP] Error code:', createError.code);
          console.error('[Calendar MCP] Error cause:', createError.cause);
          
          // 🔍 Zodエラーの詳細解析
          if (createError.cause?.issues) {
            console.error('[Calendar MCP] === ZOD VALIDATION ERRORS ===');
            createError.cause.issues.forEach((issue, idx) => {
              console.error(`[Calendar MCP] Zod issue ${idx}:`, {
                path: issue.path,
                message: issue.message,
                code: issue.code,
                expected: issue.expected,
                received: issue.received,
                unionErrors: issue.unionErrors,
                ...issue
              });
            });
          }
          
          lastError = createError;
        }
        
        console.log(`[Calendar MCP] ===== END ATTEMPT: ${attempt.source} =====`);
      }
      
      if (!mcpServer) {
        console.error('[Calendar MCP] All toolkit attempts failed');
        throw new Error(`Failed to create MCP server with any toolkit name. Last error: ${lastError?.message}`);
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