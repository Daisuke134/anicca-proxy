import { elevenLabsMcpService } from '../../services/mcp-clients/elevenLabsClient.js';

export default async function handler(req, res) {
  try {
    console.log('🎤 Voice generation request:', req.body);
    
    const { text, voice, model } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }
    
    const result = await elevenLabsMcpService.generateSpeech(text, { voice, model });
    
    console.log('✅ Voice generated successfully, result:', result);
    
    // ElevenLabs MCPはfile_pathを返す
    if (result && result[0] && result[0].content) {
      // MCPの返り値は配列形式の可能性がある
      const content = result[0].content;
      const filePath = content.file_path || content;
      
      res.json({
        success: true,
        filePath: filePath,
        voice: voice || 'Rachel',
        result
      });
    } else if (result && result.file_path) {
      // 単純なオブジェクト形式の場合
      res.json({
        success: true,
        filePath: result.file_path,
        voice: result.voice || voice || 'Rachel',
        result
      });
    } else {
      // その他の形式の場合
      res.json({
        success: true,
        result
      });
    }
  } catch (error) {
    console.error('❌ ElevenLabs error:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Failed to generate voice'
    });
  }
}