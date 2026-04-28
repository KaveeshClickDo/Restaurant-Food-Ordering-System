-- Adds password-reset token support to the drivers table
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS reset_token TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;
