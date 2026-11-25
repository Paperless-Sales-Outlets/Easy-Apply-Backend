-- Copy existing backup activity into the shared audit log without removing
-- the original rows. The metadata source ID makes this safe to re-run.
INSERT INTO audit_logs (action, actor_id, actor_role, ip_address, details, created_at)
SELECT
    'BACKUP_' || UPPER(b.action),
    b.actor_id,
    COALESCE(u.role, 'System'),
    LEFT(COALESCE(b.ip_address, ''), 50),
    jsonb_build_object(
        'userName', COALESCE(b.actor_name, u.name),
        'module', 'Backups',
        'targetId', b.backup_id::text,
        'description',
            INITCAP(REPLACE(b.action, '_', ' ')) || ' backup' ||
            CASE WHEN b.backup_name IS NULL THEN '' ELSE ' ' || b.backup_name END ||
            CASE WHEN b.result = 'failure' THEN ' failed' ELSE '' END,
        'metadata', jsonb_build_object(
            'backupAuditId', b.id::text,
            'backupId', b.backup_id,
            'backupName', b.backup_name,
            'backupAction', b.action,
            'result', b.result,
            'ipAddress', b.ip_address,
            'details', COALESCE(b.details, '{}'::jsonb)
        )
    ),
    b.created_at
FROM backup_audit_logs b
LEFT JOIN users u ON u.id = b.actor_id
WHERE NOT EXISTS (
    SELECT 1
    FROM audit_logs existing
    WHERE existing.details #>> '{metadata,backupAuditId}' = b.id::text
);
