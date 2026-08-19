const express = require('express');
const router = express.Router();
const { 
  getPanelsByEvaluator, 
  getStudentsForPanel,
  checkEvaluatorStatus,
  getMyAssignedGroups,
  submitEvaluationMarks
} = require('../controllers/evaluationPanelController');

// Existing Routes
router.get('/by-date', getPanelsByEvaluator);
router.get('/panel-students/:panelId', getStudentsForPanel);
router.get('/check-evaluator', checkEvaluatorStatus);

// Evaluation panel workflow routes
router.get('/my-groups', getMyAssignedGroups);
router.post('/submit-marks', submitEvaluationMarks);

module.exports = router;
