const express = require('express');
const router = express.Router();
const {
    getStagesByLevel,
    getStageById,
    createStage,
    deleteStage,
    updateStage
} = require('../controllers/projectController');
const { verifyToken, authorizeRole } = require('../middleware/authMiddleware');

router.get('/level/:level', getStagesByLevel);
router.get('/:id', getStageById);
router.post('/create', createStage);  // No auth for now - can be added back later
router.put('/update/:id', verifyToken, authorizeRole(['admin', 'instructor', 'faculty']), updateStage);
router.delete('/delete/:id', deleteStage);  // No auth for now - can be added back later
// Note: POST /upload-file route handled in index.js with Multer middleware

module.exports = router;