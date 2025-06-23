// OpenAI Whisper API プロキシ
const FormData = require('form-data');

export default async function handler(req, res) {
  // CORSヘッダーを設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // OPTIONSリクエストの処理
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  // POSTリクエストのみ許可
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  
  try {
    // 環境変数からOpenAI APIキーを取得
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('OPENAI_API_KEY not set');
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }
    
    // リクエストボディから音声データを取得
    const { audio, language = 'ja' } = req.body;
    
    if (!audio) {
      res.status(400).json({ error: 'Audio data is required' });
      return;
    }
    
    // Base64をバッファに変換
    const audioBuffer = Buffer.from(audio, 'base64');
    
    console.log(`Whisper transcription request: ${audioBuffer.length} bytes, language: ${language}`);
    
    // FormDataを作成
    const form = new FormData();
    form.append('file', audioBuffer, {
      filename: 'audio.webm',
      contentType: 'audio/webm'
    });
    form.append('model', 'whisper-1');
    form.append('language', language);
    form.append('response_format', 'json');
    
    // OpenAI APIにリクエスト
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...form.getHeaders()
      },
      body: form
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error:', error);
      res.status(response.status).json({ error: 'Transcription failed' });
      return;
    }
    
    const result = await response.json();
    
    res.status(200).json({
      success: true,
      text: result.text,
      language: language
    });
    
  } catch (error) {
    console.error('Whisper Error:', error);
    res.status(500).json({ 
      error: 'Transcription processing failed',
      message: error.message 
    });
  }
}