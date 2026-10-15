-- Company profile: new single source of truth after cutover.
-- This migration only expands the schema and copies existing data.

CREATE TABLE public.company_profile (
  id boolean PRIMARY KEY DEFAULT true,
  company_legal_name text,
  company_legal_id text,
  company_legal_address text,
  company_contact_phone text,
  company_contact_email text,
  privacy_url text,
  terms_url text,
  warranty_text text,
  company_instagram_url text,

  CONSTRAINT company_profile_singleton CHECK (id = true)
);

ALTER TABLE public.company_profile ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.company_profile
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, UPDATE
  ON TABLE public.company_profile
  TO authenticated;

GRANT ALL
  ON TABLE public.company_profile
  TO service_role;

CREATE POLICY company_profile_admin_all
ON public.company_profile
FOR ALL
TO authenticated
USING (
  (SELECT public.has_platform_permission('manage_settings'))
)
WITH CHECK (
  (SELECT public.has_platform_permission('manage_settings'))
);

INSERT INTO public.company_profile (
  id,
  company_legal_name,
  company_legal_id,
  company_legal_address,
  company_contact_phone,
  company_contact_email,
  privacy_url,
  terms_url,
  warranty_text,
  company_instagram_url
)
SELECT
  id,
  company_legal_name,
  company_legal_id,
  company_legal_address,
  company_contact_phone,
  company_contact_email,
  privacy_url,
  terms_url,
  warranty_text,
  company_instagram_url
FROM public.app_settings
WHERE id = true;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.company_profile) <> 1 THEN
    RAISE EXCEPTION 'company_profile must contain exactly one row';
  END IF;

  IF EXISTS (
    SELECT
      company_legal_name,
      company_legal_id,
      company_legal_address,
      company_contact_phone,
      company_contact_email,
      privacy_url,
      terms_url,
      warranty_text,
      company_instagram_url
    FROM public.app_settings
    WHERE id = true

    EXCEPT

    SELECT
      company_legal_name,
      company_legal_id,
      company_legal_address,
      company_contact_phone,
      company_contact_email,
      privacy_url,
      terms_url,
      warranty_text,
      company_instagram_url
    FROM public.company_profile
    WHERE id = true
  ) THEN
    RAISE EXCEPTION 'company_profile data copy verification failed';
  END IF;
END;
$$;
