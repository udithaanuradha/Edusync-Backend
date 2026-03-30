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
    const { stage_id, file_name, file_url, uploaded_by } = req.body;
    if (!stage_id || !file_name || !file_url || !uploaded_by) {
        return res.status(400).json({
            success: false,
            message: 'stage_id, file_name, file_url, and uploaded_by are required'
        });
    }
    Project.uploadStageFile({ stage_id, file_name, file_url, uploaded_by }, (err, result) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.status(201).json({ success: true, message: 'File uploaded!', file_id: result.insertId });
    });
};

module.exports = { getStagesByLevel, getStageById, createStage, deleteStage, updateStage, uploadStageFile };