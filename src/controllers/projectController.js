/**
 * Controller: Project stages and stage-file uploads
 * Contains handlers used by `src/routes/projectRoutes.js` and the upload endpoint
 */
const Project = require('../models/projectModel');

/**
 * GET /api/projects/level/:level
 * Returns all stages for the provided `level`.
 */
const getStagesByLevel = (req, res) => {
    Project.getStagesByLevel(req.params.level, (err, results) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: results });
    });
};

/**
 * GET /api/projects/:id
 * Return a single stage by its id. Responds 404 if not found.
 */
const getStageById = (req, res) => {
    Project.getStageById(req.params.id, (err, result) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (!result.length) return res.status(404).json({ success: false, message: 'Stage not found' });
        res.json({ success: true, data: result[0] });
    });
};

/**
 * POST /api/projects/create
 * Create a new project stage. Required fields: `level`, `stage_name`, `created_by`.
 * `user_role` is required for authorization checks in the controller.
 */
const createStage = (req, res) => {
    const { level, stage_name, created_by, user_role } = req.body;
    if (!level || !stage_name || !created_by) {
        return res.status(400).json({
            success: false,
            message: 'level, stage_name, and created_by are required'
        });
    }
    if (!user_role) {
        return res.status(400).json({
            success: false,
            message: 'user_role is required for authorization'
        });
    }

    // Delegate DB insert to the model layer
    Project.createStage(req.body, (err, result) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.status(201).json({ success: true, message: 'Stage created!', id: result.insertId });
    });
};

/**
 * DELETE /api/projects/delete/:id
 * Remove a stage by id.
 */
const deleteStage = (req, res) => {
    Project.deleteStage(req.params.id, (err) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, message: 'Stage deleted!' });
    });
};

/**
 * PUT /api/projects/update/:id
 * Update a stage's fields. Authorization can be applied at the route.
 */
const updateStage = (req, res) => {
    Project.updateStage(req.params.id, req.body, (err) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, message: 'Stage updated!' });
    });
};

/**
 * POST /api/projects/upload-file
 * Upload a file for a stage using the Cloudinary-backed middleware.
 * The file is saved to Cloudinary by middleware, then metadata is written to DB.
 */
const uploadStageFile = (req, res) => {
    console.log('\n📤 Upload request received');
    console.log(`   req.file: ${req.file ? '✅ Present' : '❌ Missing'}`);
    console.log(`   req.body:`, req.body);
    
    // `req.file` is created by the `upload.single('file')` multer middleware.
    if (!req.file) {
        console.error('❌ No file in request!');
        return res.status(400).json({ success: false, error: 'No file provided' });
    }

    const { stage_id, uploaded_by } = req.body;
    if (!stage_id) {
        console.error('❌ No stage_id provided!');
        return res.status(400).json({ success: false, error: 'stage_id is required' });
    }

    // File info provided by Cloudinary middleware
    const fileName = req.file.originalname;
    const fileUrl = req.file.path; // Cloudinary URL (e.g., https://res.cloudinary.com/...)
    const uploaderId = uploaded_by ? parseInt(uploaded_by) : 1;

    console.log(`✅ File received: ${fileName}`);
    console.log(`📍 File details:`, {
        originalname: req.file.originalname,
        size: req.file.size,
        path: req.file.path,
        filename: req.file.filename
    });
    console.log(`🔗 Cloudinary URL: ${fileUrl}`);

    // Persist metadata via the model layer
    Project.uploadStageFile({ 
        stage_id, 
        file_name: fileName, 
        file_url: fileUrl, 
        uploaded_by: uploaderId 
    }, (err, result) => {
        if (err) {
            console.error('❌ Database Error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
        console.log(`✅ File metadata saved to DB! File ID: ${result.insertId}`);
        res.status(201).json({ 
            success: true, 
            message: 'File uploaded to Cloudinary successfully!', 
            file_url: fileUrl, 
            file_id: result.insertId 
        });
    });
};

module.exports = { getStagesByLevel, getStageById, createStage, deleteStage, updateStage, uploadStageFile };