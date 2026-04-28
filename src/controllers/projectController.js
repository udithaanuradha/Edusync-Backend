const Project = require('../models/projectModel');

const getStagesByLevel = (req, res) => {
    Project.getStagesByLevel(req.params.level, (err, results) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: results });
    });
};

const getStageById = (req, res) => {
    Project.getStageById(req.params.id, (err, result) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (!result.length) return res.status(404).json({ success: false, message: 'Stage not found' });
        res.json({ success: true, data: result[0] });
    });
};

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
    Project.createStage(req.body, (err, result) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.status(201).json({ success: true, message: 'Stage created!', id: result.insertId });
    });
};

const deleteStage = (req, res) => {
    Project.deleteStage(req.params.id, (err) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, message: 'Stage deleted!' });
    });
};

const updateStage = (req, res) => {
    Project.updateStage(req.params.id, req.body, (err) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, message: 'Stage updated!' });
    });
};

const uploadStageFile = (req, res) => {
    console.log('\n📤 Upload request received');
    console.log(`   req.file: ${req.file ? '✅ Present' : '❌ Missing'}`);
    console.log(`   req.body:`, req.body);
    
    // req.file is created by the upload.single('file') middleware (Cloudinary storage)
    if (!req.file) {
        console.error('❌ No file in request!');
        return res.status(400).json({ success: false, error: 'No file provided' });
    }

    const { stage_id, uploaded_by } = req.body;
    
    if (!stage_id) {
        console.error('❌ No stage_id provided!');
        return res.status(400).json({ success: false, error: 'stage_id is required' });
    }

    // Fetches project stages by level while restricting industry mentors from accessing Level 1 content.
    const getStagesByLevel = (req, res) => {
    const { level } = req.params;
    const { user_role } = req.body; // Or get this from your auth token/middleware

    // Specifically block Mentors from Level 1, but allow 2, 3, and 4
    if (level == 1 && user_role === 'mentor') {
        return res.status(403).json({ 
            success: false, 
            message: "Industry mentors are not assigned to Level 1 stages." 
        });
    }

    Project.getStagesByLevel(level, (err, results) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: results });
    });
};

    // File info from Cloudinary
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