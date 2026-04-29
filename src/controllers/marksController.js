const db = require('../config/db');

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

module.exports = { getStageMarks, submitMarks };





































