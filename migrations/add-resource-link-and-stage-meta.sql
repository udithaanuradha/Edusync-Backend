-- Migration: Add stage metadata and generic resource link support

ALTER TABLE project_stages
  ADD COLUMN IF NOT EXISTS level INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS created_by INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS resource_link TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS resource_links TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS mentor_details_url TEXT DEFAULT NULL;

UPDATE project_stages
SET resource_link = COALESCE(resource_link, resource_links, mentor_details_url),
    resource_links = COALESCE(resource_links, resource_link, mentor_details_url)
WHERE resource_link IS NULL
   OR resource_links IS NULL;