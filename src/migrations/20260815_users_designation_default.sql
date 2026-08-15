-- Fix bad DEFAULT on users.designation for Edusync
-- Root cause: `designation` was added as `varchar(50) DEFAULT 'supervisor'`.
-- Any INSERT into `users` that omits `designation` (e.g. the old /api/signup
-- INSERT on the `main` branch, or ad-hoc scripts like insert-test-data.js /
-- scratch_test_leak.js) silently inherited 'supervisor' for every role,
-- including students. Only students/admins/mentors should ever be NULL;
-- 'coordinator'/'supervisor' should only ever be set explicitly for a
-- lecturer, either at signup or via the assign-coordinator admin flow.
-- TiDB/MySQL compatible DDL.

-- 1. Fix the column default going forward (does not touch existing rows).
ALTER TABLE users
  MODIFY COLUMN designation VARCHAR(50) DEFAULT NULL;

-- 2. One-time repair of rows corrupted by the old default.
--    Scoped to role != 'lecturer' so lecturer designations
--    ('coordinator' / 'supervisor') are never touched.
UPDATE users
SET designation = NULL
WHERE role <> 'lecturer'
  AND designation IS NOT NULL;
