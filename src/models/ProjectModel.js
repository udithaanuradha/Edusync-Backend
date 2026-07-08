const db = require('../config/db');

const getStagesByLevel = (level, coordinatorId, callback) => {
    // First get all stages for this level created by this coordinator
    let query = 'SELECT * FROM project_stages WHERE level = ?';
    let params = [level];
    
    // If coordinatorId is provided, filter by created_by
    if (coordinatorId) {
        query += ' AND created_by = ?';
        params.push(coordinatorId);
    }
    
    query += ' ORDER BY stage_id';
    
    db.query(query, params, (err, stages) => {
        if (err) return callback(err, null);
        
        // Then get all files for each stage
        if (stages.length === 0) return callback(null, []);
        
        const stageIds = stages.map(s => s.stage_id);
        db.query('SELECT * FROM stage_files WHERE stage_id IN (?) ORDER BY uploaded_at DESC', [stageIds], (err, files) => {
            if (err) {
                if (err.code === 'ER_NO_SUCH_TABLE') {
                    const stagesWithFiles = stages.map(stage => ({
                        ...stage,
                        files: []
                    }));
                    return callback(null, stagesWithFiles);
                }
                return callback(err, null);
            }

            // Attach files to their stages
            const stagesWithFiles = stages.map(stage => ({
                ...stage,
                files: files.filter(f => String(f.stage_id) === String(stage.stage_id))
            }));

            callback(null, stagesWithFiles);
        });
    });
};

const getStageById = (id, callback) => {
    db.query('SELECT * FROM project_stages WHERE stage_id = ?', [id], callback);
};

const createStage = (data, callback) => {
    const {
        level,
        stage_name,
        description,
        deadline,
        created_by,
        resource_links,
        resource_link,
        mentor_details_url,
    } = data;
    const linkValue = resource_links ?? resource_link ?? mentor_details_url ?? null;
    db.query(
        `INSERT INTO project_stages (level, stage_name, description, deadline, created_by, resource_links)
         VALUES (?, ?, ?, ?, ?, ?)` ,
        [level, stage_name, description, deadline || null, created_by, linkValue],
        callback
    );
};

const deleteStage = (id, callback) => {
    console.log("=== 1. Starting delete process for Stage ID:", id, "===");

    // First, try to delete the files
    db.query('DELETE FROM stage_files WHERE stage_id = ?', [id], (err, results) => {
        if (err) {
            console.log("❌ DB ERROR CAUGHT IN STAGE_FILES TABLE:");
            console.error(err); // <-- This will print the exact SQL error!
            return callback(err);
        }

        console.log("=== 2. Files deleted (or none existed). Now deleting the stage... ===");
        
        // Then, try to delete the stage itself
        db.query('DELETE FROM project_stages WHERE stage_id = ?', [id], (err2, results2) => {
            if (err2) {
                console.log("❌ DB ERROR CAUGHT IN PROJECT_STAGES TABLE:");
                console.error(err2); // <-- This will print the exact SQL error!
                return callback(err2);
            }
            
            console.log("✅ Stage successfully deleted from both tables!");
            callback(null, results2);
        });
    });
};

const updateStage = (id, data, callback) => {
    const { stage_name, description, deadline, resource_link, resource_links, mentor_details_url } = data;
    const linkValue = resource_links ?? resource_link ?? mentor_details_url ?? null;
    db.query(
        'UPDATE project_stages SET stage_name=?, description=?, deadline=?, resource_links=? WHERE stage_id=?',
        [stage_name, description, deadline || null, linkValue, id],
        callback
    );
};

const uploadStageFile = (data, callback) => {
    const { stage_id, file_name, file_url, uploaded_by } = data;
    db.query(
        'INSERT INTO stage_files (stage_id, file_name, file_url, uploaded_by) VALUES (?, ?, ?, ?)',
        [stage_id, file_name, file_url, uploaded_by],
        callback
    );
};

module.exports = { getStagesByLevel, getStageById, createStage, deleteStage, updateStage, uploadStageFile };