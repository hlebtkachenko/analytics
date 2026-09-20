-- Inbox actions (Phase 1b-actions): the attached event kind. A person attaches an item's files to an
-- existing document; the item is routed to that document without creating one.
ALTER TABLE app.inbox_event DROP CONSTRAINT IF EXISTS inbox_event_kind_check;
ALTER TABLE app.inbox_event
  ADD CONSTRAINT inbox_event_kind_check CHECK (kind IN (
    'received', 'scanned', 'classified', 'extracted', 'rule_matched', 'routed', 'unrouted',
    'reopened', 'discarded', 'restored', 'assigned', 'hint_added', 'failed', 'attached'
  ));
