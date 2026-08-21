const express = require('express');
const router = express.Router();
const {
  getStageMarks,
  submitMarks,
  getCoordinatorSubmissionTracking,
  getLevelMarksSummary,
  downloadMarksDistributionPdf,
} = require('../controllers/marksController');

// Gradebook and level marks
router.get('/stage-marks', getStageMarks);
router.get('/level/:level', getCoordinatorSubmissionTracking);
router.get('/summary/level/:level', getLevelMarksSummary);
router.get('/report/level/:level/pdf', downloadMarksDistributionPdf);

// Submit marks
router.post('/submit', submitMarks);

module.exports = router;
