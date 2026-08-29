/**
 * Database Migration Runner
 * Run this script once to ensure message table has all required columns
 */

const db = require('../config/db');

const runMigrations = async () => {
  console.log('Starting database migrations...');

  const migrations = [
    {
      name: 'Ensure evaluation_panels table exists',
      sql: `CREATE TABLE IF NOT EXISTS evaluation_panels (
        id INT AUTO_INCREMENT PRIMARY KEY,
        evaluation_type VARCHAR(255) NOT NULL,
        academic_level INT NOT NULL,
        target_group VARCHAR(255) NOT NULL,
        evaluators JSON NULL,
        panel_date DATE NOT NULL,
        start_time TIME NOT NULL,
        duration VARCHAR(50) DEFAULT '60 min',
        location VARCHAR(255) DEFAULT 'To be announced',
        meeting_link TEXT DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        kind VARCHAR(100) DEFAULT 'Coordinator scheduled panel',
        created_by INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
    },
    {
      name: 'Ensure frozen_dates table exists',
      sql: `CREATE TABLE IF NOT EXISTS frozen_dates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        frozen_date DATE NOT NULL,
        reason VARCHAR(255) DEFAULT '',
        type VARCHAR(80) DEFAULT 'calendar_freeze',
        created_by INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_frozen_date (frozen_date),
        CONSTRAINT fk_frozen_dates_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )`,
    },
    {
      name: 'Add resource_links column to project_stages',
      sql: `ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS resource_links TEXT DEFAULT NULL`,
    },
    {
      name: 'Add receiver_id column',
      sql: `ALTER TABLE messages ADD COLUMN IF NOT EXISTS receiver_id INT NOT NULL DEFAULT 0`,
    },
    {
      name: 'Add receiver_name column',
      sql: `ALTER TABLE messages ADD COLUMN IF NOT EXISTS receiver_name VARCHAR(255) NOT NULL DEFAULT ''`,
    },
    {
      name: 'Add receiver_role column',
      sql: `ALTER TABLE messages ADD COLUMN IF NOT EXISTS receiver_role VARCHAR(50) NOT NULL DEFAULT ''`,
    },
    {
      name: 'Add read_status column',
      sql: `ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_status BOOLEAN DEFAULT false`,
    },
    {
      // Scopes a stage to the degree program it was created for. NULL means
      // "visible to everyone" — existing stages keep their current global
      // visibility; only stages created after this migration get scoped.
      // (Also self-healed lazily in ProjectModel.js's ensureStageAcademicUnitColumn,
      // so this doesn't have to be run manually against every environment.)
      name: 'Add academic_unit column to project_stages',
      sql: `ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS academic_unit VARCHAR(50) DEFAULT NULL`,
    },
    {
      name: 'Add submission_link column to student_submissions',
      sql: `ALTER TABLE student_submissions ADD COLUMN IF NOT EXISTS submission_link VARCHAR(500) DEFAULT NULL`,
    },
  ];

  for (const migration of migrations) {
    try {
      await new Promise((resolve, reject) => {
        db.query(migration.sql, (err, results) => {
          if (err) {
            // Ignore errors about column already existing
            if (err.message.includes('Duplicate column')) {
              console.log(`✓ ${migration.name} - already exists`);
              resolve();
            } else {
              reject(err);
            }
          } else {
            console.log(`✓ ${migration.name}`);
            resolve();
          }
        });
      });
    } catch (error) {
      console.error(`✗ Migration failed: ${migration.name}`, error.message);
    }
  }

  console.log('Migrations completed!');
  process.exit(0);
};

runMigrations().catch((error) => {
  console.error('Fatal migration error:', error);
  process.exit(1);
});
