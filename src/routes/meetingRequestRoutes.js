const express = require('express');
const router = express.Router();
const meetingRequestController = require('../controllers/meetingRequestController');
const { verifyToken } = require('../middleware/authMiddleware');

// Create a new meeting request (Student)
router.post('/', verifyToken, meetingRequestController.createRequest);

// Get pending meeting requests for a specific supervisor
router.get('/supervisor/:supervisorId', verifyToken, meetingRequestController.getPendingRequests);

// Update status of a meeting request (Approve/Reject)
router.put('/:id/status', verifyToken, meetingRequestController.updateStatus);

// Get meeting requests for a specific student
router.get('/student/:studentId', verifyToken, meetingRequestController.getRequestsForStudent);

// Get a student's actually-assigned supervisor(s), for the "Supervisor"
// dropdown on the meeting request form.
router.get('/assigned-supervisors/:studentId', verifyToken, meetingRequestController.getAssignedSupervisors);

// Student cancelling their own request — only while it's still pending.
router.delete('/:id', verifyToken, meetingRequestController.deleteRequest);

module.exports = router;
