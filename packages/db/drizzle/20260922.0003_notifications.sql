-- Per-user notification inbox surfaced by the web header panel. Read and written only by the web
-- BFF as bap_auth, scoped by user_id per query, like auth.session; default privileges in auth give
-- bap_auth DML and bap_backup SELECT, so no GRANT/REVOKE or row level security is added here.
CREATE TABLE IF NOT EXISTS auth.notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  href text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_kind_check CHECK (kind <> ''),
  CONSTRAINT notification_title_check CHECK (title <> '')
);

CREATE INDEX IF NOT EXISTS notification_user_created_idx
  ON auth.notification (user_id, created_at DESC);
