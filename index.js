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

// DB pool
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

// ---- Auth routes ----
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });
  db.query(
    'SELECT id, name, email, role, level FROM users WHERE email = ? AND password = ?',
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
  const startingLevel = role === 'student' ? 1 : null; // Auto Level 1 for students

  db.query(
    'INSERT INTO users (name, email, password, role, university_id, level) VALUES (?, ?, ?, ?, ?, ?)',
    [`${firstName} ${lastName}`, email, password, role, finalUniId, startingLevel],
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

// ---- Get files for a stage ----
app.get('/api/projects/files/:stage_id', (req, res) => {
  db.query(
    'SELECT * FROM stage_files WHERE stage_id = ? ORDER BY uploaded_at DESC',
    [req.params.stage_id],
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: results });
    }
  );
});

// ---- Admin stats route ----
app.get('/api/admin/stats', (req, res) => {
  db.query(
    `SELECT 
      (SELECT COUNT(*) FROM users) as totalUsers,
      (SELECT COUNT(*) FROM users WHERE role = 'student') as totalStudents,
      (SELECT COUNT(*) FROM users WHERE role = 'coordinator') as totalCoordinators,
      (SELECT COUNT(*) FROM users WHERE role = 'supervisor') as totalSupervisors
    `,
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        totalUsers: results[0].totalUsers,
        totalStudents: results[0].totalStudents,
        totalCoordinators: results[0].totalCoordinators,
        totalSupervisors: results[0].totalSupervisors
      });
    }
  );
});

// ---- Admin promote students route ----
app.put('/api/admin/promote-students', (req, res) => {
  db.query(
    'UPDATE users SET level = level + 1 WHERE role = "student" AND level < 4',
    (err, result) => {
      if (err) return res.status(500).json({ error: 'Failed to promote students' });
      res.status(200).json({
        success: true,
        message: 'Successfully promoted all eligible students!',
        studentsUpdated: result.affectedRows
      });
    }
  );
});

// ---- Project stages routes ----
const projectRoutes = require('./src/routes/projectRoutes');
app.use('/api/projects', projectRoutes);

// ---- User routes (Group Formation Search) ----
const userRoutes = require('./src/routes/userRoutes');
app.use('/api/users', userRoutes);

// ---- Group routes ----
const groupRoutes = require('./src/routes/groupRoutes');
app.use('/api/groups', groupRoutes);

// ---- Announcement routes ----
const announcementRoutes = require('./src/routes/announcementRoutes');
app.use('/api/announcements', announcementRoutes);

// ---- Base Route ----
app.get('/', (req, res) => res.send('Edusync Backend is running!'));

// ---- Global error handler ----
app.use((err, req, res, next) => {
  console.error('❌ Global Error Handler:', err);
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

// ---- Start Server ----
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));