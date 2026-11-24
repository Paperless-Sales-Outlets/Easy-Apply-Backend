-- Migration: Add missing performance indexes identified in system architecture audit
-- 1. JSONB GIN index on applications.form_data for fast customer name/nic/phone searches
CREATE INDEX IF NOT EXISTS idx_applications_form_data_gin ON applications USING gin (form_data);

-- 2. Composite index on audit_logs for target entity lookups ordered by time
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs (target_id, created_at DESC);

-- 3. Created_at sort index on applications to speed up dashboard and pagination queries
CREATE INDEX IF NOT EXISTS idx_applications_created_at ON applications (created_at DESC);
