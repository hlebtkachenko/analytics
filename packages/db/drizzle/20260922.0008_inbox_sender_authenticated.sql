-- Inbox sender authentication: the DKIM alignment verdict a sender-pattern rule needs before it may auto-route.
ALTER TABLE app.inbox_item
  ADD COLUMN IF NOT EXISTS sender_authenticated boolean NOT NULL DEFAULT false;

-- True only when Mailgun's DKIM check passed and a DKIM signature domain aligns with the From domain.
COMMENT ON COLUMN app.inbox_item.sender_authenticated IS
  'True only when Mailgun''s DKIM check passed and a DKIM signature domain aligns with the From domain.';
