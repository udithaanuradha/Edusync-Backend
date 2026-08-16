-- User table constraints migration for Edusync
-- Apply this after ensuring existing data already complies with the rules below.
-- TiDB/MySQL compatible DDL.
--
-- IMPORTANT (learned the hard way in the TiDB Cloud SQL editor):
-- TiDB rejects a single ALTER TABLE statement that touches the same column
-- more than once (e.g. MODIFY COLUMN email ... together with
-- ADD CONSTRAINT ... UNIQUE (email)) with "Unsupported operate same column
-- '<col>'". Each action below is its own ALTER TABLE statement so no column
-- is referenced twice in one statement. Run them in order.
--
-- The role CHECK list was also corrected: live data (and validators.js)
-- actually use 'lecturer' and 'mentor' in addition to the original 5 values;
-- the original list would have rejected/silently-not-enforced 29+ existing
-- rows. Verify against `SELECT DISTINCT role FROM users;` before applying
-- if roles have changed again since this was written.

ALTER TABLE users MODIFY COLUMN name VARCHAR(255) NOT NULL;
ALTER TABLE users MODIFY COLUMN email VARCHAR(255) NOT NULL;
ALTER TABLE users MODIFY COLUMN password VARCHAR(255) NOT NULL;
ALTER TABLE users MODIFY COLUMN role VARCHAR(50) NOT NULL;

ALTER TABLE users ADD CONSTRAINT chk_users_role
  CHECK (role IN ('student', 'supervisor', 'coordinator', 'admin', 'industry mentor', 'lecturer', 'mentor'));

-- Redundant in practice: `email` already carries two unique indexes
-- (`email`, `unique_email`) from earlier migrations/manual changes. Only
-- run this if you've cleaned those up and actually want a single
-- canonically-named unique key instead.
-- ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email);

-- DO NOT run this yet. As of 2026-08-15 there are 7 groups of duplicate
-- non-NULL university_id values already in production (e.g. '2345678'
-- shared by 4 accounts, and one row using an email address as its
-- university_id on 3 accounts). This ALTER will fail until those are
-- resolved. Find them with:
--   SELECT university_id, COUNT(*) FROM users
--   WHERE university_id IS NOT NULL
--   GROUP BY university_id HAVING COUNT(*) > 1;
-- ALTER TABLE users ADD CONSTRAINT uq_users_university_id UNIQUE (university_id);
