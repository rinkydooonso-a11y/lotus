-- Small runtime settings the admin can change without a redeploy (the coin address at launch, the holder gate switch).
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
