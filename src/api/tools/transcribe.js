// Whisper APIを使った音声文字起こしエンドポイント

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // multipart/form-dataのパース
    const formData = await parseFormData(req);
    const audioFile = formData.audio;
    
    if (!audioFile) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    // OpenAI Whisper APIに転送
    const openaiFormData = new FormData();
    openaiFormData.append('file', audioFile.buffer, {
      filename: 'audio.webm',
      contentType: 'audio/webm'
    });
    openaiFormData.append('model', 'whisper-1');
    openaiFormData.append('language', 'ja'); // 日本語優先

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: openaiFormData
    });

    if (!response.ok) {
      throw new Error(`Whisper API error: ${response.status}`);
    }

    const result = await response.json();
    
    console.log('🎤 Transcription result:', result.text?.substring(0, 100));
    
    return res.status(200).json({
      text: result.text,
      language: result.language || 'ja'
    });

  } catch (error) {
    console.error('❌ Transcription error:', error);
    return res.status(500).json({ 
      error: 'Transcription failed',
      details: error.message 
    });
  }
}

// FormDataパーサー（簡易版）
async function parseFormData(req) {
  const busboy = require('busboy');
  
  return new Promise((resolve, reject) => {
    const result = {};
    const bb = busboy({ headers: req.headers });
    
    bb.on('file', (name, file, info) => {
      const chunks = [];
      file.on('data', (chunk) => chunks.push(chunk));
      file.on('end', () => {
        result[name] = {
          buffer: Buffer.concat(chunks),
          filename: info.filename,
          mimeType: info.mimeType
        };
      });
    });
    
    bb.on('finish', () => resolve(result));
    bb.on('error', reject);
    
    req.pipe(bb);
  });
}