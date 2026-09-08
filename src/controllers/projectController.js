/**
 * Controller: Project stages and stage-file uploads
 * Contains handlers used by `src/routes/projectRoutes.js` and the upload endpoint
 */
const Project = require('../models/projectModel');
const { uploadBufferToCloudinary } = require('../config/cloudinaryConfig');

/**
 * GET /api/projects/level/:level
 * Returns all stages for the provided `level`.
 * If ?coordinatorId=X is provided, filters to only stages created by that coordinator
 * (coordinator's own management view — sees everything they created).
 * Otherwise, if ?academicUnit=X is provided, filters to stages scoped to that degree
 * program plus any legacy/global stage with no program scoping (student-facing view).
 */
// Marking Criteria is a staff-only rubric attachment — a coordinator
// uploads it, only coordinators/supervisors/admins should ever see it, and
// it must be stripped out of the JSON itself (not just hidden by the
// frontend) so a student's browser never receives it in the first place.
//
// This endpoint has no real authentication (see verifyToken in
// authMiddleware.js — it only checks that *some* bearer token was sent, the
// same self-reported-role trust model authorizeRole already uses elsewhere
// in this file), so "staff" here means the same thing it means for the rest
// of this app: the caller identifies itself as staff, either by making the
// coordinator's own management-view call (coordinatorId set) or by passing
// ?viewerRole=coordinator|supervisor|admin|lecturer. Anything else —
// including a plain student-facing call with no role at all — fails
// closed: the field comes out of the response entirely, not just as null.
const STAFF_ROLES = new Set(['coordinator', 'supervisor', 'admin', 'lecturer']);

const getStagesByLevel = (req, res) => {
    const level = req.params.level;
    const coordinatorId = req.query.coordinatorId; // Extract from query string
    const academicUnit = req.query.academicUnit;
    const viewerRole = String(req.query.viewerRole || '').trim().toLowerCase();

    Project.getStagesByLevel(level, coordinatorId, academicUnit, (err, results) => {
        if (err) return res.status(500).json({ success: false, error: err.message });

        const isStaffRequest = Boolean(coordinatorId) || STAFF_ROLES.has(viewerRole);
        const data = isStaffRequest
            ? results
            : results.map(({ marking_criteria_file, ...rest }) => rest);

        res.json({ success: true, data });
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
 * Optional stage payload fields such as `description`, `deadline`, and `resource_links`
 * are passed through to the model layer.
 * `user_role` is required for authorization checks in the controller.
 */
const createStage = (req, res) => {
    console.log('\n🔵 POST /api/projects/create received');
    console.log('   Request body:', JSON.stringify(req.body, null, 2));
    
    const { level, stage_name, created_by, user_role } = req.body;
    if (!level || !stage_name || !created_by) {
        console.log('   ❌ Missing required fields');
        return res.status(400).json({
            success: false,
            message: 'level, stage_name, and created_by are required'
        });
    }
    if (!user_role) {
        console.log('   ❌ Missing user_role');
        return res.status(400).json({
            success: false,
            message: 'user_role is required for authorization'
        });
    }

    // Delegate DB insert to the model layer
    Project.createStage(req.body, (err, result) => {
        if (err) {
            console.log('   ❌ Database error in createStage:');
            console.error('   Error code:', err.code);
            console.error('   Error message:', err.message);
            console.error('   Full error:', err);
            return res.status(500).json({ success: false, error: err.message, code: err.code });
        }
        console.log('   ✅ Stage created successfully with ID:', result.insertId);
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
 * Optional stage payload fields such as `resource_links` are passed through to the model layer.
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
const uploadStageFile = async (req, res) => {
    console.log('\n📤 Upload request received');
    console.log(`   req.file: ${req.file ? '✅ Present' : '❌ Missing'}`);
    console.log(`   req.body:`, req.body);
    if (req.file) {
        console.log('   req.file details:', {
            originalname: req.file.originalname,
            size: req.file.size,
            filename: req.file.filename,
        });
    }
    
    // `req.file` is created by the `upload.single('file')` multer middleware.
    if (!req.file) {
        console.error('❌ No file in request!');
        return res.status(400).json({ success: false, error: 'No file provided' });
    }

    const { stage_id, uploaded_by, file_category } = req.body;
    if (!stage_id) {
        console.error('❌ No stage_id provided!');
        return res.status(400).json({ success: false, error: 'stage_id is required' });
    }


    // File info from Cloudinary
    const fileName = req.file.originalname;
    const fileUrl = req.file.path; // Cloudinary URL (e.g., https://res.cloudinary.com/...)
    const uploaderId = uploaded_by ? parseInt(uploaded_by) : 1;

    try {
        const cloudFolder = process.env.CLOUDINARY_STAGE_FOLDER || 'student-submissions';
        const cloudResult = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname, cloudFolder);
        const fileUrl = cloudResult.secure_url || cloudResult.url || (cloudResult.public_id ? cloudinary.url(cloudResult.public_id, { resource_type: 'auto' }) : null);

        console.log(`✅ File received: ${req.file.originalname}`);
        console.log(`🔗 Cloudinary response:`, cloudResult);
        console.log(`🔗 Cloudinary file URL: ${fileUrl}`);

        if (!fileUrl) {
            throw new Error('Cloudinary upload succeeded but no URL was returned');
        }

        // Persist metadata via the model layer. `file_category` routes a
        // Marking Criteria upload onto project_stages.marking_criteria_file
        // instead of a new stage_files row — see ProjectModel.uploadStageFile.
        Project.uploadStageFile({
            stage_id,
            file_name: req.file.originalname,
            file_url: fileUrl,
            uploaded_by: uploaderId,
            file_category,
        }, (err, result) => {
            if (err) {
                console.error('❌ Database Error:', err.message);
                return res.status(500).json({ success: false, error: err.message });
            }
            // A marking_criteria UPDATE has no insertId (it's not an insert) —
            // file_id is simply omitted from the response in that case, which
            // is fine: the frontend only reads file_url for that upload path.
            console.log(`✅ File metadata saved to DB!${result.insertId ? ` File ID: ${result.insertId}` : ' (marking_criteria_file updated)'}`);
            res.status(201).json({
                success: true,
                message: 'File uploaded to Cloudinary successfully!',
                file_url: fileUrl,
                file_id: result.insertId
            });
        });
    } catch (uploadErr) {
        console.error('❌ Cloudinary upload failed:', uploadErr);
        return res.status(500).json({ success: false, error: uploadErr.message });
    }
};

/**
 * DELETE /api/projects/files/:file_id
 * Remove a single Supporting Document row. Used by the coordinator's Edit
 * Stage "Existing Documents" list — until this existed there was no way to
 * remove a file once uploaded.
 */
const deleteStageFile = (req, res) => {
    Project.deleteStageFile(req.params.file_id, (err, result) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (!result || result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'File not found.' });
        }
        res.json({ success: true, message: 'File deleted!' });
    });
};

/**
 * DELETE /api/projects/marking-criteria/:stage_id
 * Clear a stage's Marking Criteria file so a coordinator can remove or
 * replace one uploaded in error.
 */
const deleteMarkingCriteria = (req, res) => {
    Project.deleteMarkingCriteria(req.params.stage_id, (err) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, message: 'Marking Criteria file removed!' });
    });
};

module.exports = {
    getStagesByLevel,
    getStageById,
    createStage,
    deleteStage,
    updateStage,
    uploadStageFile,
    deleteStageFile,
    deleteMarkingCriteria,
};