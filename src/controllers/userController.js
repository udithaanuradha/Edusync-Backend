const db = require("../config/db"); 

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
const getStudentsByLevel = (req, res) => {
  const level = req.params.level;
  if (!level) return res.status(400).json({ error: "Please provide an Academic Level." });

  const sql = `SELECT id, name, university_id FROM users WHERE role = 'student' AND level = ? ORDER BY name ASC`;

  db.query(sql, [level], (err, results) => {
    if (err) {
      console.error("Error fetching students by level:", err);
      return res.status(500).json({ error: "Failed to fetch students." });
    }
    res.status(200).json(results);
  });
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

      
      const updateSupervisorsSql = `
        UPDATE users 
        SET designation = 'supervisor' 
        WHERE role = 'lecturer' AND designation IS NULL
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

module.exports = {
  searchStudentForGroup,
  searchSupervisors,
  getUsersByRole,
  getStudentsByLevel,
  getLecturersForAssignment,
  assignCoordinator,
  removeCoordinator
};

