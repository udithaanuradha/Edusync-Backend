const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { sendMentorInviteEmail } = require('../config/emailConfig');
const { validatePassword } = require('../utils/validators');

// 1. PREVIEW EXCEL DETAILS WITH ACTIVE GROUPS FOR SPECIFIC LEVEL
router.post('/preview-upload', (req, res) => {
  const { mentors, level } = req.body;
  const targetLevel = Number(level) || 1;

  if (!mentors || !Array.isArray(mentors) || mentors.length === 0) {
    return res.status(400).json({ success: false, error: "No valid mentor rows found in the uploaded file." });
  }

  const query = `
    SELECT id, group_name 
    FROM project_groups 
    WHERE level = ?
  `;

  db.query(query, [targetLevel], (err, groups) => {
    if (err) {
      console.error("Error fetching project groups:", err);
      return res.status(500).json({ success: false, error: "Database error fetching active groups." });
    }

    if (!groups || groups.length === 0) {
      return res.status(400).json({
        success: false,
        error: `No registered project groups found for Level ${targetLevel}. Please register project groups first.`
      });
    }

    const verifiedMentors = (mentors || []).map(m => {
      const matchedGroup = (groups || []).find(g => 
        (m.groupNo && String(g.id) === String(m.groupNo).trim()) || 
        (g.group_name && m.groupName && String(g.group_name).toLowerCase().trim() === String(m.groupName).toLowerCase().trim())
      );

      const hasValidDetails = Boolean(m.name && m.name.trim() && m.email && m.email.trim());

      return {
        ...m,
        groupId: matchedGroup ? matchedGroup.id : null,
        groupMatched: !!matchedGroup && hasValidDetails
      };
    });

    // Check which registered level groups have been matched
    const matchedGroupIds = new Set(
      verifiedMentors
        .filter(m => m.groupMatched && m.groupId)
        .map(m => m.groupId)
    );

    const missingGroups = groups.filter(g => !matchedGroupIds.has(g.id));
    const hasUnmatchedRows = verifiedMentors.some(m => !m.groupMatched);
    const allGroupsCovered = (missingGroups.length === 0) && (!hasUnmatchedRows) && (groups.length > 0);

    res.status(200).json({
      success: true,
      allGroupsCovered,
      totalLevelGroups: groups.length,
      matchedCount: matchedGroupIds.size,
      missingGroups: missingGroups.map(g => g.group_name),
      data: verifiedMentors,
      unfilledGroups: missingGroups.map(g => ({
        id: g.id,
        groupName: g.group_name,
        status: 'Unfilled in CSV'
      }))
    });
  });
});

// 2. BULK SEND INVITES VIA SMTP RELAY
router.post('/send-invites', async (req, res) => {
  const { mentors, academicUnit, level } = req.body; 
  const targetLevel = Number(level) || 1;

  if (!mentors || !Array.isArray(mentors) || mentors.length === 0) {
    return res.status(400).json({ error: "No mentors selected for invitation." });
  }

  // Strict backend validation: Ensure all registered groups for this level are present and filled
  const query = `
    SELECT id, group_name 
    FROM project_groups 
    WHERE level = ?
  `;

  db.query(query, [targetLevel], async (err, groups) => {
    if (err) {
      console.error("Database error in send-invites:", err);
      return res.status(500).json({ error: "Database error verifying project groups." });
    }

    if (!groups || groups.length === 0) {
      return res.status(400).json({ error: `No registered project groups exist for Level ${targetLevel}.` });
    }

    const matchedGroupIds = new Set(
      mentors
        .filter(m => m.groupId && m.name && m.name.trim() && m.email && m.email.trim())
        .map(m => Number(m.groupId))
    );

    const missingGroups = groups.filter(g => !matchedGroupIds.has(Number(g.id)));

    if (missingGroups.length > 0) {
      return res.status(400).json({
        error: `Cannot broadcast invites. All ${groups.length} registered groups in Level ${targetLevel} must have mentor details filled in the CSV file. Missing group(s): ${missingGroups.map(g => g.group_name).join(', ')}`
      });
    }

    try {
      const frontendDomain = process.env.FRONTEND_URL || 'http://localhost:5173';

      const emailPromises = mentors.map(mentor => {
        // Include phone and full name from CSV inside payload
        const payload = Buffer.from(JSON.stringify({
          email: mentor.email.trim(),
          name: mentor.name.trim(),
          phone: mentor.phone || null,
          groupId: mentor.groupId,
          academicUnit: academicUnit || 'ITM',
          level: targetLevel 
        })).toString('base64');

        const setupUrl = `${frontendDomain}/mentor-setup/${payload}`;
        return sendMentorInviteEmail(mentor.email.trim(), mentor.name.trim(), mentor.groupName, setupUrl);
      });

      await Promise.all(emailPromises);
      res.status(200).json({ success: true, message: "All invitation emails dispatched successfully!" });

    } catch (error) {
      console.error("Error sending emails through SMTP Relay:", error.message);
      res.status(500).json({ error: "Failed to broadcast some onboarding emails." });
    }
  });
});

// 3. FIRST TIME PASSWORD SETTINGS & DB INSERTION / UPDATE
router.post('/finalize-setup', async (req, res) => {
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

    // Hash password with bcrypt
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    db.query("SELECT id FROM users WHERE LOWER(TRIM(email)) = ?", [email.trim().toLowerCase()], (err, users) => {
      if (err) return res.status(500).json({ error: "Database error during duplicate checks." });

      const handleGroupLink = (userId) => {
        if (targetGroupId) {
          // 1. Link in multi-mentor junction table (project_group_mentors)
          db.query(
            "INSERT IGNORE INTO project_group_mentors (group_id, mentor_id) VALUES (?, ?)",
            [targetGroupId, userId],
            (junctionErr) => {
              if (junctionErr) console.warn("Warning: Could not insert into project_group_mentors:", junctionErr.message);

              // 2. Also keep project_groups.mentor_id updated as primary/fallback
              db.query("UPDATE project_groups SET mentor_id = ? WHERE id = ?", [userId, targetGroupId], (updateErr) => {
                if (updateErr) console.error("Warning: Could not link mentor_id in project_groups:", updateErr);
                return res.status(200).json({ success: true, message: "Account setup complete!" });
              });
            }
          );
        } else {
          return res.status(200).json({ success: true, message: "Account setup complete!" });
        }
      };

      if (users.length > 0) {
        // Update existing mentor record and ensure is_verified = 1
        const userId = users[0].id;
        const updateSql = `UPDATE users SET name = ?, password = ?, is_verified = 1 WHERE id = ?`;
        db.query(updateSql, [mentorFullName, hashedPassword, userId], (updateErr) => {
          if (updateErr) return res.status(500).json({ error: "Failed to update mentor profile." });
          handleGroupLink(userId);
        });
      } else {
        // Insert new mentor with is_verified = 1
        const insertUserSql = `
          INSERT INTO users (name, email, phone, password, role, academic_unit, level, designation, is_verified) 
          VALUES (?, ?, ?, ?, 'mentor', ?, ?, NULL, 1)
        `;
        db.query(insertUserSql, [mentorFullName, email.trim().toLowerCase(), phone || null, hashedPassword, academicUnit || 'ITM', targetLevel], (insertErr, insertResult) => {
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

  // Step A1: Clear from project_group_mentors junction table
  db.query(`DELETE FROM project_group_mentors WHERE mentor_id = ?`, [mentorId], (jErr) => {
    if (jErr) console.warn("Warning clearing project_group_mentors:", jErr.message);
  });

  // Step A2: Set mentor_id to NULL in project_groups so no orphan IDs remain
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

// 5. SEND CHAT REMINDER TO ALL MEMBERS OF UNFILLED PROJECT GROUP
router.post('/remind-group', (req, res) => {
  const { groupId, groupName, adminId, messageText } = req.body;

  if (!groupId) {
    return res.status(400).json({ success: false, error: "Group ID is required." });
  }

  // 1. Fetch all student members of this group
  const memberSql = `
    SELECT gm.student_id, u.name, u.email 
    FROM project_group_members gm 
    JOIN users u ON u.id = gm.student_id 
    WHERE gm.group_id = ?
  `;

  db.query(memberSql, [groupId], (err, members) => {
    if (err) {
      console.error("Error fetching group members:", err);
      return res.status(500).json({ success: false, error: "Database error fetching group members." });
    }

    if (!members || members.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No registered student members found for group "${groupName || groupId}".`
      });
    }

    // 2. Identify sender (Admin/Coordinator)
    const findAdminSql = `SELECT id FROM users WHERE role = 'admin' OR role = 'coordinator' LIMIT 1`;
    db.query(findAdminSql, [], (adminErr, adminRows) => {
      const senderId = Number(adminId) || (adminRows && adminRows.length > 0 ? adminRows[0].id : 1);
      const reminderText = messageText || 
        `📢 Reminder:  Your Group "${groupName || 'Your Group'}" has not yet submitted/filled the Industry Mentor details. Please fill in your mentor's details as soon as possible .`;

      // 3. Insert message into messages_v2 for each student member
      const values = members.map(m => [senderId, m.student_id, reminderText, false]);
      const insertSql = `INSERT INTO messages_v2 (sender_id, receiver_id, message_text, read_status) VALUES ?`;

      db.query(insertSql, [values], (insertErr) => {
        if (insertErr) {
          console.error("Error inserting reminder messages:", insertErr);
          return res.status(500).json({ success: false, error: "Failed to deliver chat reminder messages." });
        }

        res.status(200).json({
          success: true,
          message: `Chat reminder sent to all ${members.length} member(s) of "${groupName || 'the group'}".`,
          notifiedCount: members.length,
          members: members.map(m => m.name)
        });
      });
    });
  });
});

// 6. SEND CHAT REMINDER TO ALL MISSING GROUPS AT ONCE
router.post('/remind-all-missing', (req, res) => {
  const { missingGroups, adminId, messageText } = req.body;

  if (!missingGroups || !Array.isArray(missingGroups) || missingGroups.length === 0) {
    return res.status(400).json({ success: false, error: "No missing groups provided." });
  }

  const groupIds = missingGroups.map(g => (typeof g === 'object' ? g.id : g)).filter(Boolean);
  if (groupIds.length === 0) {
    return res.status(400).json({ success: false, error: "No valid group IDs provided." });
  }

  const memberSql = `
    SELECT gm.group_id, gm.student_id, pg.group_name, u.name 
    FROM project_group_members gm 
    JOIN project_groups pg ON pg.id = gm.group_id
    JOIN users u ON u.id = gm.student_id 
    WHERE gm.group_id IN (?)
  `;

  db.query(memberSql, [groupIds], (err, members) => {
    if (err) {
      console.error("Error fetching missing group members:", err);
      return res.status(500).json({ success: false, error: "Database error fetching members." });
    }

    if (!members || members.length === 0) {
      return res.status(404).json({ success: false, error: "No registered students found for the missing groups." });
    }

    const findAdminSql = `SELECT id FROM users WHERE role = 'admin' OR role = 'coordinator' LIMIT 1`;
    db.query(findAdminSql, [], (adminErr, adminRows) => {
      const senderId = Number(adminId) || (adminRows && adminRows.length > 0 ? adminRows[0].id : 1);

      const values = members.map(m => {
        const text = messageText || `📢 Reminder:  Your Group "${m.group_name}" has not yet submitted/filled the Industry Mentor details. Please fill in your mentor's details as soon as possible .`;
        return [senderId, m.student_id, text, false];
      });

      const insertSql = `INSERT INTO messages_v2 (sender_id, receiver_id, message_text, read_status) VALUES ?`;
      db.query(insertSql, [values], (insertErr) => {
        if (insertErr) {
          console.error("Error inserting bulk reminders:", insertErr);
          return res.status(500).json({ success: false, error: "Failed to deliver chat reminders." });
        }

        res.status(200).json({
          success: true,
          message: `Reminders successfully sent to ${members.length} members across ${groupIds.length} group(s)!`,
          notifiedCount: members.length
        });
      });
    });
  });
});

module.exports = router;