const bcrypt = require("bcryptjs");
const db = require("../config/db");
const dbPromise = db.promise();

// Search Student for Group
const searchStudentForGroup = (req, res) => {
  const { uniId, level } = req.query;

  if (!uniId || !level) {
    return res.status(400).json({ error: "Please provide both University ID and Academic Level." });
  }

  const sql = `
    SELECT id, name, university_id, email, level 
    FROM users 
    WHERE university_id = ? AND role = 'student' AND level = ?
  `;

  db.query(sql, [uniId, level], (err, results) => {
    if (err) {
      console.error("Database Search Error:", err);
      return res.status(500).json({ error: "Failed to search the database." });
    }
    if (results.length === 0) {
      return res.status(404).json({ error: "No student found with this ID for this Academic Level." });
    }
    res.status(200).json({ success: true, student: results[0] });
  });
};

// Search Supervisors (Searching Lecturers)
const searchSupervisors = (req, res) => {
  const rawSearch = typeof req.query.search === "string" ? req.query.search : "";
  const search = rawSearch.trim();

  const sql = `
    SELECT id, name, email, role
    FROM users
    WHERE role = 'lecturer'
      AND (? = '' OR name LIKE CONCAT('%', ?, '%') OR email LIKE CONCAT('%', ?, '%'))
    ORDER BY name ASC LIMIT 20
  `;

  db.query(sql, [search, search, search], (err, results) => {
    if (err) {
      console.error("Supervisor Search Error:", err);
      return res.status(500).json({ error: "Failed to search supervisors." });
    }
    res.status(200).json({ success: true, data: results });
  });
};

// Get Users by Role with rich activity data
const getUsersByRole = async (req, res) => {
  const role = req.query.role;
  try {
    let whereClause = "WHERE u.role NOT IN ('supervisor', 'coordinator') AND NOT (u.role = 'lecturer' AND u.designation IS NULL)";
    let params = [];

    if (role && role !== 'all') {
      if (role === 'lecturer') {
        whereClause = "WHERE u.role = 'lecturer' AND u.designation IS NOT NULL";
      } else {
        whereClause = "WHERE u.role = ? AND u.role NOT IN ('supervisor', 'coordinator')";
        params = [role];
      }
    }

    const sql = `
      SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.role, 
        u.designation, 
        u.is_verified,
        u.last_login,
        u.created_at,
        sub.last_submission,
        sub.submission_count,
        m.last_marking,
        m.marking_count,
        gm.joined_group_at,
        ann.last_announcement,
        msg.last_message_at
      FROM users u
      LEFT JOIN (
        SELECT student_id, MAX(submitted_at) as last_submission, COUNT(*) as submission_count 
        FROM student_submissions 
        GROUP BY student_id
      ) sub ON sub.student_id = u.id
      LEFT JOIN (
        SELECT marked_by, MAX(updated_at) as last_marking, COUNT(*) as marking_count 
        FROM marks 
        GROUP BY marked_by
      ) m ON m.marked_by = u.id
      LEFT JOIN (
        SELECT student_id, MAX(created_at) as joined_group_at 
        FROM project_group_members 
        GROUP BY student_id
      ) gm ON gm.student_id = u.id
      LEFT JOIN (
        SELECT author_id, MAX(created_at) as last_announcement 
        FROM announcements 
        GROUP BY author_id
      ) ann ON ann.author_id = u.id
      LEFT JOIN (
        SELECT sender_id, MAX(created_at) as last_message_at 
        FROM messages_v2 
        GROUP BY sender_id
      ) msg ON msg.sender_id = u.id
      ${whereClause}
      ORDER BY u.name ASC
    `;

    const [rows] = await dbPromise.query(sql, params);

    const enriched = rows.map(u => {
      let latestAction = 'Enrolled User';
      let latestTime = u.created_at || new Date().toISOString();
      let hasAction = false;

      if (u.created_at) {
        latestAction = 'Account Created';
        latestTime = u.created_at;
      }

      if (u.joined_group_at && (!latestTime || new Date(u.joined_group_at) > new Date(latestTime))) {
        latestAction = 'Joined Project Group';
        latestTime = u.joined_group_at;
        hasAction = true;
      }

      if (u.last_message_at && (!latestTime || new Date(u.last_message_at) > new Date(latestTime))) {
        latestAction = 'Sent Chat Message';
        latestTime = u.last_message_at;
        hasAction = true;
      }

      if (u.last_announcement && (!latestTime || new Date(u.last_announcement) > new Date(latestTime))) {
        latestAction = 'Published Announcement';
        latestTime = u.last_announcement;
        hasAction = true;
      }

      if (u.last_marking && (!latestTime || new Date(u.last_marking) > new Date(latestTime))) {
        latestAction = `Graded Submissions (${u.marking_count})`;
        latestTime = u.last_marking;
        hasAction = true;
      }

      if (u.last_submission && (!latestTime || new Date(u.last_submission) > new Date(latestTime))) {
        latestAction = `Milestone Submitted (${u.submission_count})`;
        latestTime = u.last_submission;
        hasAction = true;
      }

      if (u.last_login && (!latestTime || new Date(u.last_login) > new Date(latestTime))) {
        latestAction = 'Logged In to Portal';
        latestTime = u.last_login;
        hasAction = true;
      }

      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        designation: u.designation,
        is_verified: u.is_verified,
        last_login: u.last_login,
        created_at: u.created_at,
        last_action: hasAction ? latestAction : (u.last_login ? 'Logged In to Portal' : 'Enrolled User'),
        last_action_time: latestTime,
        has_logged_in: Boolean(u.last_login)
      };
    });

    res.status(200).json(enriched);
  } catch (err) {
    console.error("Error fetching users by role:", err);
    res.status(500).json({ error: "Failed to fetch users." });
  }
};

const getStudentsByLevel = async (req, res) => {
  const level = req.params.level;
  const studentId = req.query.studentId;
  if (!level) return res.status(400).json({ error: "Please provide an Academic Level." });

  try {
    if (studentId) {
      const [requesterRows] = await dbPromise.query(
        `SELECT academic_unit FROM users WHERE id = ? AND role = 'student'`,
        [studentId]
      );
      if (requesterRows.length === 0) {
        return res.status(404).json({ error: "Requesting student not found." });
      }
      const department = requesterRows[0].academic_unit;

      const [results] = await dbPromise.query(
        `SELECT id, name, university_id, academic_unit AS department, level
         FROM users
         WHERE role = 'student' AND level = ? AND id != ?
           AND academic_unit ${department === null ? 'IS NULL' : '= ?'}
         ORDER BY name ASC`,
        department === null ? [level, studentId] : [level, studentId, department]
      );
      return res.status(200).json(results);
    }

    const [results] = await dbPromise.query(
      `SELECT id, name, university_id, academic_unit AS department, level FROM users WHERE role = 'student' AND level = ? ORDER BY name ASC`,
      [level]
    );
    res.status(200).json(results);
  } catch (err) {
    console.error("Error fetching students by level:", err);
    res.status(500).json({ error: "Failed to fetch students." });
  }
};

// Fetch Lecturers for Assignment (role = 'lecturer' only)
const getLecturersForAssignment = (req, res) => {
  const sql = `
    SELECT id, name, university_id, designation, academic_unit, level, role 
    FROM users 
    WHERE role = 'lecturer'
    ORDER BY name ASC
  `;
  db.query(sql, [], (err, results) => {
    if (err) {
      console.error("Error fetching lecturers:", err);
      return res.status(500).json({ error: "Failed to fetch lecturers." });
    }
    res.status(200).json(results);
  });
};

// Assign Coordinator
const assignCoordinator = async (req, res) => {
  const { user_id, lecturerId, level, degreeProgram } = req.body; 
  const targetUserId = user_id || lecturerId;

  if (!targetUserId || !level || !degreeProgram) {
    return res.status(400).json({ error: "Missing required fields: user_id, level, or degreeProgram." });
  }

  try {
    let mappedUnit = degreeProgram;
    if (degreeProgram === 'ITM') mappedUnit = 'IDS';
    if (degreeProgram === 'AI') mappedUnit = 'CM';

    // 1. Reset ONLY the current coordinator's designation and level
    const resetSql = `
      UPDATE users 
      SET designation = 'supervisor', level = NULL 
      WHERE level = ? 
        AND (academic_unit = ? OR academic_unit = ?) 
        AND designation = 'coordinator'
    `;
    await dbPromise.query(resetSql, [level, degreeProgram, mappedUnit]);

    // 2. Assign designation = 'coordinator' and update academic_unit to Department (IDS/CM/IT)
    const assignSql = `
      UPDATE users 
      SET designation = 'coordinator', level = ?, academic_unit = ? 
      WHERE id = ? AND role = 'lecturer'
    `;
    await dbPromise.query(assignSql, [level, mappedUnit, targetUserId]);

    return res.status(200).json({ 
      success: true, 
      message: "Successfully assigned Coordinator designation." 
    });
  } catch (err) {
    console.error("Error assigning coordinator:", err);
    return res.status(500).json({ error: "Failed to assign coordinator." });
  }
};

// Remove Coordinator
const removeCoordinator = async (req, res) => {
  const { level, degreeProgram } = req.body;

  if (!level || !degreeProgram) {
    return res.status(400).json({ error: "Missing required fields: level or degreeProgram." });
  }

  try {
    let mappedUnit = degreeProgram;
    if (degreeProgram === 'ITM') mappedUnit = 'IDS';
    if (degreeProgram === 'AI') mappedUnit = 'CM';

    const sql = `
      UPDATE users 
      SET designation = 'supervisor', level = NULL 
      WHERE level = ? 
        AND (academic_unit = ? OR academic_unit = ?) 
        AND designation = 'coordinator'
    `;
    await dbPromise.query(sql, [level, degreeProgram, mappedUnit]);

    return res.status(200).json({ success: true, message: "Coordinator designation removed successfully." });
  } catch (err) {
    console.error("Error removing coordinator:", err);
    return res.status(500).json({ error: "Failed to remove coordinator." });
  }
};

// User Profile
const getUserProfile = async (req, res) => {
  const targetId = req.params.id;
  const requesterId = req.query.requesterId;

  if (!requesterId) {
    return res.status(400).json({ success: false, error: 'requesterId is required.' });
  }

  try {
    if (String(requesterId) !== String(targetId)) {
      const [shared] = await dbPromise.query(
        `SELECT 1
         FROM project_group_members gm1
         JOIN project_group_members gm2 ON gm1.group_id = gm2.group_id
         WHERE gm1.student_id = ? AND gm2.student_id = ?
         LIMIT 1`,
        [requesterId, targetId]
      );

      let isOwnGroupSupervisorOrMentor = false;
      if (shared.length === 0) {
        const [assigned] = await dbPromise.query(
          `SELECT 1
           FROM project_group_members gm
           JOIN project_groups pg ON pg.id = gm.group_id
           WHERE gm.student_id = ? AND (pg.supervisor_id = ? OR pg.mentor_id = ?)
           LIMIT 1`,
          [requesterId, targetId, targetId]
        );
        isOwnGroupSupervisorOrMentor = assigned.length > 0;
      }

      if (shared.length === 0 && !isOwnGroupSupervisorOrMentor) {
        return res.status(403).json({ success: false, error: 'Access denied. You do not share a group with this user.' });
      }
    }

    const [rows] = await dbPromise.query(
      `SELECT id, name, email, university_id, academic_unit AS department, level, role, phone
       FROM users WHERE id = ?`,
      [targetId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const [groupRows] = await dbPromise.query(
      `SELECT pg.id AS group_id, pg.group_name, pg.level
       FROM project_group_members gm
       JOIN project_groups pg ON pg.id = gm.group_id
       WHERE gm.student_id = ?
       ORDER BY pg.level ASC`,
      [targetId]
    );

    res.status(200).json({ success: true, data: { ...rows[0], groups: groupRows } });
  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch profile.' });
  }
};

// Update user personal profile
const updateUserProfile = async (req, res) => {
  const { userId, name, phone, designation } = req.body;
  if (!userId) {
    return res.status(400).json({ success: false, error: 'User ID is required.' });
  }

  try {
    const trimmedName = name ? String(name).trim() : null;
    const trimmedPhone = phone !== undefined ? (phone ? String(phone).trim() : '') : null;
    const trimmedDesignation = designation !== undefined ? (designation ? String(designation).trim() : null) : null;

    let updateFields = [];
    let params = [];

    if (trimmedName) {
      updateFields.push('name = ?');
      params.push(trimmedName);
    }
    if (trimmedPhone !== null) {
      updateFields.push('phone = ?');
      params.push(trimmedPhone);
    }
    if (trimmedDesignation !== null) {
      updateFields.push('designation = ?');
      params.push(trimmedDesignation);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update.' });
    }

    params.push(userId);
    const sql = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
    await dbPromise.query(sql, params);

    const [updatedRows] = await dbPromise.query(
      `SELECT id, name, email, role, designation, level, academic_unit, phone, university_id, is_verified FROM users WHERE id = ?`,
      [userId]
    );

    if (updatedRows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully!',
      user: updatedRows[0]
    });
  } catch (err) {
    console.error('Error updating user profile:', err);
    res.status(500).json({ success: false, error: 'Failed to update profile.' });
  }
};

// Change user password
const changeUserPassword = async (req, res) => {
  const { userId, currentPassword, newPassword } = req.body;

  if (!userId || !currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, error: 'New password must be at least 6 characters long.' });
  }

  try {
    const [rows] = await dbPromise.query(
      `SELECT id, password FROM users WHERE id = ?`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const dbPassword = rows[0].password || '';
    const isHashed = dbPassword.startsWith('$2a$') || dbPassword.startsWith('$2b$') || dbPassword.startsWith('$2y$');

    let isMatch = false;
    if (isHashed) {
      isMatch = await bcrypt.compare(currentPassword, dbPassword);
    } else {
      isMatch = (currentPassword === dbPassword);
    }

    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Current password does not match.' });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    await dbPromise.query(
      `UPDATE users SET password = ? WHERE id = ?`,
      [hashedPassword, userId]
    );

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully!'
    });
  } catch (err) {
    console.error('Error changing password:', err);
    res.status(500).json({ success: false, error: 'Failed to change password.' });
  }
};


// Verify Single User
const verifyUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: 'User ID is required.' });
    }
    await dbPromise.query('UPDATE users SET is_verified = 1 WHERE id = ?', [id]);
    return res.status(200).json({ success: true, message: 'User verified successfully.' });
  } catch (err) {
    console.error('Error verifying user:', err);
    return res.status(500).json({ success: false, error: 'Failed to verify user.' });
  }
};

// Verify All Unverified Users
const verifyAllUsers = async (req, res) => {
  try {
    const [result] = await dbPromise.query('UPDATE users SET is_verified = 1 WHERE is_verified = 0 OR is_verified IS NULL');
    return res.status(200).json({ success: true, message: 'All pending accounts verified successfully.', affectedRows: result.affectedRows });
  } catch (err) {
    console.error('Error verifying all users:', err);
    return res.status(500).json({ success: false, error: 'Failed to verify all users.' });
  }
};

module.exports = {
    verifyUser,
    verifyAllUsers,
  searchStudentForGroup,
  searchSupervisors,
  getUsersByRole,
  getStudentsByLevel,
  getLecturersForAssignment,
  assignCoordinator,
  removeCoordinator,
  getUserProfile,
  updateUserProfile,
  changeUserPassword,
};
