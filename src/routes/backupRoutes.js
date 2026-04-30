const express = require('express');
const router = express.Router();
const backupController = require('../controllers/backupController');

router.get('/', backupController.getAllBackups);
router.post('/', backupController.createBackup);
router.put('/:id', backupController.updateBackup);    // ✅ NEW
router.delete('/:id', backupController.deleteBackup); // ✅ NEW

module.exports = router;