const express = require('express');
const router = express.Router();
const {
    getStagesByLevel,
    getStageById,
    createStage,
    deleteStage,
    updateStage
} = require('../controllers/projectController');

router.get('/level/:level', getStagesByLevel);
router.get('/:id', getStageById);
router.post('/create', createStage);
router.put('/update/:id', updateStage);
router.delete('/delete/:id', deleteStage);

module.exports = router;