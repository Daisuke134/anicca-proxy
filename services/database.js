import pg from 'pg';
const { Pool } = pg;

let pool = null;

// データベース接続を初期化
export async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    console.log('⚠️ DATABASE_URL not set, using in-memory storage');
    return false;
  }

  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    // テーブルを作成（存在しない場合）
    await pool.query(`
      CREATE TABLE IF NOT EXISTS slack_tokens (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) UNIQUE,
        team_id VARCHAR(255),
        team_name VARCHAR(255),
        bot_token TEXT,
        user_token TEXT,
        authed_user JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Database initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    return false;
  }
}

// トークンを保存
export async function saveTokensToDB(sessionId, tokenData) {
  if (!pool) return false;

  try {
    const query = `
      INSERT INTO slack_tokens (session_id, team_id, team_name, bot_token, user_token, authed_user)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (session_id) 
      DO UPDATE SET 
        team_id = $2,
        team_name = $3,
        bot_token = $4,
        user_token = $5,
        authed_user = $6,
        updated_at = CURRENT_TIMESTAMP
    `;

    await pool.query(query, [
      sessionId,
      tokenData.team_id,
      tokenData.team_name,
      tokenData.bot_token,
      tokenData.user_token,
      JSON.stringify(tokenData.authed_user)
    ]);

    console.log(`✅ Tokens saved to DB for session ${sessionId}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to save tokens to DB:', error);
    return false;
  }
}

// セッションIDでトークンを取得
export async function loadTokensFromDB(sessionId) {
  if (!pool) return null;

  try {
    const result = await pool.query(
      'SELECT * FROM slack_tokens WHERE session_id = $1',
      [sessionId]
    );

    if (result.rows.length > 0) {
      return result.rows[0];
    }
    return null;
  } catch (error) {
    console.error('❌ Failed to load tokens from DB:', error);
    return null;
  }
}

// 最新のトークンを取得（セッションIDがない場合）
export async function loadLatestTokensFromDB() {
  if (!pool) return null;

  try {
    const result = await pool.query(
      'SELECT * FROM slack_tokens ORDER BY updated_at DESC LIMIT 1'
    );

    if (result.rows.length > 0) {
      return result.rows[0];
    }
    return null;
  } catch (error) {
    console.error('❌ Failed to load latest tokens from DB:', error);
    return null;
  }
}