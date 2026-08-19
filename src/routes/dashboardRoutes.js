const express = require('express');
const router = express.Router();

const { getCoordinatorSummary, getStudentSummary, getMentorSummary } = require('../controllers/dashboardController');

router.get('/coordinator/summary', getCoordinatorSummary);
router.get('/student/summary/:studentId', getStudentSummary);
router.get('/mentor/summary/:mentorId', getMentorSummary);
router.get('/mentor/summary', getMentorSummary);

module.exports = router;