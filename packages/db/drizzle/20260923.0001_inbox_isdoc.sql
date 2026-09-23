-- The line category a parsed invoice's item lines take from its partner, because ISDOC names no category of its own.
ALTER TABLE app.partner
  ADD COLUMN IF NOT EXISTS default_line_category text;

-- The same list as invoice_line_category_check, so a default can always be written onto a line.
ALTER TABLE app.partner DROP CONSTRAINT IF EXISTS partner_default_line_category_check;
ALTER TABLE app.partner
  ADD CONSTRAINT partner_default_line_category_check
    CHECK (default_line_category IS NULL
      OR default_line_category IN ('goods', 'material', 'services', 'labour', 'transport', 'asset', 'other'));

COMMENT ON COLUMN app.partner.default_line_category IS
  'The category the item lines of a parsed invoice from or to this partner take; null leaves them for a person.';
