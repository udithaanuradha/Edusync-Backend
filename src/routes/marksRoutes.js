const express = require('express');
const router = express.Router();
const {
  getStageMarks,
  submitMarks,
  getCoordinatorSubmissionTracking,
} = require('../controllers/marksController');

// GET request for fetching the Gradebook data
router.get('/stage-marks', getStageMarks);
router.get('/level/:level', getCoordinatorSubmissionTracking);

// POST request for supervisors to submit new marks
router.post('/submit', submitMarks);

module.exports = router;