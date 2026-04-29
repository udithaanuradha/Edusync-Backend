const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// --- 1. Cloudinary Configuration ---
const { upload } = require("./src/config/cloudinaryConfig");
console.log("✅ Cloudinary configured for file uploads");

// --- 2. Database Connection ---
const db = require("./src/config/db");

db.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Database connection failed:", err.message);
  } else {
    console.log("✅ Connected to TiDB Cloud / MySQL Database!");
    connection.release();
  }
});

// --- 3. Authentication Routes ---
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  db.query(
    "SELECT id, name, email, role, level FROM users WHERE email = ? AND password = ?",
    [email, password],
    (err, results) => {
      if (err) return res.status(500).json({ error: "Internal server error" });
      if (!results.length)
        return res.status(401).json({ error: "Invalid credentials" });

      const user = results[0];

      // UPDATE: Track the login time in the database
      db.query(
        "UPDATE users SET last_login = NOW() WHERE id = ?",
        [user.id],
        (updateErr) => {
          if (updateErr) console.error("❌ Failed to update login timestamp");
          res.status(200).json({ message: "Login successful", user: user });
        }
      );
    },
  );
});

app.post("/api/signup", (req, res) => {
  const { firstName, lastName, email, password, role, universityId } = req.body;

  const validation = validateUserCreation({
    firstName,
    lastName,
    email,
    password,
    role,
    universityId
  });

  if (!validation.valid) {
    return res.status(400).json({
      error: "Validation failed",
      details: validation.errors
    });
  }

  const finalUniId = role === "student" ? universityId : null;
  const startingLevel = role === "student" ? 1 : null;

  db.query(
    "INSERT INTO users (name, email, password, role, university_id, level) VALUES (?, ?, ?, ?, ?, ?)",
    [
      `${firstName} ${lastName}`,
      email,
      password,
      role,
      finalUniId,
      startingLevel,
    ],
    (err) => {
      if (err) {
        if (err.code === "ER_DUP_ENTRY") {
          if (err.sqlMessage.includes("email")) {
            return res.status(400).json({ error: "This email is already registered." });
          }
          else if (err.sqlMessage.includes("university_id")) {
            return res.status(400).json({ error: "This Index Number is already registered." });
          }
          return res.status(400).json({ error: "Account already exists." });
        }
        return res.status(500).json({ error: "Database error" });
      }
      res.status(201).json({ message: "User created successfully!" });
    },
  );
});

// --- 4. Project & File Management ---
const { uploadStageFile } = require("./src/controllers/projectController");

app.post(
  "/api/projects/upload-file",
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        console.error("❌ Upload Middleware Error:", err.message);
        return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
      }
      next();
    });
  },
  uploadStageFile,
);

app.get("/api/projects/files/:stage_id", (req, res) => {
  db.query(
    "SELECT * FROM stage_files WHERE stage_id = ? ORDER BY uploaded_at DESC",
    [req.params.stage_id],
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: results });
    },
  );
});

// --- 5. Admin Routes ---
app.get("/api/admin/stats", (req, res) => {
  db.query(
    `SELECT 
      (SELECT COUNT(*) FROM users) as totalUsers,
      (SELECT COUNT(*) FROM users WHERE role = 'student') as totalStudents,
      (SELECT COUNT(*) FROM users WHERE role = 'coordinator') as totalCoordinators,
      (SELECT COUNT(*) FROM users WHERE role = 'supervisor') as totalSupervisors,
      (SELECT COUNT(*) FROM users WHERE role = 'mentor') as totalMentors`,
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results[0]);
    },
  );
});

//  Endpoint for Recent Logins 
app.get("/api/admin/recent-logins", (req, res) => {
  db.query(
    `SELECT name as username, role, last_login as time 
     FROM users 
     WHERE last_login IS NOT NULL 
     ORDER BY last_login DESC 
     LIMIT 5`,
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    }
  );
});

app.put("/api/admin/promote-students", (req, res) => {
  db.query(
    'UPDATE users SET level = level + 1 WHERE role = "student" AND level < 4',
    (err, result) => {
      if (err) return res.status(500).json({ error: "Failed to promote students" });
      res.status(200).json({
        success: true,
        message: "Successfully promoted students!",
        studentsUpdated: result.affectedRows,
      });
    },
  );
});

// --- 6. Feature Routes ---
const projectRoutes = require("./src/routes/projectRoutes");
app.use("/api/projects", projectRoutes);

const userRoutes = require("./src/routes/userRoutes");
app.use("/api/users", userRoutes);

const groupRoutes = require("./src/routes/groupRoutes");
app.use("/api/groups", groupRoutes);

const calendarRoutes = require("./src/routes/calendarRoutes");
app.use("/api/calendar", calendarRoutes);

const supervisorpartincalenderRoutes = require("./src/routes/supervisorpartincalenderRoutes");
app.use("/api/supervisorpartincalender", supervisorpartincalenderRoutes);

const supervisorTaskRoutes = require("./src/routes/supervisorTaskRoutes");
app.use("/api/supervisor-tasks", supervisorTaskRoutes);

const messageRoutes = require("./src/routes/messageRoutes");
app.use("/api/messages", messageRoutes);

const announcementRoutes = require("./src/routes/announcementRoutes");
app.use("/api/announcements", announcementRoutes);

<<<<<<< HEAD
// Milestones & Tasks
const milestoneRoutes = require("./src/routes/milestoneRoutes");
app.use("/api/milestones", milestoneRoutes);
=======
const dashboardRoutes = require("./src/routes/dashboardRoutes");
app.use("/api/dashboard", dashboardRoutes);

// NEW: Marks Management Routes
const marksRoutes = require("./src/routes/marksRoutes");
app.use("/api/marks", marksRoutes);
>>>>>>> develop

// --- 7. Server Initialization ---
app.get("/", (req, res) => res.send("Edusync Backend is running!"));

app.use((err, req, res, next) => {
  console.error("❌ Global Error Handler:", err);
  res.status(500).json({ success: false, error: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));