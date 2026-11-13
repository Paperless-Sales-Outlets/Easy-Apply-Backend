-- =============================================================================
-- SLT EasyApply Portal - PostgreSQL Database Schema
-- Idempotent DDL script compatible with Supabase and standard PostgreSQL
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1. Staff Roles & Privileges
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    permissions TEXT[] DEFAULT '{}',
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS privileges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. Users Table (Staff & Admins) - Preserves bcrypt password hashes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(50) UNIQUE,
    nic VARCHAR(50) UNIQUE,
    role VARCHAR(50) NOT NULL,
    employee_number VARCHAR(50) UNIQUE,
    permissions TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    password_hash VARCHAR(255),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_employee_number ON users(employee_number);

-- -----------------------------------------------------------------------------
-- 3. Customers Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(50) NOT NULL UNIQUE,
    role VARCHAR(50) DEFAULT 'Customer',
    nic VARCHAR(50) UNIQUE,
    title VARCHAR(20) DEFAULT 'Mr.',
    dob VARCHAR(50),
    gender VARCHAR(20) DEFAULT 'Male',
    nationality VARCHAR(50) DEFAULT 'Sri Lankan',
    contact_number VARCHAR(50),
    address_line1 TEXT,
    address_line2 TEXT,
    city VARCHAR(100),
    district VARCHAR(100),
    postal_code VARCHAR(20),
    preferred_contact VARCHAR(20) DEFAULT 'SMS',
    identity_documents JSONB DEFAULT '{}'::jsonb,
    kyc_status VARCHAR(30) DEFAULT 'pending',
    kyc_notes TEXT,
    kyc_actioned_at TIMESTAMPTZ,
    password_hash VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_nic ON customers(nic);
CREATE INDEX IF NOT EXISTS idx_customers_kyc_status ON customers(kyc_status);

-- -----------------------------------------------------------------------------
-- 4. Products Catalog Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(50) PRIMARY KEY,
    product_id VARCHAR(50) UNIQUE,
    product_code VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    service_type VARCHAR(100) DEFAULT 'Broadband',
    speed VARCHAR(100),
    monthly_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    installation_fee NUMERIC(12, 2) DEFAULT 0,
    description TEXT,
    features JSONB DEFAULT '[]'::jsonb,
    image TEXT,
    available_quantity INTEGER DEFAULT 999,
    status VARCHAR(30) DEFAULT 'active',
    popular BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_popular ON products(popular);

-- -----------------------------------------------------------------------------
-- 5. Applications Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference_number VARCHAR(50) NOT NULL UNIQUE,
    phone VARCHAR(50) NOT NULL,
    service_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    payment_status VARCHAR(50) DEFAULT 'pending',
    payment_details JSONB DEFAULT '{}'::jsonb,
    notes TEXT,
    actioned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    actioned_at TIMESTAMPTZ,
    nic VARCHAR(50) NOT NULL,
    form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    documents JSONB DEFAULT '{}'::jsonb,
    office_fields JSONB DEFAULT '{}'::jsonb,
    sales_officer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    sales_officer_employee_number VARCHAR(50),
    sales_tracking_token VARCHAR(100),
    sales_attribution JSONB DEFAULT '{}'::jsonb,
    completed_sale BOOLEAN DEFAULT FALSE,
    completed_sale_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_applications_sales_officer ON applications(sales_officer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_sales_officer_emp ON applications(sales_officer_employee_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_payment_status ON applications(payment_status);
CREATE INDEX IF NOT EXISTS idx_applications_nic ON applications(nic);
CREATE INDEX IF NOT EXISTS idx_applications_phone ON applications(phone);
CREATE INDEX IF NOT EXISTS idx_applications_completed_sale ON applications(completed_sale);

-- -----------------------------------------------------------------------------
-- 6. New Connection Drafts
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS new_connection_drafts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone VARCHAR(50) NOT NULL,
    status VARCHAR(30) DEFAULT 'active',
    form_data JSONB DEFAULT '{}'::jsonb,
    selected_product JSONB DEFAULT NULL,
    step_index INTEGER DEFAULT 0,
    photos JSONB DEFAULT '{}'::jsonb,
    resume_until TIMESTAMPTZ NOT NULL,
    expired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- At most one active draft per mobile number
CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_phone_active_unique 
    ON new_connection_drafts(phone) 
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_draft_status_resume ON new_connection_drafts(status, resume_until);

-- -----------------------------------------------------------------------------
-- 7. Carts & Cart Items
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(100) NOT NULL UNIQUE,
    total_amount NUMERIC(12, 2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cart_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cart_id UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    product_id VARCHAR(50) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id ON cart_items(cart_id);

-- -----------------------------------------------------------------------------
-- 8. Sales Officer QR Codes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_officer_qrs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    officer_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    employee_number VARCHAR(50) NOT NULL UNIQUE,
    tracking_token VARCHAR(100) NOT NULL UNIQUE,
    qr_url TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    scans_count INTEGER DEFAULT 0,
    last_scanned_at TIMESTAMPTZ,
    regenerated_at TIMESTAMPTZ,
    previous_tokens JSONB DEFAULT '[]'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_officer_qrs_token ON sales_officer_qrs(tracking_token);
CREATE INDEX IF NOT EXISTS idx_sales_officer_qrs_emp ON sales_officer_qrs(employee_number);

-- -----------------------------------------------------------------------------
-- 9. Existing Established Connections (for Reconnection lookup)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telephone VARCHAR(50) NOT NULL UNIQUE,
    account_no VARCHAR(50) UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    nic VARCHAR(50) NOT NULL,
    contact_no VARCHAR(50) NOT NULL,
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    location JSONB DEFAULT '{}'::jsonb,
    customer_type VARCHAR(50) DEFAULT 'home',
    email VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connections_telephone ON connections(telephone);
CREATE INDEX IF NOT EXISTS idx_connections_nic ON connections(nic);

-- -----------------------------------------------------------------------------
-- 10. Leads (Survey Feasibility)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference_number VARCHAR(50) NOT NULL UNIQUE,
    customer_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255),
    address TEXT,
    status VARCHAR(50) DEFAULT 'new',
    technology VARCHAR(50) DEFAULT 'FTTH',
    risk_level VARCHAR(30) DEFAULT 'none',
    checks JSONB DEFAULT '[]'::jsonb,
    location JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_reference ON leads(reference_number);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);

-- -----------------------------------------------------------------------------
-- 11. OTPs & OTP Lockouts
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);

CREATE TABLE IF NOT EXISTS otps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identifier VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    attempts INTEGER DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otps_identifier_type ON otps(identifier, type);

CREATE TABLE IF NOT EXISTS otp_lockouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identifier VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL,
    locked_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_lockouts_lookup ON otp_lockouts(identifier, type);

-- -----------------------------------------------------------------------------
-- 12. KYC Reviews
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kyc_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subject_type VARCHAR(50) NOT NULL,
    subject_id UUID NOT NULL,
    decided_by VARCHAR(50),
    decided_by_name VARCHAR(255),
    decided_by_id UUID,
    decided_at TIMESTAMPTZ DEFAULT NOW(),
    auto_decision VARCHAR(50),
    auto_checked_at TIMESTAMPTZ,
    case_info JSONB,
    checks JSONB DEFAULT '[]'::jsonb,
    history JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kyc_reviews_subject ON kyc_reviews(subject_type, subject_id);

-- -----------------------------------------------------------------------------
-- 13. Appointments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
    reference_number VARCHAR(50) DEFAULT '',
    customer_name VARCHAR(255) DEFAULT '',
    phone VARCHAR(50) DEFAULT '',
    address TEXT DEFAULT '',
    service_type VARCHAR(50) DEFAULT 'new-connection',
    scheduled_at TIMESTAMPTZ NOT NULL,
    time_slot VARCHAR(100) DEFAULT 'Morning (08.30 AM - 12.00 PM)',
    landmark_notes TEXT DEFAULT '',
    dispatch_id VARCHAR(100) DEFAULT '',
    technician_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'scheduled',
    feedback JSONB DEFAULT '{}'::jsonb,
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_ref ON appointments(reference_number);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_tech ON appointments(technician_id);

-- -----------------------------------------------------------------------------
-- 14. Forms
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    form_type VARCHAR(100) NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(50) DEFAULT 'pending',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    comments JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forms_type ON forms(form_type);
CREATE INDEX IF NOT EXISTS idx_forms_status ON forms(status);

-- -----------------------------------------------------------------------------
-- 15. Audit Logs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action VARCHAR(100) NOT NULL,
    actor_id UUID,
    actor_role VARCHAR(50),
    ip_address VARCHAR(50),
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- -----------------------------------------------------------------------------
-- WebAuthn passkeys for admin / staff sign-in
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS passkeys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    credential_public_key TEXT NOT NULL,          -- base64
    counter BIGINT NOT NULL DEFAULT 0,
    device_type VARCHAR(30) DEFAULT 'singleDevice',
    backed_up BOOLEAN DEFAULT FALSE,
    transports TEXT[] DEFAULT '{}',
    device_name VARCHAR(100) DEFAULT 'Passkey Device',
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);

CREATE TABLE IF NOT EXISTS passkey_challenges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    challenge TEXT NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,                    -- 'registration' | 'authentication'
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_passkey_challenges_expires ON passkey_challenges(expires_at);

-- ── Branches (see db/migrations/2026-11-13-branches.sql) ──
CREATE TABLE IF NOT EXISTS regions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_regions_name ON regions (LOWER(name));

CREATE TABLE IF NOT EXISTS provinces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    region_id UUID NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_provinces_name ON provinces (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_provinces_region ON provinces (region_id);

CREATE TABLE IF NOT EXISTS rtos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    province_id UUID NOT NULL REFERENCES provinces(id) ON DELETE RESTRICT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rtos_name ON rtos (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_rtos_province ON rtos (province_id);

CREATE TABLE IF NOT EXISTS teleshops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    rto_id UUID NOT NULL REFERENCES rtos(id) ON DELETE RESTRICT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_teleshops_name ON teleshops (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_teleshops_rto ON teleshops (rto_id);
