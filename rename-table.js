require('dotenv').config();
const db = require('./src/config/db');

db.query("RENAME TABLE student_meeting_requests TO supervisor_student_meeting;", (err, results) => {
    if (err) {
        console.error("Migration failed:", err);
    } else {
        console.log("Migration successful!");
    }
    process.exit(0);
});
