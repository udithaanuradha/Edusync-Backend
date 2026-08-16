-- Student group-formation workflow migration for Edusync
-- Covers: multi-supervisor group requests, department scoping (reuses the
-- existing `academic_unit` column already used for student "Degree Program"
-- AI/IT/ITM — no new column added on `users`), and a live-schema gap found
-- while building this (project_groups.created_by is referenced throughout
-- groupController.js but does not exist on the live table).
-- TiDB/MySQL compatible DDL. Each ALTER TABLE only ever touches one column,
-- per the "Unsupported operate same column" restriction discovered earlier
-- in 20260428_users_constraints.sql.

-- 1. project_groups was missing `created_by` even though createGroup(),
--    getGroupsByLevel() and getCoordinatorGroups() already read/write it —
--    those queries currently error on live data. Add it back.
ALTER TABLE project_groups ADD COLUMN created_by INT NULL;
ALTER TABLE project_groups ADD CONSTRAINT fk_pg_created_by
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- 2. project_groups needs to carry department through to the final record.
ALTER TABLE project_groups ADD COLUMN department VARCHAR(10) NULL;

-- Backfill department for existing groups from their leader's academic_unit
-- (safe/non-destructive: only fills rows currently NULL).
UPDATE project_groups pg
JOIN project_group_members pgm ON pgm.group_id = pg.id AND pgm.is_leader = 1
JOIN users u ON u.id = pgm.student_id
SET pg.department = u.academic_unit
WHERE pg.department IS NULL;

-- 3. group_requests.supervisor_id must become nullable: a request now
--    targets one-or-more supervisors via group_request_supervisors, and
--    group_requests.supervisor_id is only set once ONE of them approves.
ALTER TABLE group_requests MODIFY COLUMN supervisor_id INT NULL;

-- 3b. Also found while wiring this up: the *existing* (legacy, not called
-- by the current frontend) approveGroupRequest/rejectGroupRequest functions
-- already write to a `processed_at` column that has never existed on the
-- live table — if anything ever called those routes it would 500 on
-- "Unknown column 'processed_at'". Add it so both the legacy endpoints and
-- the new approve/reject endpoints work correctly.
ALTER TABLE group_requests ADD COLUMN processed_at TIMESTAMP NULL;

-- 4. New table: one row per supervisor targeted by a group request.
CREATE TABLE group_request_supervisors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  supervisor_id INT NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'cancelled') DEFAULT 'pending',
  rejection_reason TEXT NULL,
  responded_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_request_supervisor (request_id, supervisor_id),
  KEY idx_grs_request (request_id),
  KEY idx_grs_supervisor (supervisor_id),
  CONSTRAINT fk_grs_request FOREIGN KEY (request_id) REFERENCES group_requests(request_id) ON DELETE CASCADE,
  CONSTRAINT fk_grs_supervisor FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Backfill: every existing group_requests row was single-supervisor under
-- the old model, so give each one a matching child row reflecting its
-- current status, so the new approve/reject/pending-list endpoints see
-- consistent data for requests that already exist.
INSERT INTO group_request_supervisors (request_id, supervisor_id, status, rejection_reason, responded_at)
SELECT request_id, supervisor_id, status, rejection_reason,
       CASE WHEN status IN ('approved', 'rejected') THEN created_at ELSE NULL END
FROM group_requests
WHERE supervisor_id IS NOT NULL;
