/**
 * Database Migration Runner
 * Run this script once to ensure message table has all required columns
 */

const db = require('../config/db');

const runMigrations = async () => {
  console.log('Starting database migrations...');

  const migrations = [
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
