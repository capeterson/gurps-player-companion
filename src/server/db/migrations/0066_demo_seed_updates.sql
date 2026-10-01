-- Internal tooling state, not a player or sync entity. Commit the marker with
-- the content update so retries never resurrect deliberately deleted fixtures.
CREATE TABLE IF NOT EXISTS demo_seed_updates (
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  seed text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, seed, version)
);
