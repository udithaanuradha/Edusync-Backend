const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// --- 1. Cloudinary Configuration ---
// Note: Ensure this file exports { upload }
const { upload } = require("./src/config/cloudinaryConfig");
console.log("✅ Cloudinary configured for file uploads");

// --- 2. Database Connection (TiDB Cloud / MySQL) ---
const db = require("./src/config/db");

// --- 3. Validation Utilities ---
const { validateUserCreation, VALID_ROLES } = require("./src/utils/validators");
console.log("✅ Validation utilities loaded");

// Check connection status in terminal
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
      res.status(200).json({ message: "Login successful", user: results[0] });
    },
  );
});

app.post("/api/signup", (req, res) => {
  const { firstName, lastName, email, password, role, universityId } = req.body;

  // Validate user input using comprehensive validator
  const validation = validateUserCreation({
    firstName,
    lastName,
    email,
    password,
    role,
    universityId
  });

  // Return validation errors if any exist
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
        // Check if the database rejected it because of a duplicate
        if (err.code === "ER_DUP_ENTRY") {
          // Check if the duplicate was the email
          if (err.sqlMessage.includes("email")) {
            return res
              .status(400)
              .json({ error: "This email is already registered." });
          }
          // Check if the duplicate was the Index Number
          else if (err.sqlMessage.includes("university_id")) {
            return res
              .status(400)
              .json({ error: "This Index Number is already registered." });
          }
          // Fallback for any other duplicate
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
        return res
          .status(400)
          .json({ success: false, error: `Upload error: ${err.message}` });
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
      if (err)
        return res.status(500).json({ success: false, error: err.message });
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
      (SELECT COUNT(*) FROM users WHERE role = 'supervisor') as totalSupervisors`,
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results[0]);
    },
  );
});

app.put("/api/admin/promote-students", (req, res) => {
  db.query(
    'UPDATE users SET level = level + 1 WHERE role = "student" AND level < 4',
    (err, result) => {
      if (err)
        return res.status(500).json({ error: "Failed to promote students" });
      res.status(200).json({
        success: true,
        message: "Successfully promoted students!",
        studentsUpdated: result.affectedRows,
      });
    },
  );
});

// --- 6. Feature Routes ---

// Project stages
const projectRoutes = require("./src/routes/projectRoutes");
app.use("/api/projects", projectRoutes);

// User/Search routes
const userRoutes = require("./src/routes/userRoutes");
app.use("/api/users", userRoutes);

// --- GROUP MANAGEMENT & DISPLAY ---
// This handles: http://localhost:5000/api/groups/display/:level
const groupRoutes = require("./src/routes/groupRoutes");
app.use("/api/groups", groupRoutes);

// Calendar routes
const calendarRoutes = require("./src/routes/calendarRoutes");
app.use("/api/calendar", calendarRoutes);

// Supervisor recurring lecture schedule routes
const supervisorpartincalenderRoutes = require("./src/routes/supervisorpartincalenderRoutes");
app.use("/api/supervisorpartincalender", supervisorpartincalenderRoutes);

// NEW: Supervisor specific timeline tasks (meetings, personal, etc.)
const supervisorTaskRoutes = require("./src/routes/supervisorTaskRoutes");
app.use("/api/supervisor-tasks", supervisorTaskRoutes);

// Message routes
const messageRoutes = require("./src/routes/messageRoutes");
app.use("/api/messages", messageRoutes);

// Announcements
const announcementRoutes = require("./src/routes/announcementRoutes");
app.use("/api/announcements", announcementRoutes);

// Milestones & Tasks
const milestoneRoutes = require("./src/routes/milestoneRoutes");
app.use("/api/milestones", milestoneRoutes);

// --- 7. Server Initialization ---
app.get("/", (req, res) => res.send("Edusync Backend is running!"));

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("❌ Global Error Handler:", err);
  res
    .status(500)
    .json({ success: false, error: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
