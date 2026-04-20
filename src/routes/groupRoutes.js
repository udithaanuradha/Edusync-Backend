 const express = require('express');
// DELETE: any old lines here
// ADD: The line below is what was missing!
const router = express.Router(); 

module.exports = (db) => {

    // 1. Get Supervisors
    router.get('/supervisors', (req, res) => {
        db.query("SELECT id, name FROM users WHERE role = 'supervisor'", (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(results);
        });
    });

    // 2. Create Request
    router.post('/request', (req, res) => {
        const { group_name, members_list, request_message, student_id, supervisor_id, project_level } = req.body;
        const sql = `INSERT INTO group_requests (group_name, members_list, request_message, student_id, supervisor_id, project_level) 
                     VALUES (?, ?, ?, ?, ?, ?)`;
        
        db.query(sql, [group_name, members_list, request_message, student_id, supervisor_id, project_level], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ message: "Request Sent", groupId: result.insertId });
        });
    });

    // 3. Final Submit
    router.put('/final-submit', (req, res) => {
        const { request_id } = req.body;
        const sql = `UPDATE group_requests SET is_final_submitted = TRUE WHERE request_id = ? AND status = 'approved'`;
        
        db.query(sql, [request_id], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            if (result.affectedRows === 0) {
                return res.status(400).json({ error: "Cannot finalize. Ensure supervisor has approved the request." });
            }
            res.json({ success: true, message: "Submitted to Coordinator" });
        });
    });

    // This must be at the very bottom
    return router; 
};