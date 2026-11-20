-- Manual database backups, managed from the Backup Dashboard (Super Admin only).
--
-- IMPORTANT: these tables are deliberately NOT linked to `users` by a foreign
-- key, and they are excluded from every backup (pg_dump --exclude-table).
-- A restore replaces the live data with an older snapshot; if these tables were
-- part of it, the backup history and its audit trail would be rolled back too.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS backups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_name VARCHAR(255) NOT NULL,
    backup_type VARCHAR(20) NOT NULL DEFAULT 'database'
        CHECK (backup_type IN ('database', 'database_files')),
    purpose VARCHAR(20) NOT NULL DEFAULT 'manual'
        CHECK (purpose IN ('manual', 'pre_restore')),
    note TEXT NOT NULL,
    created_by UUID,
    created_by_name VARCHAR(255),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    duration_ms BIGINT,
    size_bytes BIGINT,
    checksum_sha256 VARCHAR(64),
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'success', 'failed')),
    stage VARCHAR(40),
    error_message TEXT,
    storage_backend VARCHAR(20) NOT NULL DEFAULT 'local',
    storage_path TEXT,
    -- Latest result of each follow-up operation: { status, startedAt, finishedAt, ... }
    verify_result JSONB,
    test_restore_result JSONB,
    restore_result JSONB,
    -- What the backup holds: { files: boolean, documents: [{ bucket, count, bytes }] | null }
    contents JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backups_started ON backups(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_backups_status ON backups(status);

CREATE TABLE IF NOT EXISTS backup_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- No foreign key: the entry must outlive the backup it describes.
    backup_id UUID,
    backup_name VARCHAR(255),
    action VARCHAR(30) NOT NULL
        CHECK (action IN ('created', 'verified', 'downloaded', 'test_restored', 'restored', 'deleted', 'failed')),
    actor_id UUID,
    actor_name VARCHAR(255),
    ip_address VARCHAR(64),
    result VARCHAR(20) NOT NULL DEFAULT 'success'
        CHECK (result IN ('success', 'failure')),
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_audit_created ON backup_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_audit_action ON backup_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_backup_audit_backup ON backup_audit_logs(backup_id);

-- For databases that applied an earlier version of this migration.
ALTER TABLE backups ADD COLUMN IF NOT EXISTS contents JSONB;
