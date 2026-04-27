// Change this path if your database file is named differently or in a different folder!
const db = require("../config/db");

const searchStudentForGroup = (req, res) => {
  const { uniId, level } = req.query;

  if (!uniId || !level) {
    return res
      .status(400)
      .json({ error: "Please provide both University ID and Academic Level." });
  }

  // Search TiDB for this specific student using their index number
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

    // If the array is empty, the student doesn't exist or is in the wrong level
    if (results.length === 0) {
      return res
        .status(404)
        .json({
          error: "No student found with this ID for this Academic Level.",
        });
    }

    // Success! Send the student data back to the Coordinator's UI
    res.status(200).json({
      success: true,
      student: results[0],
    });
  });
};

const searchSupervisors = (req, res) => {
  const rawSearch =
    typeof req.query.search === "string" ? req.query.search : "";
  const search = rawSearch.trim();

  const sql = `
        SELECT id, name, email, role
        FROM users
        WHERE role = 'supervisor'
          AND (
            ? = ''
            OR name LIKE CONCAT('%', ?, '%')
            OR email LIKE CONCAT('%', ?, '%')
          )
        ORDER BY name ASC
        LIMIT 20
    `;

  db.query(sql, [search, search, search], (err, results) => {
    if (err) {
      console.error("Supervisor Search Error:", err);
      return res.status(500).json({ error: "Failed to search supervisors." });
    }

    res.status(200).json({
      success: true,
      data: results,
    });
  });
};

// Get users by role (for messaging feature)
const getUsersByRole = (req, res) => {
  const role = req.query.role;

  // Validate role
  const validRoles = [
    "student",
    "supervisor",
    "coordinator",
    "admin",
    "mentor",
  ];
  if (!role || !validRoles.includes(role)) {
    return res.status(400).json({ error: "Please provide a valid role." });
  }

  const sql = `
        SELECT id, name, email, role
        FROM users
        WHERE role = ?
        ORDER BY name ASC
        LIMIT 100
    `;

  db.query(sql, [role], (err, results) => {
    if (err) {
      console.error("Error fetching users by role:", err);
      return res.status(500).json({ error: "Failed to fetch users." });
    }

    res.status(200).json(results);
  });
};

// Export the function so the router can use it
module.exports = { searchStudentForGroup, searchSupervisors, getUsersByRole };
