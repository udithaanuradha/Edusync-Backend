-- User table constraints migration for Edusync
-- Apply this after ensuring existing data already complies with the rules below.
-- TiDB/MySQL compatible DDL.

ALTER TABLE users
  MODIFY COLUMN name VARCHAR(255) NOT NULL,
  MODIFY COLUMN email VARCHAR(255) NOT NULL,
  MODIFY COLUMN password VARCHAR(255) NOT NULL,
  MODIFY COLUMN role VARCHAR(50) NOT NULL,
  ADD CONSTRAINT chk_users_role
    CHECK (role IN ('student', 'supervisor', 'coordinator', 'admin', 'industry mentor')),
  ADD CONSTRAINT uq_users_email
    UNIQUE (email),
  ADD CONSTRAINT uq_users_university_id
    UNIQUE (university_id);
