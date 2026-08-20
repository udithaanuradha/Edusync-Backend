const express = require('express');
const router = express.Router();
const { getGroupsProgress, getGroupProgressDetail } = require('../controllers/superviceStProgressController');

// Groups (with rolled-up task-completion progress) a supervisor owns at a given level
router.get('/level/:level/supervisor/:supervisorId', getGroupsProgress);

// Drill-down for one group: overall + per-milestone + per-student progress
router.get('/group/:groupId', getGroupProgressDetail);

module.exports = router;
