-- Seed initial Admin User
INSERT INTO users (name, email, phone, role, permissions, is_active, password_hash)
VALUES ('System Administrator', 'admin@slt.lk', '0770000000', 'admin', ARRAY['all'], true, '$2a$10$kHr5CYr.ddwx8iJw79ISzuqTEp2vv3HMXHZSi2Ds0q1HgQQPV4QDu')
ON CONFLICT (email) DO NOTHING;

-- Seed Sales Officer User (Employee Number: 095756)
INSERT INTO users (name, email, phone, role, employee_number, permissions, is_active, password_hash)
VALUES ('Kavinda Jayasuriya', 'so@slt.lk', '0771234567', 'sales officer', '095756', ARRAY['sales_officer'], true, '$2a$10$kHr5CYr.ddwx8iJw79ISzuqTEp2vv3HMXHZSi2Ds0q1HgQQPV4QDu')
ON CONFLICT (email) DO UPDATE SET employee_number = '095756';

-- Seed Sales Officer QR Record
INSERT INTO sales_officer_qrs (officer_id, employee_number, tracking_token, qr_url, is_active)
SELECT id, '095756', 'SO-TOKEN-095756', 'http://localhost:5173/?ref=SO-TOKEN-095756', true
FROM users WHERE email = 'so@slt.lk'
ON CONFLICT (employee_number) DO NOTHING;

-- Seed Products Catalog
INSERT INTO products (id, product_id, name, category, service_type, speed, monthly_price, installation_fee, popular, status, description)
VALUES 
  ('fibre-300', 'PRD-FIBRE-300', '300 Mbps Fibre Broadband', 'Fibre Broadband', 'Fibre', '300 Mbps', 6990.00, 2500.00, true, 'active', 'Ultra-fast Fibre connection for seamless streaming, gaming, and smart home connectivity.'),
  ('fibre-500', 'PRD-FIBRE-500', '500 Mbps Fibre Broadband', 'Fibre Broadband', 'Fibre', '500 Mbps', 8990.00, 2500.00, false, 'active', 'Gigabit-class speed for heavy multi-user environments and cloud workstations.'),
  ('fibre-100', 'PRD-FIBRE-100', '100 Mbps Fibre Starter', 'Fibre Broadband', 'Fibre', '100 Mbps', 4490.00, 2500.00, true, 'active', 'High-speed unlimited broadband ideal for work-from-home and HD entertainment.'),
  ('lte-anytime', 'PRD-LTE-ANYTIME', 'LTE 4G Anytime 150GB', '4G LTE', 'LTE', 'Up to 50 Mbps', 3200.00, 1500.00, false, 'active', 'Reliable 4G wireless broadband router with anytime quota.'),
  ('peo-tv-hd', 'PRD-PEOTV-HD', 'PEO TV Entertainment HD', 'PEO TV', 'PEOTV', 'HD Streaming', 1850.00, 1000.00, true, 'active', '140+ Channels, Rewind TV, Video on Demand, and full HD digital clarity.')
ON CONFLICT (id) DO NOTHING;

-- Seed Sample Active Connection for customer lookup testing
INSERT INTO connections (telephone, account_no, full_name, nic, contact_no, address_line1, address_line2, customer_type, email)
VALUES ('0701234567', 'SLT-2024-00847', 'Janith Perera', '199012345678', '0701234567', '42, Galle Road', 'Colombo 03', 'home', 'janithperera@email.com')
ON CONFLICT (telephone) DO NOTHING;

