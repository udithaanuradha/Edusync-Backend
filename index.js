const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
require('dotenv').config();

// 1. Initialize the Express App
const app = express();

// 2. Set up Middleware
app.use(cors()); 
app.use(express.json()); 

// 3. Create the Database Connection Pool (UPDATED FOR CLOUD SSL)
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: {
    rejectUnauthorized: true // <--- This is required for TiDB Cloud!
  }
});

// Test the database connection
db.getConnection((err, connection) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
  } else {
    console.log('✅ Successfully connected to the Edusync MySQL database!');
    connection.release(); 
  }
});

// 4. Basic test route
app.get('/', (req, res) => {
  res.send('Edusync Backend Server is running!');
});

// --- AUTHENTICATION ROUTES ---

// LOGIN ROUTE
app.post('/api/login', (req, res) => {
    console.log("👉 Login attempt received from React:", req.body);
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Please provide both email and password' });
  }

  const query = 'SELECT id, name, email, role FROM users WHERE email = ? AND password = ?';
  
  db.query(query, [email, password], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (results.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = results[0];
    res.status(200).json({
      message: 'Login successful',
      user: user
    });
  });
});

// SIGNUP ROUTE
app.post('/api/signup', (req, res) => {
  const { firstName, lastName, email, password, role, universityId } = req.body;
  const fullName = `${firstName} ${lastName}`;

  // Validation: Ensure required fields are present
  if (!firstName || !email || !password || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Logic: Only students should have a university_id
  const finalUniId = (role === 'student') ? universityId : null;

  const query = 'INSERT INTO users (name, email, password, role, university_id) VALUES (?, ?, ?, ?, ?)';
  
  db.query(query, [fullName, email, password, role, finalUniId], (err, result) => {
    if (err) {
      console.error('Signup error:', err);
      // Check if it's a duplicate email error
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ error: 'An account with this email already exists' });
      }
      return res.status(500).json({ error: 'Database error during signup' });
    }

    res.status(201).json({ message: 'User created successfully!' });
  });
});

// 5. Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});