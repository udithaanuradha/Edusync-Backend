const db = require('../config/db');

// Fetch only users with role 'supervisor'
exports.getSupervisors = async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT id, name FROM users WHERE role = 'supervisor'");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Create a new group request
exports.createRequest = async (req, res) => {
    const { group_name, members_list, request_message, student_id, supervisor_id } = req.body;
    try {
        const sql = `INSERT INTO group_requests (group_name, members_list, request_message, student_id, supervisor_id) 
                     VALUES (?, ?, ?, ?, ?)`;
        const [result] = await db.execute(sql, [group_name, members_list, request_message, student_id, supervisor_id]);
        res.status(201).json({ message: "Request Sent", groupId: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};