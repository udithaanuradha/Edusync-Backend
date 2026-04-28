-- Migration: Add missing columns to messages table for proper conversation tracking
-- This adds receiver_id, receiver_name, receiver_role if they don't exist

-- Add receiver_id if missing
ALTER TABLE messages ADD COLUMN IF NOT EXISTS receiver_id INT NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS receiver_name VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS receiver_role VARCHAR(50) NOT NULL DEFAULT '';

-- Add foreign key constraint if missing
ALTER TABLE messages ADD CONSTRAINT IF NOT EXISTS fk_receiver 
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE;

-- Add indexes for performance
ALTER TABLE messages ADD INDEX IF NOT EXISTS idx_conversation (sender_id, receiver_id);
ALTER TABLE messages ADD INDEX IF NOT EXISTS idx_created (created_at);

-- Mark migration as complete
INSERT INTO schema_migrations (name, executed_at) VALUES ('add-message-columns', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
