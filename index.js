const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Import Cloudinary upload configuration
const { upload } = require('./src/config/cloudinaryConfig');
console.log('✅ Cloudinary configured for file uploads');

// DB pool (reuse for auth routes inline)
const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 4000,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: { rejectUnauthorized: true }
});

db.getConnection((err, connection) => {
  if (err) console.error('❌ DB connection failed:', err.message);
  else { console.log('✅ Connected to TiDB Cloud!'); connection.release(); }
});

// ---- Auth routes (inline, as in develop branch) ----
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });
  db.query(
    'SELECT id, name, email, role FROM users WHERE email = ? AND password = ?',
    [email, password],
    (err, results) => {
      if (err) return res.status(500).json({ error: 'Internal server error' });
      if (!results.length) return res.status(401).json({ error: 'Invalid credentials' });
      res.status(200).json({ message: 'Login successful', user: results[0] });
    }
  );
});

app.post('/api/signup', (req, res) => {
  const { firstName, lastName, email, password, role, universityId } = req.body;
  if (!firstName || !email || !password || !role)
    return res.status(400).json({ error: 'Missing required fields' });
  const finalUniId = role === 'student' ? universityId : null;
  db.query(
    'INSERT INTO users (name, email, password, role, university_id) VALUES (?, ?, ?, ?, ?)',
    [`${firstName} ${lastName}`, email, password, role, finalUniId],
    (err) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY')
          return res.status(400).json({ error: 'Email already exists' });
        return res.status(500).json({ error: 'Database error' });
      }
      res.status(201).json({ message: 'User created successfully!' });
    }
  );
});

// ---- File Upload Handler (with Cloudinary) ----
const { uploadStageFile } = require('./src/controllers/projectController');
const Project = require('./src/models/projectModel');

// Wrap upload middleware to catch errors
app.post('/api/projects/upload-file', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('❌ Upload Middleware Error:', err.message);
      return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
    }
    next();
  });
}, uploadStageFile);

console.log('📤 File upload route configured');

// ---- Project stages routes ----
const projectRoutes = require('./src/routes/projectRoutes');
app.use('/api/projects', projectRoutes);

app.get('/', (req, res) => res.send('Edusync Backend is running!'));

// Global error handler (must be last!)
app.use((err, req, res, next) => {
  console.error('❌ Global Error Handler:', err);
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));