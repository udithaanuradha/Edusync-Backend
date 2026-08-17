const express = require('express');
const router = express.Router();
const { getSupervisorGroups } = require('../controllers/groupDetailsToSupervisorDashboardController');

// Route to get all project groups for a specific supervisor at a specific level
router.get('/level/:level/supervisor/:supervisorId', getSupervisorGroups);

module.exports = router;
