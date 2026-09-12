/**
 * Project type controller
 *
 * Backs the Group Project / Individual Project toggle on a student's Level 3
 * and Level 4 pages. Stores exactly one field per (student, level): which
 * project type they've chosen, so it survives refreshes and follows the
 * student across devices instead of resetting every session. No other
 * behavior lives here yet — the Individual Project side is a placeholder
 * until its own pages are specified.
 */
const db = require('../config/db');
const dbPromise = db.promise();

let ensureTablePromise = null;
const ensureProjectTypeTable = async () => {
  if (!ensureTablePromise) {
    ensureTablePromise = dbPromise.query(`
      CREATE TABLE IF NOT EXISTS student_project_type (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        level INT NOT NULL,
        project_type ENUM('group', 'individual') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_student_level (student_id, level)
      )
    `);
  }
  await ensureTablePromise;
};

// GET /api/project-type/:studentId/:level
// Returns { projectType: 'group' | 'individual' | null } — null means the
// student hasn't chosen yet for this level (no default is assumed here;
// the frontend decides what to show while unset).
const getProjectType = async (req, res) => {
  const studentId = Number(req.params.studentId);
  const level = Number(req.params.level);

  if (!Number.isFinite(studentId) || !Number.isFinite(level)) {
    return res.status(400).json({ error: 'studentId and level must be numbers.' });
  }

  try {
    await ensureProjectTypeTable();

    const [rows] = await dbPromise.query(
      'SELECT project_type FROM student_project_type WHERE student_id = ? AND level = ?',
      [studentId, level],
    );

    res.status(200).json({ projectType: rows.length > 0 ? rows[0].project_type : null });
  } catch (error) {
    console.error('Database error (getProjectType):', error);
    res.status(500).json({ error: 'Failed to fetch project type.' });
  }
};

// PUT /api/project-type
// Body: { studentId, level, projectType: 'group' | 'individual' }
// Upserts the student's choice for that level.
const setProjectType = async (req, res) => {
  const studentId = Number(req.body.studentId);
  const level = Number(req.body.level);
  const projectType = req.body.projectType;

  if (!Number.isFinite(studentId) || !Number.isFinite(level)) {
    return res.status(400).json({ error: 'studentId and level must be numbers.' });
  }
  if (projectType !== 'group' && projectType !== 'individual') {
    return res.status(400).json({ error: "projectType must be 'group' or 'individual'." });
  }

  try {
    await ensureProjectTypeTable();

    await dbPromise.query(
      `INSERT INTO student_project_type (student_id, level, project_type)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE project_type = VALUES(project_type)`,
      [studentId, level, projectType],
    );

    res.status(200).json({ projectType });
  } catch (error) {
    console.error('Database error (setProjectType):', error);
    res.status(500).json({ error: 'Failed to save project type.' });
  }
};

module.exports = {
  getProjectType,
  setProjectType,
};
