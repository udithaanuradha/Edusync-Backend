const db = require("../config/db");
const dbPromise = db.promise();

// Existing Route: Search Student
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

// Existing Route: Search Supervisors
const searchSupervisors = (req, res) => {
  const rawSearch = typeof req.query.search === "string" ? req.query.search : "";
  const search = rawSearch.trim();

  const sql = `
    SELECT id, name, email, role
    FROM users
    WHERE role = 'supervisor'
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

// Existing Route: Get Users by Role
const getUsersByRole = (req, res) => {
  const role = req.query.role;
  const validRoles = ["student", "supervisor", "coordinator", "admin", "mentor"];
  
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

// Existing Route: Get Students by Level
// Group-formation update: when `studentId` is provided (the requesting
// student), results are scoped to that student's own department (resolved
// server-side from their own row — a `department` query param, if sent, is
// deliberately ignored so a client can't spoof another department) in
// addition to level. Without `studentId` this keeps its original behavior
// (all students at the level, any department) so existing callers that rely
// on the unfiltered list — e.g. the coordinator's manual group builder in
// GroupManagement.tsx — are unaffected.
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

const getLecturersForAssignment = (req, res) => {
  const sql = `
    SELECT id, name, university_id, designation, academic_unit, level 
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

const assignCoordinator = (req, res) => {
  const { user_id, level } = req.body; 

  if (!user_id || !level) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  
  const resetSql = `
    UPDATE users 
    SET designation = 'supervisor', level = NULL 
    WHERE level = ? AND designation = 'coordinator'
  `;

  db.query(resetSql, [level], (err, resetResults) => {
    if (err) {
      console.error("Error resetting old coordinator:", err);
      return res.status(500).json({ error: "Failed to update current coordinator status." });
    }

   
    const assignSql = `
      UPDATE users 
      SET designation = 'coordinator', level = ? 
      WHERE id = ? AND role = 'lecturer'
    `;

    db.query(assignSql, [level, user_id], (err, assignResults) => {
      if (err) {
        console.error("Error assigning new coordinator:", err);
        return res.status(500).json({ error: "Failed to assign coordinator." });
      }

      
      // Give 'supervisor' designation to all lecturers
      // who don't have any designation assigned yet.
      // Only touches lecturers — other roles are
      // protected by WHERE role = 'lecturer'
      const updateSupervisorsSql = `
       UPDATE users 
       SET designation = 'supervisor' 
       WHERE role = 'lecturer' 
       AND (designation IS NULL OR designation = '')
      `;

      db.query(updateSupervisorsSql, [], (err, supervisorResults) => {
        if (err) console.error("Error updating other lecturers to supervisors:", err);
        
        res.status(200).json({ 
          success: true, 
          message: "Successfully assigned Coordinator and synchronized remaining lecturers as supervisors." 
        });
      });
    });
  });
};

const removeCoordinator = (req, res) => {
  const { level } = req.body;

  if (!level) return res.status(400).json({ error: "Missing required level." });

  const sql = `
    UPDATE users 
    SET designation = 'supervisor', level = NULL 
    WHERE level = ? AND designation = 'coordinator'
  `;

  db.query(sql, [level], (err, results) => {
    if (err) {
      console.error("Error removing coordinator:", err);
      return res.status(500).json({ error: "Failed to remove coordinator." });
    }
    res.status(200).json({ success: true, message: "Coordinator status reset to supervisor." });
  });
};

/**
 * GET: Returns a single user's profile (no password) for any group member
 * to view about any other member of a group they both belong to.
 * Requires `?requesterId=` — the viewer's own id. Access is allowed when:
 *   - requesterId === the target id (viewing your own profile), or
 *   - requesterId and the target share at least one project_group_members.group_id row.
 */
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

