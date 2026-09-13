const db = require('../config/db');
const dbPromise = db.promise();

// Students sign up choosing a degree program from {AI, IT, ITM}; lecturers/
// coordinators sign up choosing a department from {IT, IDS, CM} — for the
// *same* real-world program these are different raw codes (IDS == ITM,
// CM == AI; see SignUpPage.tsx's two option lists and the equivalent mapping
// already used for display in AdminLevelPage.tsx's getDegreeNameFromAcademicUnit).
// Comparing academic_unit values for stage visibility must normalize both
// sides through this same mapping, or every coordinator-created stage in the
// ITM/AI programs is invisible to students in that same program.
const normalizeAcademicUnit = (unit) => {
    if (!unit) return null;
    const clean = String(unit).trim().toUpperCase();
    if (clean === 'IDS' || clean === 'ITM') return 'ITM';
    if (clean === 'CM' || clean === 'AI') return 'AI';
    if (clean === 'IT') return 'IT';
    return clean;
};

// `project_stages` predates the notion of scoping a stage to a degree
// program — it only ever had `level`. Self-heal the column the same way
// groupController's ensureRequestLifecycleColumns does, so this doesn't
// depend on a separate migration step having been run against every
// environment (see checked-in migrations/*.sql for the standalone version).
let ensureStageAcademicUnitColumnPromise = null;
const ensureStageAcademicUnitColumn = async () => {
    if (!ensureStageAcademicUnitColumnPromise) {
        ensureStageAcademicUnitColumnPromise = (async () => {
            try {
                const [columns] = await dbPromise.query('SHOW COLUMNS FROM project_stages');
                const hasColumn = (columns || []).some((column) => column.Field === 'academic_unit');
                if (!hasColumn) {
                    // NULL = visible to every program (existing stages keep their
                    // current global visibility; only new stages get scoped).
                    await dbPromise.query(`ALTER TABLE project_stages ADD COLUMN academic_unit VARCHAR(50) DEFAULT NULL`);
                }
            } catch (error) {
                console.warn('project_stages academic_unit column check failed:', error.message);
            }
        })();
    }
    await ensureStageAcademicUnitColumnPromise;
};

// Same self-heal pattern as ensureStageAcademicUnitColumn above, for the
// staff-only Marking Criteria rubric path (see migrations/add-marking-criteria-file.sql
// for the standalone version). A separate column rather than a stage_files
// row: a stage has at most one rubric, it's coordinator-set metadata on the
// stage itself, and — critically — it must never surface in the same list
// the student view reads (stage_files), only through this dedicated column
// which getStagesByLevel's controller strips for non-staff callers.
let ensureStageMarkingCriteriaColumnPromise = null;
const ensureStageMarkingCriteriaColumn = async () => {
    if (!ensureStageMarkingCriteriaColumnPromise) {
        ensureStageMarkingCriteriaColumnPromise = (async () => {
            try {
                const [columns] = await dbPromise.query('SHOW COLUMNS FROM project_stages');
                const hasColumn = (columns || []).some((column) => column.Field === 'marking_criteria_file');
                if (!hasColumn) {
                    await dbPromise.query(`ALTER TABLE project_stages ADD COLUMN marking_criteria_file TEXT DEFAULT NULL`);
                }
            } catch (error) {
                console.warn('project_stages marking_criteria_file column check failed:', error.message);
            }
        })();
    }
    await ensureStageMarkingCriteriaColumnPromise;
};

const getStagesByLevel = (level, coordinatorId, academicUnit, callback) => {
    if (typeof academicUnit === 'function') {
        callback = academicUnit;
        academicUnit = null;
    }
    if (typeof coordinatorId === 'function') {
        callback = coordinatorId;
        coordinatorId = null;
        academicUnit = null;
    }

    Promise.all([ensureStageAcademicUnitColumn(), ensureStageMarkingCriteriaColumn()]).then(() => {
    // First get all stages for this level created by this coordinator
    // NOTE: `u.academic_unit` is deliberately left unaliased and placed after
    // `ps.*` so it keeps winning the `academic_unit` key in the result object
    // exactly as before (AdminLevelPage.tsx reads stage.academic_unit expecting
    // the *creator's* department) — `ps.academic_unit` (the new stage-scoping
    // column) is only referenced inside the WHERE filter below, never selected
    // under its own name, so no existing consumer sees a behavior change.
    let query = `
        SELECT ps.*, u.name AS creator_name, u.academic_unit, u.role AS creator_role, u.designation AS creator_designation
        FROM project_stages ps
        LEFT JOIN users u ON ps.created_by = u.id
        WHERE ps.level = ?
    `;
    let params = [level];

    // Coordinator managing their own stages sees everything they created,
    // regardless of program.
    if (coordinatorId) {
        query += ' AND ps.created_by = ?';
        params.push(coordinatorId);
    } else if (academicUnit) {
        // Student-facing call: only their own program's stages, plus any
        // legacy/global stage (academic_unit IS NULL) created before this
        // scoping existed. Both sides are normalized so a coordinator's
        // 'IDS'/'CM' department code matches a student's 'ITM'/'AI' program.
        query += ' AND (ps.academic_unit IS NULL OR ps.academic_unit = ?)';
        params.push(normalizeAcademicUnit(academicUnit));
    }

    query += ' ORDER BY ps.stage_id';

    db.query(query, params, (err, stages) => {
        if (err) return callback(err, null);

        // Then get all files for each stage
        if (stages.length === 0) return callback(null, []);
        
        const stageIds = stages.map(s => s.stage_id);
        const fileQuery = `
            SELECT sf.*, u.name AS uploader_name, u.academic_unit, u.role AS uploader_role, u.designation AS uploader_designation
            FROM stage_files sf
            LEFT JOIN users u ON sf.uploaded_by = u.id
            WHERE sf.stage_id IN (?)
            ORDER BY sf.uploaded_at DESC
        `;
        db.query(fileQuery, [stageIds], (err, files) => {
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
    }).catch((err) => callback(err, null));
};

const getStageById = (id, callback) => {
    db.query('SELECT * FROM project_stages WHERE stage_id = ?', [id], callback);
};

// A cleared link field can arrive as a whitespace-only string rather than ''
// (e.g. a stray leftover space after backspacing/selecting), which is
// truthy in JS — `linkValue ?? null` alone lets it through, gets stored as-is,
// and then `stage.resource_links && (...)` on the frontend still renders the
// "View attached resource" link, making the field look impossible to clear.
// Trim first so whitespace-only collapses to null same as a fully empty value.
const normalizeLinkValue = (value) => {
    const trimmed = typeof value === 'string' ? value.trim() : value;
    return trimmed || null;
};

// Thrown by the duplicate-name checks below; callers key off `.code` rather
// than the message text so the controller can map it to a 409 instead of a
// generic 500.
class DuplicateStageNameError extends Error {
    constructor(stageName) {
        super(`A stage named "${stageName}" already exists for this level.`);
        this.code = 'DUPLICATE_STAGE_NAME';
    }
}

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
    const linkValue = normalizeLinkValue(resource_links ?? resource_link ?? mentor_details_url ?? null);
    const trimmedStageName = String(stage_name || '').trim();

    ensureStageAcademicUnitColumn().then(() => {
        // Belt-and-braces against the same duplicate the frontend already
        // blocks in StageManagement.tsx's handleAddStage — a direct API call
        // (or a second tab) bypasses that client-side check entirely, and
        // two stages sharing a name at the same level makes the Calendar's
        // Evaluation Type dropdown, marks linking, and final-grade totals
        // ambiguous about which stage's data actually applies. Scoped to the
        // same (level, created_by) pair the coordinator's own stage list is
        // scoped to, so this never conflicts with another coordinator's
        // identically-named stage.
        db.query(
            'SELECT stage_id FROM project_stages WHERE level = ? AND created_by = ? AND LOWER(TRIM(stage_name)) = LOWER(TRIM(?))',
            [level, created_by, trimmedStageName],
            (dupErr, dupRows) => {
                if (dupErr) return callback(dupErr, null);
                if (dupRows && dupRows.length > 0) {
                    return callback(new DuplicateStageNameError(trimmedStageName), null);
                }

                // Scope the stage to its creating coordinator's own degree program, so
                // students in other programs at the same level don't see it (see
                // getStagesByLevel's academicUnit filter). Falls back to NULL (visible
                // to everyone) if the creator has no academic_unit set, matching how
                // pre-existing stages behave.
                db.query('SELECT academic_unit FROM users WHERE id = ?', [created_by], (lookupErr, rows) => {
                    if (lookupErr) return callback(lookupErr, null);
                    const academicUnit = normalizeAcademicUnit(rows && rows[0] ? rows[0].academic_unit : null);

                    db.query(
                        `INSERT INTO project_stages (level, stage_name, description, deadline, created_by, resource_links, academic_unit)
                         VALUES (?, ?, ?, ?, ?, ?, ?)` ,
                        [level, stage_name, description, deadline || null, created_by, linkValue, academicUnit],
                        callback
                    );
                });
            }
        );
    }).catch((err) => callback(err, null));
};

const deleteStage = (id, callback) => {
    console.log("=== 1. Starting delete process for Stage ID:", id, "===");

    // stage_files and student_submissions both cascade on stage_id automatically
    // (fk_sf_stage / fk_submission_stage, ON DELETE CASCADE) — the explicit
    // stage_files delete below is just belt-and-braces. `marks.stage_id`
    // (fk_mark_stage) does NOT cascade though, so any stage that already has
    // evaluation marks recorded against it must have them cleared first, or
    // the final delete fails with ER_ROW_IS_REFERENCED_2 (same class of bug
    // as groupController.deleteGroup had for fk_mark_group).
    db.query('DELETE FROM marks WHERE stage_id = ?', [id], (marksErr) => {
        if (marksErr) {
            console.log("❌ DB ERROR CAUGHT IN MARKS TABLE:");
            console.error(marksErr);
            return callback(marksErr);
        }

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
    });
};

const updateStage = (id, data, callback) => {
    const { stage_name, description, deadline, resource_link, resource_links, mentor_details_url } = data;
    const linkValue = normalizeLinkValue(resource_links ?? resource_link ?? mentor_details_url ?? null);
    const trimmedStageName = String(stage_name || '').trim();

    // The request body only ever carries the edited fields, not this stage's
    // own level/creator — those are looked up here rather than trusted from
    // the client, then used to scope the same duplicate-name check
    // createStage runs, excluding this stage's own row so re-saving it under
    // its unchanged name doesn't flag against itself.
    db.query('SELECT level, created_by FROM project_stages WHERE stage_id = ?', [id], (lookupErr, rows) => {
        if (lookupErr) return callback(lookupErr, null);
        if (!rows || rows.length === 0) {
            return callback(new Error('Stage not found'), null);
        }
        const { level, created_by } = rows[0];

        db.query(
            'SELECT stage_id FROM project_stages WHERE level = ? AND created_by = ? AND stage_id != ? AND LOWER(TRIM(stage_name)) = LOWER(TRIM(?))',
            [level, created_by, id, trimmedStageName],
            (dupErr, dupRows) => {
                if (dupErr) return callback(dupErr, null);
                if (dupRows && dupRows.length > 0) {
                    return callback(new DuplicateStageNameError(trimmedStageName), null);
                }

                db.query(
                    'UPDATE project_stages SET stage_name=?, description=?, deadline=?, resource_links=? WHERE stage_id=?',
                    [stage_name, description, deadline || null, linkValue, id],
                    callback
                );
            }
        );
    });
};

const uploadStageFile = (data, callback) => {
    const { stage_id, file_name, file_url, uploaded_by, file_category } = data;

    if (file_category === 'marking_criteria') {
        // Staff-only rubric: overwrite the single column on the stage
        // itself. Deliberately NOT inserted into stage_files — that table
        // backs the Supporting Documents list the student view also reads
        // from (see stage_files SELECT in getStagesByLevel above), and a
        // rubric must never end up there.
        ensureStageMarkingCriteriaColumn().then(() => {
            db.query(
                'UPDATE project_stages SET marking_criteria_file = ? WHERE stage_id = ?',
                [file_url, stage_id],
                callback
            );
        }).catch((err) => callback(err, null));
        return;
    }

    db.query(
        'INSERT INTO stage_files (stage_id, file_name, file_url, uploaded_by) VALUES (?, ?, ?, ?)',
        [stage_id, file_name, file_url, uploaded_by],
        callback
    );
};

// DELETE /api/projects/files/:file_id — removes one Supporting Document row.
const deleteStageFile = (fileId, callback) => {
    db.query('DELETE FROM stage_files WHERE file_id = ?', [fileId], callback);
};

// DELETE /api/projects/marking-criteria/:stage_id — clears a stage's rubric
// so a coordinator can remove or replace one that was uploaded in error.
const deleteMarkingCriteria = (stageId, callback) => {
    ensureStageMarkingCriteriaColumn().then(() => {
        db.query('UPDATE project_stages SET marking_criteria_file = NULL WHERE stage_id = ?', [stageId], callback);
    }).catch((err) => callback(err, null));
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