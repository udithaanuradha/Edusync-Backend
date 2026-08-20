require('dotenv').config();
const db = require('./src/config/db');

db.query(
  "ALTER TABLE supervisor_student_meeting ADD COLUMN end_time TIME DEFAULT NULL;",
  (err, results) => {
    if (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log("Column end_time already exists.");
      } else {
        console.error("Migration failed:", err);
      }
    } else {
      console.log("Successfully added end_time to supervisor_student_meeting");
    }
    process.exit();
  }
);
