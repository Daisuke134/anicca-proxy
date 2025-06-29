#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';

const server = new Server(
  {
    name: 'http-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available HTTP tools
const httpTools = [
  {
    name: 'http_request',
    description: 'Make an HTTP request to any URL',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to make the request to',
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          default: 'GET',
          description: 'HTTP method',
        },
        headers: {
          type: 'object',
          description: 'HTTP headers as key-value pairs',
          additionalProperties: { type: 'string' },
        },
        body: {
          type: ['object', 'string', 'null'],
          description: 'Request body (for POST, PUT, PATCH)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'slack_send_message',
    description: 'Send a message to Slack',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'Channel name (e.g., "#general") or channel ID',
        },
        message: {
          type: 'string',
          description: 'The message to send',
        },
      },
      required: ['channel', 'message'],
    },
  },
  {
    name: 'slack_list_channels',
    description: 'List all channels in the Slack workspace',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: httpTools,
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'http_request') {
      // General HTTP request handler
      const { url, method = 'GET', headers = {}, body } = args;
      
      console.error(`[HTTP MCP] Making ${method} request to ${url}`);
      
      const requestOptions = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      };
      
      if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        requestOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
      
      const response = await fetch(url, requestOptions);
      const responseText = await response.text();
      
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = responseText;
      }
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: response.status,
              statusText: response.statusText,
              data: responseData,
            }, null, 2),
          },
        ],
      };
    }
    
    // Slack-specific shortcuts
    if (name === 'slack_send_message') {
      const { channel, message } = args;
      const slackApiUrl = process.env.SLACK_API_URL || 'https://anicca-proxy-production.up.railway.app/api/tools/slack';
      const userId = process.env.USER_ID; // 環境変数から取得
      
      console.error(`[HTTP MCP] Sending Slack message to ${channel} for user ${userId}`);
      
      const response = await fetch(slackApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'send_message',
          arguments: { channel, message },
          userId,
        }),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.message || `Slack API error: ${response.status}`);
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Message sent to ${channel} successfully`,
          },
        ],
      };
    }
    
    if (name === 'slack_list_channels') {
      const slackApiUrl = process.env.SLACK_API_URL || 'https://anicca-proxy-production.up.railway.app/api/tools/slack';
      const userId = process.env.USER_ID; // 環境変数から取得
      
      console.error(`[HTTP MCP] Listing Slack channels for user ${userId}`);
      
      const response = await fetch(slackApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'list_channels',
          arguments: {},
          userId,
        }),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.message || `Slack API error: ${response.status}`);
      }
      
      // Format channel list
      const channels = result.result?.channels || [];
      const channelList = channels
        .map(ch => `#${ch.name} (${ch.id})`)
        .join('\n');
      
      return {
        content: [
          {
            type: 'text',
            text: `Found ${channels.length} channels:\n${channelList}`,
          },
        ],
      };
    }
    
    throw new McpError(
      ErrorCode.MethodNotFound,
      `Unknown tool: ${name}`
    );
  } catch (error) {
    console.error(`[HTTP MCP] Error executing ${name}:`, error);
    throw new McpError(
      ErrorCode.InternalError,
      error.message
    );
  }
});

// Start the server
async function main() {
  console.error('[HTTP MCP] Starting server...');
  console.error('[HTTP MCP] Environment:', {
    USER_ID: process.env.USER_ID,
    SLACK_API_URL: process.env.SLACK_API_URL,
    NODE_VERSION: process.version
  });
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[HTTP MCP] Server started successfully');
}

main().catch((error) => {
  console.error('[HTTP MCP] Fatal error:', error);
  console.error('[HTTP MCP] Stack trace:', error.stack);
  process.exit(1);
});