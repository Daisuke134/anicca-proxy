import { elevenLabsMcpService } from '../../services/mcp-clients/elevenLabsClient.js';

export default async function handler(req, res) {
  try {
    console.log('🔊 Play audio request:', req.body);
    
    const { file_path } = req.body;
    
    if (!file_path) {
      return res.status(400).json({ error: 'file_path is required' });
    }
    
    const result = await elevenLabsMcpService.playAudio(file_path);
    
    console.log('✅ Audio playback initiated');
    
    res.json({
      success: true,
      message: 'Audio playback started',
      result
    });
  } catch (error) {
    console.error('❌ Play audio error:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Failed to play audio'
    });
  }
}