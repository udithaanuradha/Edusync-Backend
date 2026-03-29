const db = require('../config/db');

const getStagesByLevel = (level, callback) => {
    db.query('SELECT * FROM project_stages WHERE level = ? ORDER BY stage_id', [level], callback);
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

module.exports = { getStagesByLevel, getStageById, createStage, deleteStage, updateStage };