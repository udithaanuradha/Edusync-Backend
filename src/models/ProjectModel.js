const db = require('../config/db');

const getStagesByLevel = (level, callback) => {
    // First get all stages for this level
    db.query('SELECT * FROM project_stages WHERE level = ? ORDER BY stage_id', [level], (err, stages) => {
        if (err) return callback(err, null);
        
        // Then get all files for each stage
        if (stages.length === 0) return callback(null, []);
        
        const stageIds = stages.map(s => s.stage_id);
        db.query('SELECT * FROM files WHERE stage_id IN (?) ORDER BY uploaded_at DESC', [stageIds], (err, files) => {
            if (err) return callback(err, null);
            
            // Attach files to their stages
            const stagesWithFiles = stages.map(stage => ({
                ...stage,
                files: files.filter(f => f.stage_id === stage.stage_id)
            }));
            
            callback(null, stagesWithFiles);
        });
    });
};

const getStageById = (id, callback) => {
    db.query('SELECT * FROM project_stages WHERE stage_id = ?', [id], callback);
};

const createStage = (data, callback) => {
    const { level, stage_name, description, deadline, created_by } = data;
    db.query(
        `INSERT INTO project_stages (level, stage_name, description, deadline, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [level, stage_name, description, deadline || null, created_by],
        callback
    );
};

const deleteStage = (id, callback) => {
    db.query('DELETE FROM project_stages WHERE stage_id = ?', [id], callback);
};

const updateStage = (id, data, callback) => {
    const { stage_name, description, deadline } = data;
    db.query(
        'UPDATE project_stages SET stage_name=?, description=?, deadline=? WHERE stage_id=?',
        [stage_name, description, deadline || null, id],
        callback
    );
};

const uploadStageFile = (data, callback) => {
    const { stage_id, file_name, file_url, uploaded_by } = data;
    db.query(
        'INSERT INTO files (stage_id, file_name, file_url, uploaded_by) VALUES (?, ?, ?, ?)',
        [stage_id, file_name, file_url, uploaded_by],
        callback
    );
};

module.exports = { getStagesByLevel, getStageById, createStage, deleteStage, updateStage, uploadStageFile };