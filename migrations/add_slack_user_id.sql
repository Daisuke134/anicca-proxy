-- Add slack_user_id column to slack_tokens table
ALTER TABLE slack_tokens 
ADD COLUMN IF NOT EXISTS slack_user_id TEXT;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_slack_tokens_slack_user_id 
ON slack_tokens(slack_user_id);