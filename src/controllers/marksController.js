const db = require('../config/db');

const getCoordinatorSubmissionTracking = async (req, res) => {
  try {
    const level = Number(req.params.level ?? req.query.level ?? 0);

    if (!level) {
      return res.status(400).json({ success: false, message: 'A valid level is required.' });
    }

    const query = `
      SELECT
        ss.submission_id,
        ss.stage_id,
        ss.student_id,
        ss.file_paths,
        ss.submitted_at,
        ss.status,
        ps.stage_name,
        ps.deadline,
        COALESCE(pg.group_name, 'Student Submission') AS group_name,
        COALESCE(u.name, 'Not assigned') AS evaluator_name,
        NULL AS mark,
        'submission' AS mark_type
      FROM student_submissions ss
      LEFT JOIN project_stages ps ON ps.stage_id = ss.stage_id
      LEFT JOIN project_group_members pgm ON pgm.student_id = ss.student_id
      LEFT JOIN project_groups pg ON pg.id = pgm.group_id AND pg.level = ?
      LEFT JOIN users u ON u.id = pg.created_by
      WHERE ps.level = ?
      ORDER BY ss.submitted_at DESC
    `;

    const [rows] = await db.execute(query, [level, level]);

    const normalized = (rows || []).map((row) => ({
      ...row,
      group_id: row.group_id ?? null,
      group_name: row.group_name || 'Student Submission',
      submission_date: row.submitted_at || null,
      submitted_at: row.submitted_at || null,
      current_status: row.status || 'submitted',
      mark: row.mark ?? null,
      evaluator_name: row.evaluator_name || 'Not assigned',
      mark_type: row.mark_type || 'submission',
      file_paths: typeof row.file_paths === 'string' ? JSON.parse(row.file_paths) : row.file_paths || [],
    }));

    return res.json({ success: true, data: normalized });
  } catch (error) {
    console.error('Error fetching coordinator submission tracking:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch submission tracking data.' });
  }
};

// Get all marks for Coordinator View (Joined for readability)
const getStageMarks = async (req, res) => {
    try {
        const query = `
            SELECT 
                m.mark_id, 
                g.group_name, 
                s.stage_name, 
                m.marks_obtained, 
                m.total_marks, 
                u.username AS supervisor_name
            FROM marks m
            JOIN project_groups g ON m.group_id = g.id
            JOIN project_stages s ON m.stage_id = s.stage_id
            JOIN users u ON m.marked_by = u.id
            WHERE m.mark_type = 'stage'
            ORDER BY m.created_at DESC
        `;
        const [rows] = await db.execute(query);
        res.json(rows);
    } catch (error) {
        console.error("Error fetching marks:", error);
        res.status(500).json({ error: 'Failed to fetch stage marks.' });
    }
};

// Submit marks (Supervisor Action)
const submitMarks = async (req, res) => {
    const { group_id, stage_id, marked_by, marks_obtained, feedback } = req.body;
    try {
        const sql = `
            INSERT INTO marks (group_id, stage_id, marked_by, marks_obtained, feedback, mark_type) 
            VALUES (?, ?, ?, ?, ?, 'stage')
        `;
        await db.execute(sql, [group_id, stage_id, marked_by, marks_obtained, feedback]);
        res.status(201).json({ message: 'Mark submitted successfully!' });
    } catch (error) {
        console.error("Error submitting mark:", error);
        res.status(500).json({ error: 'Failed to submit marks.' });
    }
};

module.exports = { getStageMarks, submitMarks, getCoordinatorSubmissionTracking };





































