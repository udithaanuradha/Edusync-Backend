require('dotenv').config();
const db = require('./src/config/db');

db.query(`SELECT * FROM supervisor_student_meeting WHERE supervisor_id = ? AND status = 'pending'`, [2850005], (err, results) => {
    if (err) {
        console.error("Query failed:", err);
    } else {
        console.log("Query results:", results);
    }
    process.exit(0);
});
