const express = require('express');
const router = express.Router();
const backupController = require('../controllers/backupController');

// GET /api/backups
router.get('/', backupController.getAllBackups);

// POST /api/backups
router.post('/', backupController.createBackup);

module.exports = router;