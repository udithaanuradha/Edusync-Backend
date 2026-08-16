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

// Get Users by Role
const getUsersByRole = (req, res) => {
  const role = req.query.role;
  const validRoles = ["student", "admin", "mentor", "lecturer"];
  
  if (!role || !validRoles.includes(role)) {
    return res.status(400).json({ error: "Please provide a valid role." });
  }

  const sql = `SELECT id, name, email, role FROM users WHERE role = ? ORDER BY name ASC LIMIT 100`;

  db.query(sql, [role], (err, results) => {
    if (err) {
      console.error("Error fetching users by role:", err);
      return res.status(500).json({ error: "Failed to fetch users." });
    }
    res.status(200).json(results);
  });
};

// Get Students by Level
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
      if (shared.length === 0) {
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

    res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch profile.' });
  }
};

module.exports = {
  searchStudentForGroup,
  searchSupervisors,
  getUsersByRole,
  getStudentsByLevel,
  getLecturersForAssignment,
  assignCoordinator,
  removeCoordinator,
  getUserProfile,
};