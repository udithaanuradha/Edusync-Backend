const express = require('express');
const router = express.Router();
const { getSupervisorGroups, getAllSupervisorGroups } = require('../controllers/groupDetailsToSupervisorDashboardController');

// Route to get all project groups for a specific supervisor at a specific level
router.get('/level/:level/supervisor/:supervisorId', getSupervisorGroups);

// Route to get all project groups for a specific supervisor across all levels
router.get('/supervisor/:supervisorId', getAllSupervisorGroups);

module.exports = router;
