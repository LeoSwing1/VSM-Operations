-- =============================================================================
-- VSM Growth Operations — Admin Seed
-- Run AFTER all migrations. Replace values with your actual admin user details.
-- =============================================================================

-- 1. Create organization
INSERT INTO organizations (name, slug, timezone, currency)
VALUES ('VSM Growth', 'vsm-growth', 'Asia/Kolkata', 'INR')
ON CONFLICT (slug) DO NOTHING;

-- 2. Get org ID (you'll need this for the next steps)
-- SELECT id FROM organizations WHERE slug = 'vsm-growth';

-- 3. Create admin employee (replace with actual auth user ID from Supabase Auth)
-- After creating a user in Supabase Auth Dashboard > Authentication > Users > Add User
-- Copy the UUID and use it here:

INSERT INTO employees (
  org_id,
  user_id,
  employee_code,
  full_name,
  official_email,
  role,
  status,
  employment_type,
  joining_date
) VALUES (
  (SELECT id FROM organizations WHERE slug = 'vsm-growth'),
  '00e78adc-c0b1-4e84-8adf-cc947f7d9115',
  'ADM001',
  'Admin User',
  'vsmops@vsm.com',
  'SUPER_ADMIN',
  'ACTIVE',
  'FULL_TIME',
  CURRENT_DATE
)
ON CONFLICT (org_id, employee_code) DO NOTHING;

-- 4. Default role permissions for SUPER_ADMIN (auto-grants all permissions)
-- This is handled by the RLS policies which check role_permissions table
`
-- 5. Create default shift
INSERT INTO shifts (org_id, name, start_time, end_time, grace_minutes, half_day_minutes, full_day_minutes, weekly_offs)
SELECT id, 'General Shift', '09:00', '18:00', 10, 240, 480, '{0}'
FROM organizations WHERE slug = 'vsm-growth'
ON CONFLICT (org_id, name) DO NOTHING;

-- 6. Create default departments
INSERT INTO departments (org_id, name)
SELECT id, 'Engineering' FROM organizations WHERE slug = 'vsm-growth'
ON CONFLICT (org_id, name) DO NOTHING;

INSERT INTO departments (org_id, name)
SELECT id, 'Sales' FROM organizations WHERE slug = 'vsm-growth'
ON CONFLICT (org_id, name) DO NOTHING;

INSERT INTO departments (org_id, name)
SELECT id, 'Operations' FROM organizations WHERE slug = 'vsm-growth'
ON CONFLICT (org_id, name) DO NOTHING;

INSERT INTO departments (org_id, name)
SELECT id, 'HR' FROM organizations WHERE slug = 'vsm-growth'
ON CONFLICT (org_id, name) DO NOTHING;