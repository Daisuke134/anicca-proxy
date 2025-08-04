// Worker音声対話エンドポイント
// Whisperで文字起こし → Worker SDK実行 → Google TTSで音声生成

import { ParentAgent } from '../../../services/parallel-sdk/core/ParentAgent.js';
import { getSlackTokensForUser } from '../../../services/storage/database.js';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

// Google TTS クライアント初期化
const ttsClient = new TextToSpeechClient({
  credentials: JSON.parse(process.env.GOOGLE_TTS_CREDENTIALS || '{}')
});

// ParentAgentのインスタンス（再利用）
let parentAgent = null;

async function initializeParentAgent() {
  if (!parentAgent) {
    parentAgent = new ParentAgent();
    console.log('✅ ParentAgent initialized for Worker voice');
  }
  return parentAgent;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, message } = req.body;
    
    if (!userId || !message) {
      return res.status(400).json({ error: 'userId and message are required' });
    }

    console.log(`🎤 Worker voice request from ${userId}: ${message}`);

    // ParentAgentを初期化
    const agent = await initializeParentAgent();

    // Slackトークンを取得（必要に応じて）
    const slackTokens = await getSlackTokensForUser(userId);
    
    // Worker SDKでタスクを実行
    const taskConfig = {
      type: 'voice_dialogue',
      originalRequest: message,
      userId: userId,
      slackTokens: slackTokens
    };

    // Workerを1つだけ起動して対話
    const worker = agent.createWorker('Worker-Voice', taskConfig);
    const result = await worker.execute(message);

    console.log('🤖 Worker response:', result);

    // Google TTSで音声生成
    const audioContent = await generateSpeech(result.response || result.message || 'すみません、よく聞き取れませんでした。');

    // 音声データをBase64エンコード
    const audioBase64 = audioContent.toString('base64');
    const audioUrl = `data:audio/mp3;base64,${audioBase64}`;

    return res.status(200).json({
      success: true,
      response: result.response || result.message,
      audioUrl: audioUrl,
      workerId: worker.id
    });

  } catch (error) {
    console.error('❌ Worker voice error:', error);
    
    // エラー時も音声で返す
    try {
      const errorMessage = 'エラーが発生しました。もう一度お試しください。';
      const audioContent = await generateSpeech(errorMessage);
      const audioBase64 = audioContent.toString('base64');
      const audioUrl = `data:audio/mp3;base64,${audioBase64}`;
      
      return res.status(500).json({
        error: 'Worker execution failed',
        message: errorMessage,
        audioUrl: audioUrl
      });
    } catch (ttsError) {
      return res.status(500).json({
        error: 'Worker execution and TTS failed',
        details: error.message
      });
    }
  }
}

// Google TTSで音声生成
async function generateSpeech(text) {
  try {
    const request = {
      input: { text },
      voice: {
        languageCode: 'ja-JP',
        name: 'ja-JP-Neural2-B', // 男性の声
        ssmlGender: 'MALE'
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.0,
        pitch: 0.0,
        volumeGainDb: 0.0
      }
    };

    const [response] = await ttsClient.synthesizeSpeech(request);
    
    console.log(`🔊 TTS generated: ${text.substring(0, 50)}...`);
    
    return response.audioContent;
    
  } catch (error) {
    console.error('❌ TTS generation error:', error);
    throw error;
  }
}