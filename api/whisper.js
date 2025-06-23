// OpenAI Whisper API プロキシ
import FormData from 'form-data';
import axios from 'axios';

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
    
    // FormDataを作成
    const formData = new FormData();
    formData.append('file', audioBuffer, {
      filename: 'audio.webm',
      contentType: 'audio/webm'
    });
    formData.append('model', 'whisper-1');
    formData.append('language', language);
    formData.append('response_format', 'json');
    
    console.log(`Whisper transcription request: ${audioBuffer.length} bytes, language: ${language}`);
    
    // OpenAI APIにリクエスト（axiosを使用）
    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          ...formData.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );
    
    // axiosは成功時に直接データを返す
    const result = response.data;
    
    res.status(200).json({
      success: true,
      text: result.text,
      language: language
    });
    
  } catch (error) {
    console.error('Whisper Error:', error);
    
    // axiosエラーの詳細情報を取得
    if (error.response) {
      console.error('OpenAI API error:', error.response.data);
      res.status(error.response.status).json({ 
        error: 'Transcription failed',
        details: error.response.data 
      });
    } else {
      res.status(500).json({ 
        error: 'Transcription processing failed',
        message: error.message 
      });
    }
  }
}