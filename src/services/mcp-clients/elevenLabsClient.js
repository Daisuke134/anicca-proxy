import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class ElevenLabsMcpService {
  constructor() {
    this.client = null;
    this.transport = null;
  }

  async initialize() {
    if (this.client) {
      console.log('⚠️ ElevenLabs MCP service already initialized');
      return;
    }

    try {
      console.log('🚀 Starting ElevenLabs MCP server...');
      console.log('🔑 Using API key from Railway environment');
      
      // RailwayのELEVENLABS_API_KEYを使用
      this.transport = new StdioClientTransport({
        command: 'uvx',
        args: ['elevenlabs-mcp'],
        env: {
          ...process.env,
          ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY
        }
      });

      this.client = new Client({
        name: 'anicca-elevenlabs-client',
        version: '1.0.0'
      }, {
        capabilities: {}
      });

      await this.client.connect(this.transport);
      console.log('✅ ElevenLabs MCP client connected');
      
      // 利用可能なツールを確認
      try {
        const tools = await this.client.listTools();
        console.log('🛠️ Available ElevenLabs tools:', tools.tools.map(t => t.name));
      } catch (listError) {
        console.error('⚠️ Error listing tools:', listError);
      }
      
    } catch (error) {
      console.error('❌ Failed to initialize ElevenLabs MCP service:', error);
      throw error;
    }
  }

  async generateSpeech(text, options = {}) {
    if (!this.client) {
      await this.initialize();
    }

    try {
      console.log(`🎤 Generating speech: "${text}"`);
      console.log('🔧 Options:', options);
      
      // MCPツール名は正確に "text_to_speech"
      const result = await this.client.callTool({
        name: 'text_to_speech',
        arguments: {
          text,
          voice_id: options.voice || 'Rachel',
          model_id: options.model || 'eleven_multilingual_v2',
          output_format: options.format || 'mp3_44100_128'
        }
      });

      console.log('✅ ElevenLabs speech generation completed');
      return result;
      
    } catch (error) {
      console.error('❌ ElevenLabs speech generation error:', error);
      throw error;
    }
  }

  async playAudio(filePath) {
    if (!this.client) {
      await this.initialize();
    }

    try {
      console.log(`🔊 Playing audio: "${filePath}"`);
      
      const result = await this.client.callTool({
        name: 'play_audio',
        arguments: {
          file_path: filePath
        }
      });

      console.log('✅ Audio playback started');
      return result;
      
    } catch (error) {
      console.error('❌ Audio playback error:', error);
      throw error;
    }
  }

  async close() {
    try {
      if (this.transport) {
        await this.transport.close();
      }
      this.client = null;
      this.transport = null;
      console.log('🔒 ElevenLabs MCP service closed');
    } catch (error) {
      console.error('❌ Error closing ElevenLabs MCP service:', error);
    }
  }
}

// シングルトンインスタンスをエクスポート
export const elevenLabsMcpService = new ElevenLabsMcpService();