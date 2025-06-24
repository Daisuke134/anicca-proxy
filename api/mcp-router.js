export const runtime = 'edge';

const { createMcpHandler } = require('@vercel/mcp-adapter');

// MCPハンドラーを作成
const handler = createMcpHandler((server) => {
  // HackerNews ツール
  server.tool(
    'get_hacker_news_stories',
    'Get the latest stories from Hacker News',
    {
      limit: {
        type: 'number',
        description: 'Number of stories to retrieve',
        default: 5
      }
    },
    async ({ limit = 5 }) => {
      try {
        // HackerNews APIから最新ストーリーを取得
        const topStoriesResponse = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
        const storyIds = await topStoriesResponse.json();
        const limitedIds = storyIds.slice(0, limit);
        
        // 各ストーリーの詳細を取得
        const stories = await Promise.all(
          limitedIds.map(async (id) => {
            const storyResponse = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
            const story = await storyResponse.json();
            return {
              title: story.title,
              url: story.url || `https://news.ycombinator.com/item?id=${id}`,
              score: story.score,
              by: story.by,
              time: new Date(story.time * 1000).toISOString()
            };
          })
        );
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ stories }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error fetching HackerNews stories: ${error.message}`
          }],
          isError: true
        };
      }
    }
  );
  
  // Exa検索ツール
  server.tool(
    'search_exa',
    'Search for information using Exa',
    {
      query: {
        type: 'string',
        description: 'Search query',
        required: true
      }
    },
    async ({ query }) => {
      try {
        const exaApiKey = process.env.EXA_API_KEY;
        if (!exaApiKey) {
          throw new Error('EXA_API_KEY is not configured');
        }
        
        // Exa APIで検索
        const response = await fetch(
          'https://api.exa.ai/search',
          {
            method: 'POST',
            headers: {
              'x-api-key': exaApiKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              query: query,
              num_results: 5,
              type: 'neural',
              use_autoprompt: true
            })
          }
        );
        
        const data = await response.json();
        const results = data.results.map(result => ({
          title: result.title,
          url: result.url,
          snippet: result.snippet || result.text?.substring(0, 200) + '...'
        }));
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ query, results }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error searching with Exa: ${error.message}`
          }],
          isError: true
        };
      }
    }
  );
  
  // Slackツール（今後追加予定）
  server.tool(
    'send_slack_message',
    'Send a message to Slack',
    {
      channel: {
        type: 'string',
        description: 'Slack channel name (without #)',
        required: true
      },
      message: {
        type: 'string',
        description: 'Message to send',
        required: true
      }
    },
    async ({ channel, message }) => {
      try {
        const slackToken = process.env.SLACK_BOT_TOKEN;
        if (!slackToken) {
          throw new Error('SLACK_BOT_TOKEN is not configured');
        }
        
        // Slack APIでメッセージ送信
        const response = await fetch(
          'https://slack.com/api/chat.postMessage',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${slackToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              channel: channel,
              text: message
            })
          }
        );
        
        const data = await response.json();
        if (!data.ok) {
          throw new Error(data.error || 'Failed to send Slack message');
        }
        
        return {
          content: [{
            type: 'text',
            text: `Message sent to #${channel}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error sending Slack message: ${error.message}`
          }],
          isError: true
        };
      }
    }
  );
});

module.exports = handler;