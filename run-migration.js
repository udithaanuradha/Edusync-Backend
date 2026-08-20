require('dotenv').config();
const db = require('./src/config/db');
const fs = require('fs');
const path = require('path');

const sqlPath = path.join(__dirname, 'src/migrations/20260817_student_meeting_requests.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

db.query(sql, (err, results) => {
    if (err) {
        console.error("Migration failed:", err);
    } else {
        console.log("Migration successful!");
    }
    process.exit(0);
});
