// Google Cloud Text-to-Speech プロキシAPI
const textToSpeech = require('@google-cloud/text-to-speech');

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
    const { text, languageCode = 'ja-JP', voiceName, ssmlGender = 'FEMALE' } = req.body;
    
    if (!text) {
      res.status(400).json({ error: 'Text is required' });
      return;
    }
    
    // 環境変数からGoogle認証情報を取得
    const credentials = process.env.GOOGLE_TTS_CREDENTIALS;
    if (!credentials) {
      console.error('GOOGLE_TTS_CREDENTIALS not set');
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }
    
    // 認証情報をパース
    const credentialsJson = JSON.parse(credentials);
    
    // TTSクライアントを作成
    const client = new textToSpeech.TextToSpeechClient({
      credentials: credentialsJson
    });
    
    // 音声合成リクエスト
    const request = {
      input: { text },
      voice: {
        languageCode,
        name: voiceName || (languageCode === 'ja-JP' ? 'ja-JP-Wavenet-A' : 'en-US-Wavenet-F'),
        ssmlGender
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.0,
        pitch: 0.0,
        volumeGainDb: 0.0
      }
    };
    
    console.log(`TTS Request: "${text.substring(0, 50)}..." in ${languageCode}`);
    
    // 音声合成を実行
    const [response] = await client.synthesizeSpeech(request);
    
    if (!response.audioContent) {
      throw new Error('No audio content in response');
    }
    
    // MP3データをBase64エンコードして返す
    const audioBase64 = response.audioContent.toString('base64');
    
    res.status(200).json({
      success: true,
      audio: audioBase64,
      contentType: 'audio/mp3'
    });
    
  } catch (error) {
    console.error('TTS Error:', error);
    res.status(500).json({ 
      error: 'TTS processing failed',
      message: error.message 
    });
  }
}