 const express = require('express');
// DELETE: any old lines here
// ADD: The line below is what was missing!
const router = express.Router(); 

module.exports = (db) => {

    const getRequestId = (req) => {
        return (
            req.body?.request_id ||
            req.body?.requestId ||
            req.body?.id ||
            req.params?.request_id ||
            req.params?.requestId ||
            req.params?.id
        );
    };

    const approveHandler = (req, res) => {
        const requestId = getRequestId(req);
        if (!requestId) {
            return res.status(400).json({ error: 'request_id is required' });
        }

        const sql = `UPDATE group_requests SET status = 'approved' WHERE request_id = ?`;

        db.query(sql, [requestId], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            if (result.affectedRows === 0) {
                return res.status(400).json({ error: 'Request not found' });
            }
            res.json({ success: true, message: 'Request approved' });
        });
    };

    const rejectHandler = (req, res) => {
        const requestId = getRequestId(req);
        const rejectionReason =
            req.body?.rejection_reason ??
            req.body?.rejectionReason ??
            req.body?.message ??
            req.body?.reason ??
            null;
        if (!requestId) {
            return res.status(400).json({ error: 'request_id is required' });
        }

        const sql = `UPDATE group_requests SET status = 'rejected', rejection_reason = ? WHERE request_id = ?`;

        db.query(sql, [rejectionReason, requestId], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            if (result.affectedRows === 0) {
                return res.status(400).json({ error: 'Request not found' });
            }
            res.json({ success: true, message: 'Request rejected' });
        });
    };

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

    // 4. GET Pending Requests for a Supervisor
    router.get('/pending/:supervisor_id', (req, res) => {
        const { supervisor_id } = req.params;
        const sql = `SELECT * FROM group_requests WHERE supervisor_id = ? AND status = 'pending' ORDER BY created_at DESC`;
        
        db.query(sql, [supervisor_id], (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(results);
        });
    });

    // 4b. GET All Requests for a Student (for student dashboard/status page)
    const studentRequestsHandler = (req, res) => {
        const studentId = req.params.student_id || req.params.id || req.query.student_id;
        if (!studentId) {
            return res.status(400).json({ error: 'student_id is required' });
        }

        const sql = `
            SELECT
                gr.request_id,
                gr.group_name,
                gr.members_list,
                gr.request_message,
                gr.student_id,
                gr.supervisor_id,
                u.name AS supervisor_name,
                gr.status,
                gr.rejection_reason,
                gr.project_level,
                gr.is_final_submitted,
                gr.created_at
            FROM group_requests gr
            LEFT JOIN users u ON u.id = gr.supervisor_id
            WHERE gr.student_id = ?
            ORDER BY gr.created_at DESC
        `;

        db.query(sql, [studentId], (err, results) => {
            if (err) return res.status(500).json({ error: err.message });

            const normalized = results.map((row) => ({
                ...row,
                decision_message:
                    row.status === 'approved'
                        ? 'Approved by supervisor'
                        : row.status === 'rejected'
                            ? (row.rejection_reason || 'Rejected by supervisor')
                            : 'Pending supervisor approval'
            }));

            res.json(normalized);
        });
    };

    router.get('/student/:student_id/requests', studentRequestsHandler);
    router.get('/student/:student_id', studentRequestsHandler);
    router.get('/my-requests/:student_id', studentRequestsHandler);
    router.get('/requests/student/:student_id', studentRequestsHandler);
    router.get('/my-requests', studentRequestsHandler);

    // 5. Approve Request (supports multiple route/method shapes)
    router.put('/approve', approveHandler);
    router.post('/approve', approveHandler);
    router.patch('/approve', approveHandler);
    router.put('/approve/:request_id', approveHandler);
    router.post('/approve/:request_id', approveHandler);
    router.patch('/approve/:request_id', approveHandler);
    router.put('/requests/:request_id/approve', approveHandler);
    router.post('/requests/:request_id/approve', approveHandler);
    router.patch('/requests/:request_id/approve', approveHandler);

    // 6. Reject Request (supports multiple route/method shapes)
    router.put('/reject', rejectHandler);
    router.post('/reject', rejectHandler);
    router.patch('/reject', rejectHandler);
    router.put('/reject/:request_id', rejectHandler);
    router.post('/reject/:request_id', rejectHandler);
    router.patch('/reject/:request_id', rejectHandler);
    router.put('/requests/:request_id/reject', rejectHandler);
    router.post('/requests/:request_id/reject', rejectHandler);
    router.patch('/requests/:request_id/reject', rejectHandler);

    // This must be at the very bottom
    return router; 
};