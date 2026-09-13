 const mysql = require('mysql2');
require('dotenv').config();


const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306, 
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // TiDB Cloud stores/returns TIMESTAMP/DATETIME values in UTC — this must
  // match the *server's* actual timezone (it tells mysql2 how to interpret
  // what it reads back), not the app's local timezone. It was set to
  // '+05:30' (Sri Lanka), which made every timestamp read from the DB get
  // misinterpreted as already being in +05:30 when it was really UTC,
  // shifting every displayed time ~5.5 hours off. 'Z' = UTC, matching what
  // the server actually sends; the frontend's own toLocaleTimeString()
  // calls already convert UTC to each viewer's local time correctly, so no
  // frontend change is needed once this matches reality.
  timezone: 'Z',

  ssl: { rejectUnauthorized: true }
});


db.getConnection((err, connection) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
  } else {
    console.log('✅ Connected to MySQL Database on port', process.env.DB_PORT || 3306);
    connection.release();
  }
});

module.exports = db;