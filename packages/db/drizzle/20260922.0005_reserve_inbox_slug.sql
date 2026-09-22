-- Re-reserve the inbox route slug: the platform route reservations rebuild the constraint after migration 20260916.0002 and drop `inbox` from its list.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM auth.organization
    WHERE slug = 'inbox'
  ) THEN
    RAISE EXCEPTION 'Reserved organization slug is already in use'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'organization_slug_reserved_check';
  END IF;
END;
$$;

ALTER TABLE auth.organization
  DROP CONSTRAINT organization_slug_reserved_check;

ALTER TABLE auth.organization
  ADD CONSTRAINT organization_slug_reserved_check
    CHECK (
      slug NOT IN (
        'access',
        'api',
        'datasets',
        'design-system',
        'health',
        'invitation',
        'metrics',
        'ready',
        'sign-in',
        'sign-up',
        'forgot-password',
        'reset-password',
        'activate',
        'welcome',
        'account',
        'organizations',
        'documents',
        'members',
        'entities',
        'settings',
        'assistant',
        'audit',
        'workspaces',
        'notifications',
        'inbox'
      )
    );
