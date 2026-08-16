const express = require('express');
const router = express.Router();

const { getCoordinatorSummary, getStudentSummary } = require('../controllers/dashboardController');

router.get('/coordinator/summary', getCoordinatorSummary);
router.get('/student/summary/:studentId', getStudentSummary);

module.exports = router;