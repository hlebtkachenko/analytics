-- Per line tax points, service periods and activity codes, advance deduction lines, and header rounding.
-- One invoice may cover several months at several VAT rates, so the month and the activity live on the line.
-- Direction still lives in the document kind: rounding_amount is the only signed money column in the register.

ALTER TABLE app.invoice_line
  -- An advance deduction is a line, not a header field: the paper itemises it by VAT rate.
  ADD COLUMN IF NOT EXISTS line_kind text NOT NULL DEFAULT 'item',
  -- Statute makes the tax point a per supply fact, so one date per invoice cannot hold five months.
  ADD COLUMN IF NOT EXISTS tax_point_date date,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  -- A free analytic code rather than a dimension table: one writer today and no code list to maintain.
  ADD COLUMN IF NOT EXISTS activity_code text,
  -- A deduction line names no supply, so it carries no category.
  ALTER COLUMN category DROP NOT NULL;

-- Labour and transport were both 'services', which made "transport per month" ungroupable.
ALTER TABLE app.invoice_line DROP CONSTRAINT IF EXISTS invoice_line_category_check;
ALTER TABLE app.invoice_line
  ADD CONSTRAINT invoice_line_category_check
    CHECK (category IS NULL
      OR category IN ('goods', 'material', 'services', 'labour', 'transport', 'asset', 'other')),
  ADD CONSTRAINT invoice_line_kind_check CHECK (line_kind IN ('item', 'advance_deduction')),
  -- Category is exactly as present as the line is a supply, so neither shape can be written by mistake.
  ADD CONSTRAINT invoice_line_category_kind_check
    CHECK ((line_kind = 'item') = (category IS NOT NULL)),
  -- Either bound may stand alone, so the order is only checked when both are given.
  ADD CONSTRAINT invoice_line_period_check
    CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end),
  -- The same shape as a document attribute key, normalized to lower case at the API boundary.
  ADD CONSTRAINT invoice_line_activity_code_check
    CHECK (activity_code IS NULL OR activity_code ~ '^[a-z0-9][a-z0-9_-]{0,31}$');

ALTER TABLE app.invoice
  -- Signed on purpose: positive means the supplier rounded up, negative means down. It has no VAT regime.
  ADD COLUMN IF NOT EXISTS rounding_amount numeric(19, 4) NOT NULL DEFAULT 0,
  -- Sum of base_amount + vat_amount over the advance_deduction lines, computed by the API like the other totals.
  ADD COLUMN IF NOT EXISTS advance_total numeric(19, 4) NOT NULL DEFAULT 0;

-- Added separately so the generated expression sees the two columns above as already present.
ALTER TABLE app.invoice
  -- Stored by PostgreSQL rather than written by the API, so what the paper says to pay can never drift.
  ADD COLUMN IF NOT EXISTS amount_due numeric(19, 4)
    GENERATED ALWAYS AS (gross_total + rounding_amount - advance_total) STORED;

ALTER TABLE app.invoice
  -- A rounding difference is by definition under one unit of currency; anything larger is a real line.
  ADD CONSTRAINT invoice_rounding_amount_check CHECK (abs(rounding_amount) < 1),
  ADD CONSTRAINT invoice_advance_total_check CHECK (advance_total >= 0),
  -- Keeps amount_due at or above zero: an overpaid advance is settled by a credit note, never a negative due.
  ADD CONSTRAINT invoice_amount_due_check CHECK (advance_total <= gross_total + rounding_amount);

ALTER TABLE app.economic_event_line
  -- The leg level tax point. The event header keeps the document date, so "registered when" stays answerable.
  ADD COLUMN IF NOT EXISTS effective_date date,
  -- Copied from the invoice line so a grouping by activity never has to join the register.
  ADD COLUMN IF NOT EXISTS activity_code text;

-- Existing legs all carry the document date, which is exactly what the event header holds.
UPDATE app.economic_event_line AS line
SET effective_date = event.event_date
FROM app.economic_event AS event
WHERE event.id = line.event_id
  AND line.effective_date IS NULL;

ALTER TABLE app.economic_event_line ALTER COLUMN effective_date SET NOT NULL;

ALTER TABLE app.economic_event_line
  ADD CONSTRAINT economic_event_line_activity_code_check
    CHECK (activity_code IS NULL OR activity_code ~ '^[a-z0-9][a-z0-9_-]{0,31}$');

-- Monthly reporting reads by date and account without touching a document, so it gets its own index.
-- No activity index yet: it ships with its first reporting consumer.
CREATE INDEX IF NOT EXISTS economic_event_line_effective_date_idx
  ON app.economic_event_line(organization_id, effective_date, account_code);
