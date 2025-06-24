const { createMcpHandler } = require('@vercel/mcp-adapter');
const axios = require('axios');

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
        const topStoriesResponse = await axios.get('https://hacker-news.firebaseio.com/v0/topstories.json');
        const storyIds = topStoriesResponse.data.slice(0, limit);
        
        // 各ストーリーの詳細を取得
        const stories = await Promise.all(
          storyIds.map(async (id) => {
            const storyResponse = await axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
            const story = storyResponse.data;
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
        const response = await axios.post(
          'https://api.exa.ai/search',
          {
            query: query,
            num_results: 5,
            type: 'neural',
            use_autoprompt: true
          },
          {
            headers: {
              'x-api-key': exaApiKey,
              'Content-Type': 'application/json'
            }
          }
        );
        
        const results = response.data.results.map(result => ({
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
        const response = await axios.post(
          'https://slack.com/api/chat.postMessage',
          {
            channel: channel,
            text: message
          },
          {
            headers: {
              'Authorization': `Bearer ${slackToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        if (!response.data.ok) {
          throw new Error(response.data.error || 'Failed to send Slack message');
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