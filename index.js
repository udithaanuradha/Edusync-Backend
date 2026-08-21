const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const path = require("path");
const bcrypt = require("bcryptjs");
require("dotenv").config();
const { validateUserCreation, validatePassword } = require("./src/utils/validators");
const { sendOtpEmail, sendPasswordResetLinkEmail } = require("./src/config/emailConfig");
const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Validation Helper ---
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
const normalizeUserForClient = (user) => {
  if (!user || typeof user !== 'object') {
    return user;
  }

  const normalizedRole = user.role === 'industry mentor' ? 'mentor' : user.role;
  const normalizedDesignation = typeof user.designation === 'string'
    ? user.designation.trim().toLowerCase()
    : null;

  // Coordinator accounts are stored as lecturer + designation='coordinator'.
  // Keep the real designation for routing decisions instead of dropping it.
  const safeUser = { ...user, role: normalizedRole, designation: normalizedDesignation || null };

  if (normalizedRole === 'lecturer' && normalizedDesignation === 'coordinator') {
    safeUser.effectiveRole = 'coordinator';
  } else if (normalizedRole === 'lecturer' && normalizedDesignation === 'supervisor') {
    safeUser.effectiveRole = 'supervisor';
  } else {
    safeUser.effectiveRole = normalizedRole;
  }

  return safeUser;
};

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  const cleanEmail = email.trim().toLowerCase();

  db.query(
    "SELECT id, name, email, password, role, designation, level, academic_unit, is_verified FROM users WHERE LOWER(TRIM(email)) = ?",
    [cleanEmail],
    async (err, results) => {
      if (err) return res.status(500).json({ error: "Internal server error" });
      if (!results.length)
        return res.status(401).json({ error: "Invalid credentials" });

      const rawUser = results[0];
      const dbPassword = rawUser.password || '';

      // Hybrid Password Check:
      // 1. If hashed with bcrypt ($2a$, $2b$, $2y$), use bcrypt.compare
      // 2. If legacy plain-text password, compare directly
      const isHashed = dbPassword.startsWith('$2a$') || dbPassword.startsWith('$2b$') || dbPassword.startsWith('$2y$');
      let isMatch = false;

      if (isHashed) {
        try {
          isMatch = await bcrypt.compare(password, dbPassword);
        } catch (compErr) {
          console.error("Bcrypt compare error:", compErr);
          isMatch = false;
        }
      } else {
        isMatch = (password === dbPassword);
      }

      if (!isMatch) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // If user's password in DB was unencrypted plain-text, automatically hash and update it now
      if (!isHashed) {
        try {
          const saltRounds = 10;
          const newHash = await bcrypt.hash(password, saltRounds);
          db.query("UPDATE users SET password = ? WHERE id = ?", [newHash, rawUser.id], (upHashErr) => {
            if (upHashErr) console.error("❌ Failed to auto-encrypt user password:", upHashErr);
            else console.log(`🔒 Auto-encrypted password in database for: ${rawUser.email} (${rawUser.role})`);
          });
        } catch (autoHashErr) {
          console.error("Auto-hash error on login:", autoHashErr);
        }
      }

      const user = normalizeUserForClient(rawUser);
      delete user.password; // Never expose password hash to frontend

      if (!user.is_verified) {
        return res.status(403).json({ error: "Please verify your email before logging in" });
      }
      delete user.is_verified;
      db.query(
        "UPDATE users SET last_login = NOW() WHERE id = ?",
        [user.id],
        (updateErr) => {
          if (updateErr) console.error("❌ Failed to update login timestamp");
          res.status(200).json({ message: "Login successful", user });
        }
      );
    }
  );
});

app.post('/api/signup', async (req, res) => {
  // Expect frontend to send firstName and lastName individually
  let { firstName, lastName, email, password, role, university_id, phone, academic_unit } = req.body;

  // Basic backend-side validation using central validator
  const validationResult = validateUserCreation({ firstName, lastName, email, phone, password, role, universityId: university_id, department: academic_unit });
  if (!validationResult.valid) {
    return res.status(400).json({ error: 'Validation failed', details: validationResult.errors, message: validationResult.errors[0] });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanUniId = university_id ? university_id.trim().toUpperCase() : null;

  // Check 1: Duplicate Email Check
  db.query("SELECT id FROM users WHERE LOWER(TRIM(email)) = ?", [cleanEmail], (emailErr, emailRows) => {
    if (emailErr) return res.status(500).json({ error: emailErr.message });
    if (emailRows.length > 0) {
      return res.status(400).json({ error: 'This email address is already registered. Please login or use a different email.' });
    }

    // Check 2: Duplicate University ID Check (for students)
    if (role === 'student' && cleanUniId) {
      db.query("SELECT id FROM users WHERE UPPER(TRIM(university_id)) = ?", [cleanUniId], (uniErr, uniRows) => {
        if (uniErr) return res.status(500).json({ error: uniErr.message });
        if (uniRows.length > 0) {
          return res.status(400).json({ error: 'This University ID is already registered. Please login or check your ID.' });
        }

        proceedWithUserInsert();
      });
    } else {
      proceedWithUserInsert();
    }
  });

  async function proceedWithUserInsert() {
    try {
      const name = `${firstName.trim()} ${lastName.trim()}`.trim();
      const levelValue = role === 'student' ? 1 : null;
      const designationValue = role === 'lecturer' ? 'supervisor' : null;

      // Hash password using bcrypt for newly registering users
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      const userSql = "INSERT INTO users (name, email, password, role, university_id, phone, academic_unit, level, designation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";

      db.query(userSql, [name, cleanEmail, hashedPassword, role, cleanUniId, phone || null, academic_unit || null, levelValue, designationValue], async (err, result) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY' || err.message.includes('Duplicate')) {
            if (err.message.includes('email') || err.message.includes('key 2') || err.message.includes('users.email')) {
              return res.status(400).json({ error: 'This email address is already registered. Please login or use a different email.' });
            }
            if (err.message.includes('university_id') || err.message.includes('users.university_id')) {
              return res.status(400).json({ error: 'This University ID is already registered. Please login or check your ID.' });
            }
            return res.status(400).json({ error: 'Account with these details already exists. Please login instead.' });
          }
          return res.status(500).json({ error: err.message });
        }

        const newUserId = result.insertId; 
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString(); 
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); 

        // Insert into otp_verifications table
        const otpSql = "INSERT INTO otp_verifications (user_id, otp_code, expires_at) VALUES (?, ?, ?)";
        db.query(otpSql, [newUserId, otpCode, expiresAt], async (otpErr, otpResult) => {
          if (otpErr) return res.status(500).json({ error: otpErr.message });

          try {
            console.log(`📧 Sending OTP to ${cleanEmail}`);
            await sendOtpEmail(cleanEmail, otpCode);
            console.log(`✅ OTP email sent to ${cleanEmail}`);
            return res.status(200).json({ success: true, message: "User registered. OTP sent!" });
          } catch (mailErr) {
            console.error('❌ Failed to send OTP email:', mailErr);
            return res.status(500).json({ error: 'User created but OTP email could not be sent.', details: mailErr.message });
          }
        });
      });
    } catch (hashErr) {
      console.error("Error hashing password during signup:", hashErr);
      return res.status(500).json({ error: "Failed to process security credentials." });
    }
  }
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
                // Record the verification, then clear out the used OTP row(s).
                db.query("UPDATE users SET is_verified = TRUE WHERE id = ?", [userId], (updateErr) => {
                    if (updateErr) return res.status(500).json({ error: "Failed to update verification status." });

                    db.query("DELETE FROM otp_verifications WHERE user_id = ?", [userId], (deleteErr) => {
                        if (deleteErr) console.error("❌ Failed to delete used OTP row(s):", deleteErr);
                        res.status(200).json({ success: true, message: "Account successfully verified! You can now log in." });
                    });
                });
            } else {
                res.status(400).json({ error: "Invalid or expired OTP code." });
            }
        });
    });
});

// --- Resend OTP Route ---
// Generates a fresh OTP for an already-registered user and resends it via email
app.post('/api/resend-otp', (req, res) => {
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
            db.query(insertOtpSql, [userId, newOtp, expiresAt], async (insertErr) => {
                if (insertErr) return res.status(500).json({ error: 'Failed to generate new verification code.' });

                // 5. Send the new OTP to the user's email via Brevo
                try {
                    console.log(`📧 Resending OTP to ${email}`);
                    await sendOtpEmail(email, newOtp);
                    console.log(`✅ OTP resent to ${email}`);
                    return res.status(200).json({ success: true, message: 'A new verification code has been sent to your email.' });
                } catch (mailErr) {
                    console.error('❌ Failed to resend OTP email:', mailErr);
                    return res.status(500).json({ error: 'OTP was generated but could not be delivered to your email.', details: mailErr.message });
                }
            });
        });
    });
});

// --- Forgot Password: Step 1 (Send Reset Link via Email) ---
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.trim()) {
    return res.status(400).json({ error: "Email address is required." });
  }

  const cleanEmail = email.trim().toLowerCase();

  db.query("SELECT id, name, email FROM users WHERE LOWER(TRIM(email)) = ?", [cleanEmail], async (err, users) => {
    if (err) return res.status(500).json({ error: "Internal server error during account lookup." });
    if (users.length === 0) {
      return res.status(404).json({ error: "No EduSync account found with this email address." });
    }

    const user = users[0];
    const frontendDomain = process.env.FRONTEND_URL || 'http://localhost:5173';
    
    // Create base64 encoded token with 15-minute expiration
    const payload = Buffer.from(JSON.stringify({
      userId: user.id,
      email: user.email,
      expiresAt: Date.now() + 15 * 60 * 1000 // 15 mins
    })).toString('base64');

    const resetUrl = `${frontendDomain}/reset-password/${payload}`;

    try {
      console.log(`📧 Sending password reset link to ${cleanEmail}`);
      await sendPasswordResetLinkEmail(cleanEmail, user.name, resetUrl);
      console.log(`✅ Password reset link email sent to ${cleanEmail}`);
      return res.status(200).json({ success: true, message: "A password reset link has been sent to your email address. Please check your inbox and click the link to reset your password." });
    } catch (mailErr) {
      console.error("❌ Failed to send password reset email:", mailErr);
      return res.status(500).json({ error: "Failed to send reset email. Please try again later.", details: mailErr.message });
    }
  });
});

// --- Forgot Password: Step 2 (Reset Password with Token) ---
app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: "Reset token and new password are required." });
  }

  // Validate password strength
  if (!validatePassword(newPassword)) {
    return res.status(400).json({ error: "Password must be at least 8 characters and include uppercase, lowercase, number, and special character." });
  }

  try {
    const rawData = Buffer.from(token, 'base64').toString('utf-8');
    const { userId, email, expiresAt } = JSON.parse(rawData);

    if (!userId || !email) {
      return res.status(400).json({ error: "Invalid password reset link." });
    }

    if (Date.now() > expiresAt) {
      return res.status(400).json({ error: "This password reset link has expired (15-minute validity limit). Please request a new link from the login page." });
    }

    db.query("SELECT id FROM users WHERE id = ? AND LOWER(TRIM(email)) = ?", [userId, email.trim().toLowerCase()], async (err, users) => {
      if (err) return res.status(500).json({ error: "Database error during account verification." });
      if (users.length === 0) {
        return res.status(404).json({ error: "User account not found." });
      }

      try {
        // Hash the new password with bcrypt
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

        // Update password and ensure account is verified
        const updateSql = "UPDATE users SET password = ?, is_verified = 1 WHERE id = ?";
        db.query(updateSql, [hashedPassword, userId], (upErr) => {
          if (upErr) return res.status(500).json({ error: "Failed to update password in database." });
          return res.status(200).json({ success: true, message: "Your password has been successfully reset! You can now log in." });
        });
      } catch (hashErr) {
        console.error("Error hashing new password:", hashErr);
        return res.status(500).json({ error: "Failed to securely process new password." });
      }
    });

  } catch (parseErr) {
    return res.status(400).json({ error: "Invalid or corrupt password reset link." });
  }
});

// --- 4. Project & File Management ---
const { uploadStageFile } = require("./src/controllers/projectController");

app.post(
  "/api/projects/upload-file",
  (req, res, next) => {
    console.log('📥 /api/projects/upload-file hit');
    upload.single("file")(req, res, (err) => {
      if (err) {
        console.error("❌ Upload Middleware Error:", err);
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
      (SELECT COUNT(*) FROM users WHERE role = 'coordinator' OR designation = 'coordinator') as totalCoordinators,
      (SELECT COUNT(*) FROM users WHERE role = 'supervisor' OR designation = 'supervisor' OR (role = 'lecturer' AND (designation IS NULL OR designation != 'coordinator'))) as totalSupervisors,
      (SELECT COUNT(*) FROM users WHERE role = 'supervisor' OR role = 'coordinator' OR role = 'lecturer') as totalLecturers,
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

const mentorGroupRoutes = require("./src/routes/mentorGroupRoutes");
app.use("/api/groups", mentorGroupRoutes);

const groupRoutes = require("./src/routes/groupRoutes");
app.use("/api/groups", groupRoutes);

const groupDetailsToSupervisorDashboardRoutes = require("./src/routes/groupDetailsToSupervisorDashboardRoutes");
app.use("/api/groupdetailstosupervisordashboard", groupDetailsToSupervisorDashboardRoutes);

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

const meetingRequestRoutes = require("./src/routes/meetingRequestRoutes");
app.use("/api/meeting-requests", meetingRequestRoutes);

const submissionRoutes = require("./src/routes/submissionRoutes");
app.use("/api/submissions", submissionRoutes);

// Milestones & Tasks (Combined from HEAD)
const milestoneRoutes = require("./src/routes/milestoneRoutes");
app.use("/api/milestones", milestoneRoutes);

// Dashboard & Marks (Combined from develop)
const dashboardRoutes = require("./src/routes/dashboardRoutes");
app.use("/api/dashboard", dashboardRoutes);

const marksRoutes = require("./src/routes/marksRoutes");
app.use("/api/marks", marksRoutes);

const evaluationPanelRoutes = require("./src/routes/evaluationPanelRoutes");
app.use("/api/evaluation-panels", evaluationPanelRoutes);

// Backup Schedule Routes
const backupRoutes = require("./src/routes/backupRoutes");
app.use("/api/backups", backupRoutes);

const mentorRoutes = require("./src/routes/mentorRoutes");
app.use("/api/mentor", mentorRoutes); 

const mentorOnboardingRoutes = require("./src/routes/mentorOnboardingRoutes");
app.use("/api/admin/mentors", mentorOnboardingRoutes);
app.use("/api/mentor-onboarding", mentorOnboardingRoutes);

// --- 7. Server Initialization & Socket.IO V2 ---
app.get("/", (req, res) => res.send("Edusync Backend is running!"));

// V2 Real-time Chat Routes
const messageV2Routes = require("./src/routes/messageV2Routes");
app.use("/api/v2/messages", messageV2Routes);

app.use((err, req, res, next) => {
  console.error("Global Error Handler:", err);
  res.status(500).json({ success: false, error: err.message || "Internal server error" });
});

const http = require("http");
const server = http.createServer(app);

try {
  const { setupSocketV2 } = require("./src/sockets/socketV2");
  setupSocketV2(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PATCH"],
      credentials: true,
    }
  });
  console.log("⚡ Socket.IO V2 Server initialized!");
} catch (socketErr) {
  console.warn("⚠️ Socket.IO V2 setup warning:", socketErr.message);
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
