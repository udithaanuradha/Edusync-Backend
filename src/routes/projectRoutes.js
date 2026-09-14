const express = require('express');
const router = express.Router();
const {
    getStagesByLevel,
    getStageById,
    createStage,
    deleteStage,
    updateStage,
    deleteStageFile,
    deleteMarkingCriteria
} = require('../controllers/projectController');
const { verifyToken, authorizeRole } = require('../middleware/authMiddleware');

// Routes for project stages. The frontend should call these under the
// API base (e.g. http://localhost:5000/api/projects).

// GET /api/projects/level/:level -> list stages for a level
router.get('/level/:level', getStagesByLevel);

// GET /api/projects/:id -> single stage details
router.get('/:id', getStageById);

// POST /api/projects/create -> create a new stage
// (No auth applied here; add middleware if you require authenticated creation)
router.post('/create', createStage);

// PUT /api/projects/update/:id -> update a stage (protected route)
router.put('/update/:id', verifyToken, authorizeRole(['admin', 'instructor', 'faculty', 'coordinator']), updateStage);

// DELETE /api/projects/delete/:id -> delete a stage
router.delete('/delete/:id', deleteStage);

// DELETE /api/projects/files/:file_id -> remove a single Supporting Document
// DELETE /api/projects/marking-criteria/:stage_id -> clear a stage's rubric
// Same protection level as PUT /update/:id (a bearer token is required, and
// the caller must self-report an allowed user_role in the request body).
router.delete('/files/:file_id', verifyToken, authorizeRole(['admin', 'instructor', 'faculty', 'coordinator']), deleteStageFile);
router.delete('/marking-criteria/:stage_id', verifyToken, authorizeRole(['admin', 'instructor', 'faculty', 'coordinator']), deleteMarkingCriteria);

// Note: `POST /api/projects/upload-file` is handled directly in index.js
// because it requires multer/cloudinary middleware. The `uploadStageFile`
// controller is used as the final handler.

module.exports = router;