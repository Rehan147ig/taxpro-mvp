ALTER TABLE tax_mappings ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'active';
