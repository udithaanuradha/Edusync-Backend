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
  timezone: '+05:30',

  // Without an explicit connectTimeout, a pooled connection that the remote
  // side (or an intervening network hop) silently dropped just hangs until
  // the OS-level TCP timeout — which is what surfaced as every controller
  // logging `connect ETIMEDOUT` at once during a brief network blip.
  // enableKeepAlive sends periodic TCP keepalive probes so a dead
  // connection gets detected and the pool can replace it, instead of a
  // query being handed a connection that looks idle-but-alive and isn't.
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,

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