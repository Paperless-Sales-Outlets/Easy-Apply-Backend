-- Branches: the SLT branch hierarchy managed from the admin portal.
-- Region → Province → Regional Telecommunication Officer (RTO) → Teleshop.
-- Each entry belongs to exactly one parent, and a parent that still has
-- entries under it can't be deleted (ON DELETE RESTRICT).
-- Names are unique within a level, ignoring capitals.
-- Safe to run more than once.

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
