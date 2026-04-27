 const mysql = require('mysql2');
require('dotenv').config();

/**
 * Database Connection Pool
 * Using createPool is better for production as it manages multiple 
 * connections and prevents the "too many connections" error.
 */
const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306, // Standard MySQL port is 3306
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // If you are working locally (XAMPP), you might need to comment out the SSL line
  ssl: { rejectUnauthorized: true } 
});

// Quick connection test to verify credentials on startup
db.getConnection((err, connection) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
  } else {
    console.log('✅ Connected to MySQL Database on port', process.env.DB_PORT || 3306);
    connection.release();
  }
});

module.exports = db;