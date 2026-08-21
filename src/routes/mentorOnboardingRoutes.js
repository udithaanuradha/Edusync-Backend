const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { sendMentorInviteEmail } = require('../config/emailConfig');
const { validatePassword } = require('../utils/validators');

// 1. PREVIEW EXCEL DETAILS WITH ACTIVE GROUPS FOR SPECIFIC LEVEL
router.post('/preview-upload', (req, res) => {
  const { mentors, level } = req.body;
  const targetLevel = level || 1;

  if (!mentors || !Array.isArray(mentors)) {
    return res.status(400).json({ error: "Invalid data format provided." });
  }

  const query = `
    SELECT id, group_name 
    FROM project_groups 
    WHERE level = ?
  `;

  db.query(query, [targetLevel], (err, groups) => {
    if (err) {
      console.error("Error fetching project groups:", err);
      return res.status(500).json({ error: "Database error fetching active groups." });
    }

    const verifiedMentors = (mentors || []).map(m => {
      const matchedGroup = (groups || []).find(g => 
        (m.groupNo && String(g.id) === String(m.groupNo)) || 
        (g.group_name && m.groupName && String(g.group_name).toLowerCase().trim() === String(m.groupName).toLowerCase().trim())
      );

      return {
        ...m,
        groupId: matchedGroup ? matchedGroup.id : null,
        groupMatched: !!matchedGroup
      };
    });

    res.status(200).json({ success: true, data: verifiedMentors });
  });
});

// 2. BULK SEND INVITES VIA SMTP RELAY
router.post('/send-invites', async (req, res) => {
  const { mentors, academicUnit, level } = req.body; 

  if (!mentors || mentors.length === 0) {
    return res.status(400).json({ error: "No mentors selected for invitation." });
  }

  try {
    const frontendDomain = process.env.FRONTEND_URL || 'http://localhost:5173';

    const emailPromises = mentors.map(mentor => {
      // Include phone and full name from CSV inside payload
      const payload = Buffer.from(JSON.stringify({
        email: mentor.email,
        name: mentor.name,
        phone: mentor.phone || null,
        groupId: mentor.groupId,
        academicUnit: academicUnit || 'ITM',
        level: level || 1 
      })).toString('base64');

      const setupUrl = `${frontendDomain}/mentor-setup/${payload}`;
      return sendMentorInviteEmail(mentor.email, mentor.name, mentor.groupName, setupUrl);
    });

    await Promise.all(emailPromises);
    res.status(200).json({ success: true, message: "All invitation emails dispatched successfully!" });

  } catch (error) {
    console.error("Error sending emails through SMTP Relay:", error.message);
    res.status(500).json({ error: "Failed to broadcast some onboarding emails." });
  }
});

// 3. FIRST TIME PASSWORD SETTINGS & DB INSERTION / UPDATE
router.post('/finalize-setup', (req, res) => {
  const { token, username, password } = req.body;

  if (!token || !username || !password) {
    return res.status(400).json({ error: "All account setup fields are required." });
  }

  if (!validatePassword(password)) {
    return res.status(400).json({ error: "Password must be at least 8 characters and include uppercase, lowercase, number, and special character." });
  }

  try {
    const rawData = Buffer.from(token, 'base64').toString('utf-8');
    const { email, name, phone, groupId, academicUnit, level } = JSON.parse(rawData);
    const targetLevel = level || 1;
    const targetGroupId = groupId ? Number(groupId) : null;
    const mentorFullName = (name && name.trim()) ? name.trim() : username;

    db.query("SELECT id FROM users WHERE email = ?", [email], (err, users) => {
      if (err) return res.status(500).json({ error: "Database error during duplicate checks." });

      const handleGroupLink = (userId) => {
        if (targetGroupId) {
          db.query("UPDATE project_groups SET mentor_id = ? WHERE id = ?", [userId, targetGroupId], (updateErr) => {
            if (updateErr) console.error("Warning: Could not link mentor_id in project_groups:", updateErr);
            return res.status(200).json({ success: true, message: "Account setup complete!" });
          });
        } else {
          return res.status(200).json({ success: true, message: "Account setup complete!" });
        }
      };

      if (users.length > 0) {
        // Update existing mentor record and ensure is_verified = 1
        const userId = users[0].id;
        const updateSql = `UPDATE users SET name = ?, password = ?, is_verified = 1 WHERE id = ?`;
        db.query(updateSql, [mentorFullName, password, userId], (updateErr) => {
          if (updateErr) return res.status(500).json({ error: "Failed to update mentor profile." });
          handleGroupLink(userId);
        });
      } else {
        // Insert new mentor with is_verified = 1
        const insertUserSql = `
          INSERT INTO users (name, email, phone, password, role, academic_unit, level, designation, is_verified) 
          VALUES (?, ?, ?, ?, 'mentor', ?, ?, NULL, 1)
        `;
        db.query(insertUserSql, [mentorFullName, email, phone || null, password, academicUnit || 'ITM', targetLevel], (insertErr, insertResult) => {
          if (insertErr) {
            console.error("❌ Error creating mentor user in DB:", insertErr);
            return res.status(500).json({ error: "Failed to create user profile in database." });
          }
          handleGroupLink(insertResult.insertId);
        });
      }
    });

  } catch (e) {
    res.status(400).json({ error: "Invalid or expired setup token link." });
  }
});

// 4. DELETE MENTOR (CRUD OPERATION WITH AUTOMATIC UNASSIGNMENT)
const deleteMentorHandler = (req, res) => {
  const mentorId = req.params.id;

  // Step A: Set mentor_id to NULL in project_groups so no orphan IDs remain
  const unassignSql = `UPDATE project_groups SET mentor_id = NULL WHERE mentor_id = ?`;

  db.query(unassignSql, [mentorId], (err) => {
    if (err) {
      console.error("Error unassigning mentor from project groups:", err);
      return res.status(500).json({ error: "Failed to update project group assignments." });
    }

    // Step B: Safely delete the mentor user from users table
    const deleteSql = `DELETE FROM users WHERE id = ? AND role = 'mentor'`;
    db.query(deleteSql, [mentorId], (err, result) => {
      if (err) {
        console.error("Error deleting mentor:", err);
        return res.status(500).json({ error: "Failed to delete mentor from database." });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Mentor not found." });
      }

      res.status(200).json({ success: true, message: "Mentor deleted and group assignment cleared successfully." });
    });
  });
};

router.delete('/mentors/:id', deleteMentorHandler);
router.delete('/:id', deleteMentorHandler);

module.exports = router;