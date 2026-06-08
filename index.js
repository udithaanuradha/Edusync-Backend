const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
require("dotenv").config();
const { validateUserCreation } = require("./src/utils/validators");
const { sendOtpEmail } = require("./src/config/emailConfig");
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

      // Normalize 'industry mentor' → 'mentor' before sending to frontend
      if (user.role === 'industry mentor') {
        user.role = 'mentor';
      }

      db.query(
        "UPDATE users SET last_login = NOW() WHERE id = ?",
        [user.id],
        (updateErr) => {
          if (updateErr) console.error("❌ Failed to update login timestamp");
          res.status(200).json({ message: "Login successful", user: user });
        }
      );
    }
  );
});

app.post('/api/signup', async (req, res) => {
    let { name, email, password, role, university_id, phone } = req.body;

    // If the role comes from the frontend as 'industry mentor', 
    // keep it exactly as 'industry mentor' for your database insert statement
    const userSql = "INSERT INTO users (name, email, password, role, university_id, phone) VALUES (?, ?, ?, ?, ?, ?)";
    db.query(userSql, [name, email, password, role, university_id, phone], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        const newUserId = result.insertId; 
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString(); 
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); 

        // Insert into your otp_verifications table using the newly generated user ID integer
        const otpSql = "INSERT INTO otp_verifications (user_id, otp_code, expires_at) VALUES (?, ?, ?)";
        db.query(otpSql, [newUserId, otpCode, expiresAt], (otpErr, otpResult) => {
            if (otpErr) return res.status(500).json({ error: otpErr.message });

            // Dispatch the email via Brevo using the user's email address string
            sendOtpEmail(email, otpCode);

            res.status(200).json({ success: true, message: "User registered. OTP sent!" });
        });
    });
});

app.post('/api/verify-otp', (req, res) => {
    const { email, otpCode } = req.body;

    if (!email || !otpCode) {
        return res.status(400).json({ error: "Email and OTP code are required" });
    }

    // 1. First look up the user by their email to find their unique user ID integer
    const findUserSql = "SELECT id FROM users WHERE email = ?";
    db.query(findUserSql, [email], (err, userResults) => {
        if (err) return res.status(500).json({ error: "Internal server error during user lookup" });
        
        if (userResults.length === 0) {
            return res.status(404).json({ error: "User not found or registration incomplete." });
        }

        const userId = userResults[0].id;

        // 2. Verify the OTP matching the retrieved user_id instead of the old email string
        const verifySql = "SELECT * FROM otp_verifications WHERE user_id = ? AND otp_code = ? AND expires_at > NOW()";
        db.query(verifySql, [userId, otpCode], (verifyErr, otpResults) => {
            if (verifyErr) return res.status(500).json({ error: verifyErr.message });

            if (otpResults.length > 0) {
                // SUCCESS! The code matches and is not expired.
                // You can update a user verification flag or simply return success so frontend redirects them to login.
                res.status(200).json({ success: true, message: "Account successfully verified! You can now log in." });
            } else {
                res.status(400).json({ error: "Invalid or expired OTP code." });
            }
        });
    });
});

// --- Resend OTP Route ---
// Generates a fresh OTP for an already-registered user and resends it via email
app.post('/api/resend-otp', async (req, res) => {
    const { email } = req.body;

    if (!email) return res.status(400).json({ error: 'Email is required.' });

    // 1. Check if the user exists
    const findUserSql = "SELECT id FROM users WHERE email = ?";
    db.query(findUserSql, [email], (err, userResults) => {
        if (err) return res.status(500).json({ error: 'Internal server error.' });
        if (userResults.length === 0) return res.status(404).json({ error: 'No account found with this email.' });

        const userId = userResults[0].id;

        // 2. Delete the old OTP so there's only one active at a time
        const deleteOldSql = "DELETE FROM otp_verifications WHERE user_id = ?";
        db.query(deleteOldSql, [userId], (deleteErr) => {
            if (deleteErr) return res.status(500).json({ error: 'Failed to reset verification code.' });

            // 3. Generate a fresh 6-digit OTP with a new 15-minute expiry
            const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

            // 4. Insert the new OTP into the verifications table
            const insertOtpSql = "INSERT INTO otp_verifications (user_id, otp_code, expires_at) VALUES (?, ?, ?)";
            db.query(insertOtpSql, [userId, newOtp, expiresAt], (insertErr) => {
                if (insertErr) return res.status(500).json({ error: 'Failed to generate new verification code.' });

                // 5. Send the new OTP to the user's email via Brevo
                sendOtpEmail(email, newOtp);

                res.status(200).json({ success: true, message: 'A new verification code has been sent to your email.' });
            });
        });
    });
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
  uploadStageFile
);

app.get("/api/projects/files/:stage_id", (req, res) => {
  db.query(
    "SELECT * FROM stage_files WHERE stage_id = ? ORDER BY uploaded_at DESC",
    [req.params.stage_id],
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: results });
    }
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
    }
  );
});

app.get("/api/admin/recent-logins", (req, res) => {
  const query = `
    SELECT 
      name as username, 
      role, 
      DATE_FORMAT(CONVERT_TZ(last_login, '+00:00', '+05:30'), '%b %d, %h:%i %p') as time 
    FROM users 
    WHERE last_login IS NOT NULL 
    ORDER BY last_login DESC 
    LIMIT 5`;

  db.query(query, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
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
    }
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

const dashboardRoutes = require("./src/routes/dashboardRoutes");
app.use("/api/dashboard", dashboardRoutes);

const marksRoutes = require("./src/routes/marksRoutes");
app.use("/api/marks", marksRoutes);

// Backup Schedule Routes
const backupRoutes = require("./src/routes/backupRoutes");
app.use("/api/backups", backupRoutes);

const mentorRoutes = require("./src/routes/mentorRoutes");
app.use("/api/mentor", mentorRoutes);

// --- 7. Server Initialization ---
app.get("/", (req, res) => res.send("Edusync Backend is running!"));

app.use((err, req, res, next) => {
  console.error("❌ Global Error Handler:", err);
  res.status(500).json({ success: false, error: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));