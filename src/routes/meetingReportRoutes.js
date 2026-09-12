const express = require('express');
const router = express.Router();
const meetingReportController = require('../controllers/meetingReportController');
const { verifyToken } = require('../middleware/authMiddleware');

// Create a new meeting report (Student) — for an approved meeting request.
router.post('/', verifyToken, meetingReportController.createReport);

// Get pending meeting reports for a specific supervisor
router.get('/supervisor/:supervisorId', verifyToken, meetingReportController.getPendingReports);

// Update status of a meeting report (Approve/Reject)
router.put('/:id/status', verifyToken, meetingReportController.updateStatus);

// Get meeting reports for a specific student
router.get('/student/:studentId', verifyToken, meetingReportController.getReportsForStudent);

// Every meeting request + report tied to a group, across all its members —
// the supervisor's "View History" panel.
router.get('/group-history/:groupName', verifyToken, meetingReportController.getGroupHistory);

module.exports = router;
