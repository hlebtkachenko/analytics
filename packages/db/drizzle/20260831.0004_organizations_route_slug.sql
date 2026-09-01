-- Reserve the top-level organizations route before it is published.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM auth.organization
    WHERE slug = 'organizations'
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
        'organizations'
      )
    );
