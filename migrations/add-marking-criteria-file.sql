-- Migration: Add staff-only Marking Criteria rubric file to project stages
--
-- Stored as a single column (a stage has at most one rubric) rather than a
-- stage_files row, so it never ends up in the same list the student-facing
-- Coordinator Attachments view reads from. The application also self-heals
-- this column at runtime (see ensureStageMarkingCriteriaColumn in
-- ProjectModel.js), so running this migration is not strictly required, but
-- keeps schema history explicit across environments.

ALTER TABLE project_stages
  ADD COLUMN IF NOT EXISTS marking_criteria_file TEXT DEFAULT NULL;
