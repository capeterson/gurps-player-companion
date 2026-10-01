ALTER TABLE users
  ADD COLUMN IF NOT EXISTS experimental_mcp_ui boolean NOT NULL DEFAULT false;
