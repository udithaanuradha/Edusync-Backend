const express = require('express');
const router = express.Router();
const { 
  getPanelsByDateAndEvaluator, 
  getStudentsForPanel,
  checkEvaluatorStatus // 👈 1. Controller එකෙන් import කරගන්න
} = require('../controllers/evaluationPanelController');

// 💡 Auth Middleware එකක් තිබේ නම් Import කරගන්න (e.g., const authMiddleware = require('../middleware/auth');)

// Existing Routes
router.get('/by-date', getPanelsByDateAndEvaluator);
router.get('/panel-students/:panelId', getStudentsForPanel);

// 🎯 2. අලුතෙන් එකතු කළ යුතු Route එක (Level-specific check)
router.get('/check-evaluator', checkEvaluatorStatus);

module.exports = router;