require('dotenv').config();
const db = require('./src/config/db');

db.query(
  "ALTER TABLE supervisor_student_meeting ADD COLUMN supervisor_message TEXT DEFAULT NULL;",
  (err, results) => {
    if (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log("Column supervisor_message already exists.");
      } else {
        console.error("Migration failed:", err);
      }
    } else {
      console.log("Successfully added supervisor_message to supervisor_student_meeting");
    }
    process.exit();
  }
);
