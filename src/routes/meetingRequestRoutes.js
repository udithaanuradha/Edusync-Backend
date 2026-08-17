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

module.exports = router;
