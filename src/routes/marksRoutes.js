const express = require('express');
const router = express.Router();
const { getStageMarks, submitMarks } = require('../controllers/marksController');

// GET request for fetching the Gradebook data
router.get('/stage-marks', getStageMarks);

// POST request for supervisors to submit new marks
router.post('/submit', submitMarks);

module.exports = router;