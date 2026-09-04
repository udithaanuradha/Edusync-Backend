const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { sendMentorInviteEmail, sendMentorOffboardingAppreciationEmail } = require('../config/emailConfig');
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

    const groupIds = groups.map(g => g.id);

    // Fetch all mentors currently assigned to these groups across junction table + legacy column
    const mentorQuery = `
      SELECT pgm.group_id, u.id AS mentor_id, u.name AS mentor_name, u.email AS mentor_email, u.is_verified
      FROM project_group_mentors pgm
      JOIN users u ON u.id = pgm.mentor_id
      WHERE pgm.group_id IN (?)
      UNION
      SELECT pg.id AS group_id, u.id AS mentor_id, u.name AS mentor_name, u.email AS mentor_email, u.is_verified
      FROM project_groups pg
      JOIN users u ON u.id = pg.mentor_id
      WHERE pg.id IN (?) AND pg.mentor_id IS NOT NULL
    `;

    db.query(mentorQuery, [groupIds, groupIds], (mentorErr, assignedMentors) => {
      const assignedList = assignedMentors || [];

      const verifiedMentors = (mentors || []).map(m => {
        const matchedGroup = (groups || []).find(g => 
          (m.groupNo && String(g.id) === String(m.groupNo).trim()) || 
          (g.group_name && m.groupName && String(g.group_name).toLowerCase().trim() === String(m.groupName).toLowerCase().trim())
        );

        const hasValidDetails = Boolean(m.name && m.name.trim() && m.email && m.email.trim());
        const targetGroupId = matchedGroup ? matchedGroup.id : null;

        // Check if THIS EXACT mentor email is already assigned to THIS group in DB
        const isAlreadyAssigned = Boolean(
          targetGroupId &&
          hasValidDetails &&
          assignedList.some(assigned => 
            Number(assigned.group_id) === Number(targetGroupId) &&
            String(assigned.mentor_email || '').toLowerCase().trim() === String(m.email).toLowerCase().trim() &&
            Number(assigned.is_verified) === 1
          )
        );

        return {
          ...m,
          groupId: targetGroupId,
          groupMatched: !!matchedGroup && hasValidDetails,
          isAlreadyAssigned: isAlreadyAssigned
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

      const newMentorsCount = verifiedMentors.filter(m => m.groupMatched && !m.isAlreadyAssigned).length;
      const existingMentorsCount = verifiedMentors.filter(m => m.groupMatched && m.isAlreadyAssigned).length;

      res.status(200).json({
        success: true,
        allGroupsCovered,
        totalLevelGroups: groups.length,
        matchedCount: matchedGroupIds.size,
        newMentorsCount,
        existingMentorsCount,
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
});

// 2. BULK SEND INVITES VIA SMTP RELAY (WITH SMART DUPLICATE SKIP)
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

    const validMentors = (mentors || []).filter(
      m => m.groupId && m.name && m.name.trim() && m.email && m.email.trim() && m.email.trim().toLowerCase() !== 'pending submission'
    );

    if (validMentors.length === 0) {
      return res.status(400).json({ error: "No filled mentor records found in the provided list to dispatch invitations." });
    }

    const matchedGroupIds = new Set(validMentors.map(m => Number(m.groupId)));
    const missingGroups = groups.filter(g => !matchedGroupIds.has(Number(g.id)));

    try {
      // Filter out mentors who already have active accounts
      const mentorsToSend = validMentors.filter(m => !m.isAlreadyAssigned);
      const skippedCount = validMentors.length - mentorsToSend.length;

      if (mentorsToSend.length === 0) {
        return res.status(200).json({ 
          success: true, 
          newlySentCount: 0,
          skippedCount: validMentors.length,
          message: "All filled mentors in this CSV are already assigned and active! No new emails needed." 
        });
      }

      const frontendDomain = process.env.FRONTEND_URL || 'http://localhost:5173';

      const emailPromises = mentorsToSend.map(mentor => {
        // Include phone, company and full name from CSV inside payload
        const payload = Buffer.from(JSON.stringify({
          email: mentor.email.trim(),
          name: mentor.name.trim(),
          phone: mentor.phone || null,
          company: mentor.company || null,
          groupId: mentor.groupId,
          academicUnit: academicUnit || 'ITM',
          level: targetLevel 
        })).toString('base64');

        const setupUrl = `${frontendDomain}/mentor-setup/${payload}`;
        return sendMentorInviteEmail(mentor.email.trim(), mentor.name.trim(), mentor.groupName, setupUrl);
      });

      await Promise.all(emailPromises);

      let successMsg = `Invitations dispatched to ${mentorsToSend.length} mentor(s)!`;
      if (skippedCount > 0) {
        successMsg += ` (${skippedCount} active mentors skipped).`;
      }
      if (missingGroups.length > 0) {
        successMsg += ` Notice: ${missingGroups.length} group(s) pending details (${missingGroups.map(g => g.group_name).join(', ')}).`;
      }

      res.status(200).json({ 
        success: true, 
        newlySentCount: mentorsToSend.length,
        skippedCount: skippedCount,
        pendingGroupsCount: missingGroups.length,
        message: successMsg
      });

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
    const { email, name, phone, company, groupId, academicUnit, level } = JSON.parse(rawData);
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
          // 1. Link in multi-mentor junction table (project_group_mentors) with company
          db.query(
            "INSERT INTO project_group_mentors (group_id, mentor_id, company) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE company = VALUES(company)",
            [targetGroupId, userId, company || null],
            (junctionErr) => {
              if (junctionErr) {
                // Fallback if company column is not yet added to project_group_mentors
                db.query(
                  "INSERT IGNORE INTO project_group_mentors (group_id, mentor_id) VALUES (?, ?)",
                  [targetGroupId, userId],
                  (fbErr) => {
                    if (fbErr) console.warn("Warning inserting into project_group_mentors:", fbErr.message);
                  }
                );
              }

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
        // Insert new mentor with standard user fields (leaving other roles untouched)
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

    // Step A2: Update project_groups.mentor_id to any remaining mentor (or NULL if none left)
    const syncSql = `
      UPDATE project_groups pg
      SET pg.mentor_id = (
        SELECT pgm.mentor_id 
        FROM project_group_mentors pgm 
        WHERE pgm.group_id = pg.id 
        ORDER BY pgm.id ASC 
        LIMIT 1
      )
      WHERE pg.mentor_id = ?;
    `;

    db.query(syncSql, [mentorId], (err) => {
      if (err) {
        console.error("Error unassigning mentor from project groups:", err);
        return res.status(500).json({ error: "Failed to update project group assignments." });
      }

      // Step B: Safely delete the mentor user from users table
      const deleteSql = `DELETE FROM users WHERE id = ? AND role = 'mentor'`;
      db.query(deleteSql, [mentorId], (delErr, result) => {
        if (delErr) {
          console.error("Error deleting mentor:", delErr);
          return res.status(500).json({ error: "Failed to delete mentor from database." });
        }

        if (result.affectedRows === 0) {
          return res.status(404).json({ error: "Mentor not found." });
        }

        res.status(200).json({ success: true, message: "Mentor deleted and group assignment cleared successfully." });
      });
    });
  });
};

router.delete('/mentors/:id', deleteMentorHandler);
router.delete('/:id', deleteMentorHandler);

// 5. SEND CHAT REMINDER TO LEADER OF UNFILLED PROJECT GROUP
router.post('/remind-group', (req, res) => {
  const { groupId, groupName, adminId, messageText } = req.body;

  if (!groupId) {
    return res.status(400).json({ success: false, error: "Group ID is required." });
  }

  // 1. Fetch group members with is_leader flag prioritized
  const memberSql = `
    SELECT gm.student_id, u.name, u.email, gm.is_leader 
    FROM project_group_members gm 
    JOIN users u ON u.id = gm.student_id 
    WHERE gm.group_id = ?
    ORDER BY gm.is_leader DESC, gm.id ASC
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

    // Pick only the Leader (or the first member if no leader flag is set)
    const leader = members.find(m => Number(m.is_leader) === 1) || members[0];

    // 2. Identify sender (Admin/Coordinator)
    const findAdminSql = `SELECT id FROM users WHERE role = 'admin' OR role = 'coordinator' LIMIT 1`;
    db.query(findAdminSql, [], (adminErr, adminRows) => {
      const senderId = Number(adminId) || (adminRows && adminRows.length > 0 ? adminRows[0].id : 1);
      const reminderText = messageText || 
        `📢 Reminder:  Your Group "${groupName || 'Your Group'}" has not yet submitted/filled the Industry Mentor details. Please fill in your mentor's details as soon as possible .`;

      // 3. Insert message into messages_v2 ONLY for the group leader
      const insertSql = `INSERT INTO messages_v2 (sender_id, receiver_id, message_text, read_status) VALUES (?, ?, ?, ?)`;

      db.query(insertSql, [senderId, leader.student_id, reminderText, false], (insertErr) => {
        if (insertErr) {
          console.error("Error inserting reminder message:", insertErr);
          return res.status(500).json({ success: false, error: "Failed to deliver chat reminder message." });
        }

        res.status(200).json({
          success: true,
          message: `Chat reminder sent to group leader (${leader.name}) of "${groupName || 'the group'}".`,
          notifiedCount: 1,
          leaderName: leader.name
        });
      });
    });
  });
});

// 6. SEND CHAT REMINDER TO LEADERS OF ALL MISSING GROUPS AT ONCE
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
    SELECT gm.group_id, gm.student_id, pg.group_name, u.name, gm.is_leader 
    FROM project_group_members gm 
    JOIN project_groups pg ON pg.id = gm.group_id
    JOIN users u ON u.id = gm.student_id 
    WHERE gm.group_id IN (?)
    ORDER BY gm.is_leader DESC, gm.id ASC
  `;

  db.query(memberSql, [groupIds], (err, members) => {
    if (err) {
      console.error("Error fetching missing group members:", err);
      return res.status(500).json({ success: false, error: "Database error fetching members." });
    }

    if (!members || members.length === 0) {
      return res.status(404).json({ success: false, error: "No registered students found for the missing groups." });
    }

    // Pick only the Leader for each missing group
    const leaderMap = {};
    members.forEach(m => {
      const gId = m.group_id;
      if (!leaderMap[gId] || (Number(m.is_leader) === 1 && Number(leaderMap[gId].is_leader) !== 1)) {
        leaderMap[gId] = m;
      }
    });

    const leaders = Object.values(leaderMap);

    const findAdminSql = `SELECT id FROM users WHERE role = 'admin' OR role = 'coordinator' LIMIT 1`;
    db.query(findAdminSql, [], (adminErr, adminRows) => {
      const senderId = Number(adminId) || (adminRows && adminRows.length > 0 ? adminRows[0].id : 1);

      const values = leaders.map(leader => {
        const text = messageText || `📢 Reminder:  Your Group "${leader.group_name}" has not yet submitted/filled the Industry Mentor details. Please fill in your mentor's details as soon as possible .`;
        return [senderId, leader.student_id, text, false];
      });

      const insertSql = `INSERT INTO messages_v2 (sender_id, receiver_id, message_text, read_status) VALUES ?`;
      db.query(insertSql, [values], (insertErr) => {
        if (insertErr) {
          console.error("Error inserting bulk reminders:", insertErr);
          return res.status(500).json({ success: false, error: "Failed to deliver chat reminders." });
        }

        res.status(200).json({
          success: true,
          message: `Reminders successfully sent to leaders across ${leaders.length} missing group(s)!`,
          notifiedCount: leaders.length,
          leaders: leaders.map(l => ({ group: l.group_name, leader: l.name }))
        });
      });
    });
  });
});

// 7. REASSIGN / CHANGE MENTOR FOR A SPECIFIC PROJECT GROUP
router.post('/reassign-group-mentor', async (req, res) => {
  const { 
    groupId, 
    groupName, 
    level, 
    academicUnit, 
    oldMentorId,
    oldMentorName, 
    oldMentorEmail, 
    sendAppreciation = true,
    newMentorName, 
    newMentorEmail, 
    newMentorCompany, 
    newMentorPhone 
  } = req.body;

  if (!groupId || !newMentorName || !newMentorEmail) {
    return res.status(400).json({ success: false, error: "Group ID, new mentor name, and new mentor email are required." });
  }

  const targetGroupId = Number(groupId);
  const targetLevel = Number(level) || 1;
  const targetAcademicUnit = academicUnit || 'ITM';

  try {
    // 1. If requested and old mentor email exists, dispatch appreciation / transition email to THAT specific mentor
    if (sendAppreciation && oldMentorEmail && oldMentorEmail.trim()) {
      try {
        await sendMentorOffboardingAppreciationEmail(
          oldMentorEmail.trim(), 
          oldMentorName || 'Industry Mentor', 
          groupName || `Group ${groupId}`
        );
      } catch (emailErr) {
        console.warn("Warning: Could not send offboarding appreciation email:", emailErr.message);
      }
    }

    // 2. Identify the specific mentor ID to unlink & retrieve phone/company from DB
    const executeUnlink = (specificMentorId) => {
      const deleteJunctionSql = specificMentorId 
        ? `DELETE FROM project_group_mentors WHERE group_id = ? AND mentor_id = ?`
        : `DELETE FROM project_group_mentors WHERE group_id = ?`;
      const deleteParams = specificMentorId ? [targetGroupId, specificMentorId] : [targetGroupId];

      db.query(deleteJunctionSql, deleteParams, (junctionErr) => {
        if (junctionErr) console.warn("Warning deleting from project_group_mentors:", junctionErr.message);

        // Update project_groups.mentor_id with remaining active mentor from project_group_mentors (or NULL if none left)
        db.query(`SELECT mentor_id FROM project_group_mentors WHERE group_id = ? ORDER BY id ASC LIMIT 1`, [targetGroupId], (selectErr, remaining) => {
          const nextMentorId = (remaining && remaining.length > 0) ? remaining[0].mentor_id : null;
          
          const updatePgSql = `UPDATE project_groups SET mentor_id = ? WHERE id = ?`;
          const updatePgParams = [nextMentorId, targetGroupId];

          db.query(updatePgSql, updatePgParams, async (pgErr) => {
            if (pgErr) console.warn("Warning updating project_groups.mentor_id:", pgErr.message);

            // 3. Generate setup token for the new mentor
            const frontendDomain = process.env.FRONTEND_URL || 'http://localhost:5173';
            const payload = Buffer.from(JSON.stringify({
              email: newMentorEmail.trim(),
              name: newMentorName.trim(),
              phone: newMentorPhone ? newMentorPhone.trim() : null,
              company: newMentorCompany ? newMentorCompany.trim() : null,
              groupId: targetGroupId,
              academicUnit: targetAcademicUnit,
              level: targetLevel 
            })).toString('base64');

            const setupUrl = `${frontendDomain}/mentor-setup/${payload}`;

            try {
              await sendMentorInviteEmail(
                newMentorEmail.trim(), 
                newMentorName.trim(), 
                groupName || `Group ${groupId}`, 
                setupUrl
              );

              res.status(200).json({ 
                success: true, 
                message: `Mentor reassigned successfully! Setup invitation dispatched to ${newMentorName} (${newMentorEmail}).` 
              });
            } catch (inviteErr) {
              console.error("Error sending new mentor invite email:", inviteErr.message);
              res.status(500).json({ success: false, error: "Failed to send onboarding invite to the new mentor." });
            }
          });
        });
      });
    };

    const proceedWithMentorDetails = (mentorUserId, mentorUserRow = null) => {
      const mentorFullName = oldMentorName || mentorUserRow?.name || 'Industry Mentor';
      const mentorEmailAddress = oldMentorEmail || mentorUserRow?.email || '';
      const mentorPhone = req.body.oldMentorPhone || mentorUserRow?.phone || null;
      const adminId = req.body.reassignedBy || null;

      // Look up mentor company from project_group_mentors table
      db.query(
        `SELECT company FROM project_group_mentors WHERE group_id = ? AND (mentor_id = ? OR mentor_id IS NULL) LIMIT 1`,
        [targetGroupId, mentorUserId],
        (pgmErr, pgmRows) => {
          const pgmCompany = (pgmRows && pgmRows.length > 0 && pgmRows[0].company) ? pgmRows[0].company : null;
          const mentorCompany = req.body.oldMentorCompany || pgmCompany || null;

          // 2a. Archive unlinked mentor details into mentor_assignment_history
          if (mentorFullName || mentorEmailAddress) {
            const historyInsertSql = `
              INSERT INTO mentor_assignment_history 
              (group_id, group_name, level, academic_unit, mentor_id, mentor_name, mentor_email, mentor_phone, mentor_company, new_mentor_name, new_mentor_email, reassigned_by, reassigned_reason, unassigned_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `;
            const historyParams = [
              targetGroupId,
              groupName || `Group ${groupId}`,
              targetLevel,
              targetAcademicUnit,
              mentorUserId || null,
              mentorFullName,
              mentorEmailAddress,
              mentorPhone,
              mentorCompany,
              newMentorName.trim(),
              newMentorEmail.trim(),
              adminId,
              'Reassigned / Changed by Administrator'
            ];

            db.query(historyInsertSql, historyParams, (histErr) => {
              if (histErr) console.warn("Warning recording mentor history log:", histErr.message);
            });
          }

          executeUnlink(mentorUserId);
        }
      );
    };

    if (oldMentorId) {
      db.query(`SELECT id, name, email, phone FROM users WHERE id = ? LIMIT 1`, [Number(oldMentorId)], (findErr, userRows) => {
        const foundRow = (userRows && userRows.length > 0) ? userRows[0] : null;
        proceedWithMentorDetails(Number(oldMentorId), foundRow);
      });
    } else if (oldMentorEmail && oldMentorEmail.trim()) {
      db.query(`SELECT id, name, email, phone FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1`, [oldMentorEmail.trim().toLowerCase()], (findErr, userRows) => {
        const foundRow = (userRows && userRows.length > 0) ? userRows[0] : null;
        const foundId = foundRow ? foundRow.id : null;
        proceedWithMentorDetails(foundId, foundRow);
      });
    } else {
      proceedWithMentorDetails(null, null);
    }

  } catch (error) {
    console.error("Error in reassign-group-mentor:", error);
    res.status(500).json({ success: false, error: "Server error during mentor reassignment." });
  }
});

// 8. GET MENTOR REASSIGNMENT HISTORY FOR A LEVEL
router.get('/history/level/:level', (req, res) => {
  const level = Number(req.params.level) || 1;
  const groupId = req.query.groupId ? Number(req.query.groupId) : null;

  let query = `
    SELECT 
      mah.*, 
      u.name AS reassigned_by_name,
      u.email AS reassigned_by_email
    FROM mentor_assignment_history mah
    LEFT JOIN users u ON mah.reassigned_by = u.id
    WHERE mah.level = ?
  `;
  let params = [level];

  if (groupId) {
    query += ` AND mah.group_id = ?`;
    params.push(groupId);
  }

  query += ` ORDER BY mah.unassigned_at DESC`;

  db.query(query, params, (err, rows) => {
    if (err) {
      console.warn("Warning fetching mentor history with JOIN:", err.message);
      db.query(`SELECT * FROM mentor_assignment_history WHERE level = ? ORDER BY unassigned_at DESC`, [level], (fbErr, fbRows) => {
        if (fbErr) {
          console.warn("Fallback query failed:", fbErr.message);
          return res.status(200).json({ success: true, history: [] });
        }
        return res.status(200).json({ success: true, history: fbRows || [] });
      });
      return;
    }
    return res.status(200).json({ success: true, history: rows || [] });
  });
});

module.exports = router;