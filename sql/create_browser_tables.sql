-- Browser contexts table for storing user's browser sessions
CREATE TABLE IF NOT EXISTS browser_contexts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  site TEXT NOT NULL, -- 'amazon', 'youtube', etc.
  context_id TEXT NOT NULL, -- Browser Base's Context ID
  metadata JSONB DEFAULT '{}', -- Additional data like preferred items
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, site)
);

-- User preferences table for storing user's shortcuts and preferences
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL, -- e.g., 'candy', 'music'
  value JSONB NOT NULL, -- e.g., {"url": "amazon.com/...", "name": "Favorite candy"}
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, key)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_browser_contexts_user_id ON browser_contexts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);