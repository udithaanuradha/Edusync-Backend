-- Migration: Add mentor details link to project stages
-- This lets coordinators attach a Google Sheet or Google Form for industry mentor details.

ALTER TABLE project_stages
  ADD COLUMN IF NOT EXISTS mentor_details_url VARCHAR(512) DEFAULT NULL;
