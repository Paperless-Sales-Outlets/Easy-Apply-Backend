-- Realistic seed data for the backup / restore integration tests.
-- Loaded into a throw-away database right after db/schema.sql.
-- Includes non-ASCII text (Sinhala, Tamil), JSONB, long text, NULLs and dates.

INSERT INTO users (name, email, phone, nic, role, employee_number, permissions, is_active, password_hash)
SELECT
  'Staff Member ' || n,
  'staff' || n || '@slt.test',
  '07700000' || lpad(n::text, 2, '0'),
  '9000000' || lpad(n::text, 2, '0') || 'V',
  CASE WHEN n = 1 THEN 'Admin' WHEN n % 3 = 0 THEN 'Sales Officer' ELSE 'Staff' END,
  lpad((100000 + n)::text, 6, '0'),
  ARRAY['dashboard', 'kyc', 'forms'],
  n % 7 <> 0,
  '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234'
FROM generate_series(1, 20) AS n;

INSERT INTO customers (name, email, phone, nic, title, dob, gender, address_line1, city, district, postal_code,
                       identity_documents, kyc_status, kyc_notes, created_at)
SELECT
  CASE n % 3 WHEN 0 THEN 'සුනිල් පෙරේරා ' || n WHEN 1 THEN 'தமிழ் வாடிக்கையாளர் ' || n ELSE 'Customer ' || n END,
  CASE WHEN n % 10 = 0 THEN NULL ELSE 'customer' || n || '@example.test' END,
  '07' || lpad((1000000 + n)::text, 8, '0'),
  '19' || (80 + n % 20) || lpad(n::text, 7, '0') || 'V',
  'Mr.',
  '19' || (80 + n % 20) || '-0' || (1 + n % 9) || '-1' || (n % 9),
  CASE WHEN n % 2 = 0 THEN 'Male' ELSE 'Female' END,
  n || ', Galle Road, ' || repeat('x', 40),
  'Colombo', 'Colombo', lpad((n % 1000)::text, 5, '0'),
  jsonb_build_object('nicFront', 'documents/' || n || '-front.png', 'nicBack', 'documents/' || n || '-back.png'),
  (ARRAY['pending', 'approved', 'rejected'])[1 + n % 3],
  CASE WHEN n % 4 = 0 THEN 'Reviewed by officer: ' || repeat('note ', 100) ELSE NULL END,
  NOW() - (n || ' hours')::interval
FROM generate_series(1, 500) AS n;

INSERT INTO products (id, product_id, name, category, service_type, speed, monthly_price, installation_fee, description, features, popular)
SELECT
  'P' || lpad(n::text, 4, '0'),
  'PID' || n,
  'Package ' || n,
  (ARRAY['Fibre', 'LTE', 'Voice'])[1 + n % 3],
  'Broadband',
  (n * 10) || ' Mbps',
  1000 + n * 25.5,
  2500,
  'Unlimited data package number ' || n,
  jsonb_build_array('Unlimited', 'Free router', 'Peo TV'),
  n % 5 = 0
FROM generate_series(1, 60) AS n;

INSERT INTO applications (reference_number, phone, service_type, status, payment_status, payment_details, notes, nic,
                          form_data, documents, completed_sale, created_at)
SELECT
  'EA-2026-' || lpad(n::text, 6, '0'),
  '07' || lpad((1000000 + n % 500 + 1)::text, 8, '0'),
  (ARRAY['New Connection', 'Upgrade', 'Relocation'])[1 + n % 3],
  (ARRAY['pending', 'approved', 'rejected', 'flagged'])[1 + n % 4],
  (ARRAY['pending', 'paid'])[1 + n % 2],
  jsonb_build_object('amount', 2500 + n, 'currency', 'LKR', 'gateway', 'PayHere'),
  CASE WHEN n % 5 = 0 THEN repeat('Long staff note with unicode ✓ සිංහල தமிழ். ', 60) ELSE NULL END,
  '19' || (80 + n % 20) || lpad((n % 500 + 1)::text, 7, '0') || 'V',
  jsonb_build_object('fullName', 'Applicant ' || n, 'package', 'P' || lpad((1 + n % 60)::text, 4, '0'),
                     'address', n || ' Main St, Kandy',
                     'consents', jsonb_build_array('terms', 'marketing')),
  jsonb_build_object('signature', 'documents/sig-' || n || '.png'),
  n % 6 = 0,
  NOW() - (n || ' minutes')::interval
FROM generate_series(1, 2000) AS n;

INSERT INTO audit_logs (action, actor_role, ip_address, details)
SELECT 'UPDATE', 'Admin', '10.0.0.' || (n % 250), jsonb_build_object('module', 'Forms', 'description', 'Edited form ' || n)
FROM generate_series(1, 300) AS n;
