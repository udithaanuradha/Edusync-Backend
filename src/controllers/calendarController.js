/**
 * Calendar controller
 * Contains handlers for scheduling evaluation panels and managing frozen dates.
 * Routes are mounted under `/api/calendar` in index.js.
 */
const db = require('../config/db');
const dbPromise = db.promise();

// Students choose a degree program from {AI, IT, ITM} at signup; lecturers
// and coordinators choose a department from {IT, IDS, CM} — for the same
// real-world program these are different raw codes (IDS==ITM, CM==AI; see
// groupController.js's getCoordinatorApprovedRequests and
// marksController.js's normalizeAcademicUnit for the same mapping).
const normalizeAcademicUnit = (unit) => {
    const clean = String(unit || '').trim().toUpperCase();
    if (clean === 'IDS' || clean === 'ITM') return 'ITM';
    if (clean === 'CM' || clean === 'AI') return 'AI';
    if (clean === 'IT') return 'IT';
    return clean || null;
};

// Resolves both the department AND the level a coordinatorId is actually
// assigned to, straight from their own users row — never trusts either
// value from the client directly. Returns null (no restriction) if the id
// is missing/unknown. App.tsx lets a coordinator browse any
// /dashboard/level-N page now — this is the actual access boundary: a
// coordinator only ever sees panels for their own department at their own
// level, regardless of which level's Calendar page they're looking at (this
// endpoint isn't itself scoped to one level — it feeds the whole calendar).
const getCoordinatorScope = async (coordinatorId) => {
    if (!coordinatorId) return null;
    try {
        const [rows] = await dbPromise.query('SELECT academic_unit, level FROM users WHERE id = ?', [coordinatorId]);
        if (rows.length === 0) return null;
        return {
            department: normalizeAcademicUnit(rows[0].academic_unit),
            level: rows[0].level != null ? Number(rows[0].level) : null,
        };
    } catch (error) {
        console.warn('getCoordinatorScope lookup failed:', error.message);
        return null;
    }
};

// Resolves the group a student actually belongs to (their own row in
// project_group_members joined to project_groups), so their Calendar can be
// scoped to just their own group's panels instead of reusing
// getCoordinatorScope — that one resolves department/level off the users
// table, which for a student is their own personal academic_unit/level, not
// their group's. Returns null (no group / unknown id) so callers can fall
// back to "no restriction" the same way getCoordinatorScope does.
const getStudentGroupScope = async (studentId) => {
    if (!studentId) return null;
    try {
        const [rows] = await dbPromise.query(
            `SELECT pg.group_name, pg.level, pg.department
             FROM project_group_members gm
             JOIN project_groups pg ON pg.id = gm.group_id
             WHERE gm.student_id = ?
             ORDER BY gm.created_at DESC
             LIMIT 1`,
            [studentId],
        );
        if (rows.length === 0) return null;
        return {
            groupName: rows[0].group_name,
            level: rows[0].level != null ? Number(rows[0].level) : null,
            department: normalizeAcademicUnit(rows[0].department),
        };
    } catch (error) {
        console.warn('getStudentGroupScope lookup failed:', error.message);
        return null;
    }
};

// `evaluation_panels` has no concept of completion — a panel only ever
// leaves the coordinator's calendar once its date is in the past, or it's
// manually deleted, even after the evaluation it covers is actually done.
// This column plus getUpcomingPanels' `status != 'completed'` filter below
// are groundwork for that: nothing sets a panel to 'completed' yet — that
// still needs a real trigger (e.g. a coordinator "finalize marks" action),
// which hasn't been built. Self-heals the same way ProjectModel's
// ensureStageAcademicUnitColumn does.
let ensureEvaluationPanelStatusColumnPromise = null;
const ensureEvaluationPanelStatusColumn = async () => {
    if (!ensureEvaluationPanelStatusColumnPromise) {
        ensureEvaluationPanelStatusColumnPromise = (async () => {
            try {
                const [columns] = await dbPromise.query('SHOW COLUMNS FROM evaluation_panels');
                const hasColumn = (columns || []).some((column) => column.Field === 'status');
                if (!hasColumn) {
                    await dbPromise.query(`ALTER TABLE evaluation_panels ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'scheduled'`);
                }
            } catch (error) {
                console.warn('evaluation_panels status column check failed:', error.message);
            }
        })();
    }
    await ensureEvaluationPanelStatusColumnPromise;
};

// CalendarPage.tsx's schedule drawer sends meetingLink/notes/kind and expects
// to read them back (row.meeting_link, row.notes, row.kind — see
// normalizePanelFromApi), but the table never had columns for them and
// scheduleEvaluationPanel silently dropped all three. Self-heals the same
// way ensureEvaluationPanelStatusColumn does.
let ensureEvaluationPanelMeetingColumnsPromise = null;
const ensureEvaluationPanelMeetingColumns = async () => {
    if (!ensureEvaluationPanelMeetingColumnsPromise) {
        ensureEvaluationPanelMeetingColumnsPromise = (async () => {
            try {
                const [columns] = await dbPromise.query('SHOW COLUMNS FROM evaluation_panels');
                const fields = new Set((columns || []).map((column) => column.Field));

                if (!fields.has('meeting_link')) {
                    await dbPromise.query(`ALTER TABLE evaluation_panels ADD COLUMN meeting_link VARCHAR(500) NULL`);
                }
                if (!fields.has('notes')) {
                    await dbPromise.query(`ALTER TABLE evaluation_panels ADD COLUMN notes TEXT NULL`);
                }
                if (!fields.has('kind')) {
                    await dbPromise.query(`ALTER TABLE evaluation_panels ADD COLUMN kind VARCHAR(100) NOT NULL DEFAULT 'Coordinator scheduled panel'`);
                }
            } catch (error) {
                console.warn('evaluation_panels meeting/notes/kind column check failed:', error.message);
            }
        })();
    }
    await ensureEvaluationPanelMeetingColumnsPromise;
};

// `evaluators` has always held the FULL panel roster (group supervisor(s)
// plus any additional evaluators the coordinator picks) — every existing
// "am I on this panel?" lookup (getPanelsByEvaluator, checkEvaluatorStatus,
// getMyAssignedGroups) matches against it with a plain LIKE, and every
// existing display (SupervisorEvaluationPanel's "Panel Evaluators" pill,
// CoordinatorReportInner, StudentMarks) reads it as the complete list.
// `supervisors` is purely additive metadata: the subset of `evaluators` that
// are the group's actual assigned supervisor(s), auto-detected by
// CalendarPage.tsx from the selected group rather than hand-picked, so the
// UI can badge them separately without touching any of that existing
// matching/display logic. Self-heals the same way
// ensureEvaluationPanelMeetingColumns does.
let ensureEvaluationPanelSupervisorsColumnPromise = null;
const ensureEvaluationPanelSupervisorsColumn = async () => {
    if (!ensureEvaluationPanelSupervisorsColumnPromise) {
        ensureEvaluationPanelSupervisorsColumnPromise = (async () => {
            try {
                const [columns] = await dbPromise.query('SHOW COLUMNS FROM evaluation_panels');
                const hasColumn = (columns || []).some((column) => column.Field === 'supervisors');
                if (!hasColumn) {
                    await dbPromise.query(`ALTER TABLE evaluation_panels ADD COLUMN supervisors TEXT NULL`);
                }
            } catch (error) {
                console.warn('evaluation_panels supervisors column check failed:', error.message);
            }
        })();
    }
    await ensureEvaluationPanelSupervisorsColumnPromise;
};

/**
 * Schedule an evaluation panel
 * Expects body: { evaluationType, academicLevel, targetGroup, evaluators, supervisors?, panelDate, startTime, duration, location, meetingLink?, notes?, kind? }
 * `evaluators` is the full panel roster (supervisors + external evaluators);
 * `supervisors` is the subset of that roster auto-detected as the group's
 * assigned supervisor(s). Both are stored as JSON text in `evaluation_panels`.
 */
const scheduleEvaluationPanel = async (req, res) => {
    const {
        evaluationType, academicLevel, targetGroup, evaluators, supervisors, panelDate, startTime, duration, location,
        meetingLink, notes, kind,
    } = req.body;

    try {
        await ensureEvaluationPanelMeetingColumns();
        await ensureEvaluationPanelSupervisorsColumn();

        // Convert evaluators/supervisors arrays into JSON strings for storage.
        const evaluatorsString = JSON.stringify(evaluators);
        const supervisorsString = JSON.stringify(supervisors || []);

        const query = `
            INSERT INTO evaluation_panels
            (evaluation_type, academic_level, target_group, evaluators, supervisors, panel_date, start_time, duration, location, meeting_link, notes, kind)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        // Use the promise wrapper on the pool to await the query result.
        await db.promise().query(query, [
            evaluationType, academicLevel, targetGroup, evaluatorsString, supervisorsString, panelDate, startTime, duration, location,
            meetingLink || null, notes || null, kind || 'Coordinator scheduled panel',
        ]);

        // Respond with a success message on creation.
        res.status(201).json({ message: 'Evaluation panel scheduled successfully!' });
    } catch (error) {
        // Log the error for server-side debugging and return a 500 to the client.
        console.error('Database error (scheduleEvaluationPanel):', error);
        res.status(500).json({ error: 'Failed to schedule panel' });
    }
};

/**
 * Update an existing evaluation panel in place — the drawer's "Update Panel"
 * action (openEditPanelDrawer/handleScheduleSubmit in CalendarPage.tsx).
 * There was previously no route for this at all: editing always POSTed to
 * scheduleEvaluationPanel, which only ever INSERTs, so "editing" a panel
 * silently left the original row untouched in the database and inserted a
 * second, near-duplicate one — the edited panel and the stale original both
 * showed up in "Upcoming Panels" once the list was reloaded from the server.
 * This is the real fix: PUT /api/calendar/panels/:id updates the row in place.
 * Expects the same body shape as scheduleEvaluationPanel.
 */
const updateEvaluationPanel = async (req, res) => {
    const panelId = Number(req.params.id);

    if (!panelId || Number.isNaN(panelId)) {
        return res.status(400).json({ error: 'A valid panel id is required.' });
    }

    const {
        evaluationType, academicLevel, targetGroup, evaluators, supervisors, panelDate, startTime, duration, location,
        meetingLink, notes, kind,
    } = req.body;

    try {
        await ensureEvaluationPanelMeetingColumns();
        await ensureEvaluationPanelSupervisorsColumn();

        const evaluatorsString = JSON.stringify(evaluators);
        const supervisorsString = JSON.stringify(supervisors || []);

        const query = `
            UPDATE evaluation_panels
            SET evaluation_type = ?, academic_level = ?, target_group = ?, evaluators = ?, supervisors = ?,
                panel_date = ?, start_time = ?, duration = ?, location = ?, meeting_link = ?, notes = ?, kind = ?
            WHERE id = ?
        `;

        const [result] = await db.promise().query(query, [
            evaluationType, academicLevel, targetGroup, evaluatorsString, supervisorsString, panelDate, startTime, duration, location,
            meetingLink || null, notes || null, kind || 'Coordinator scheduled panel',
            panelId,
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Panel not found.' });
        }

        res.status(200).json({ message: 'Evaluation panel updated successfully!' });
    } catch (error) {
        console.error('Database error (updateEvaluationPanel):', error);
        res.status(500).json({ error: 'Failed to update panel' });
    }
};

/**
 * Fetch upcoming panels. Used by the coordinator Calendar page to populate
 * BOTH the "Upcoming Panels" sidebar and the whole month grid's per-day
 * panel-count markers (CalendarPage.tsx's loadPanelsFromServer/markerMap).
 * Returns panels with panel_date >= CURRENT_DATE ordered by date/time.
 *
 * NOTE: this previously carried `LIMIT 5` (meant only for a small sidebar
 * preview), which silently truncated the result set the month grid depends
 * on — once total upcoming panels across all days exceeded 5, any panels
 * past that cutoff were dropped from the grid's per-day counts, making days
 * with multiple panels undercount (e.g. always showing "1 Panel"). This is
 * the only consumer of this endpoint, so the cap was removed rather than
 * raised.
 */
// Optional ?coordinatorId= scopes the response to just that coordinator's
// own department AND level (resolved server-side above, never a
// client-supplied string) — previously this returned every panel
// system-wide regardless of who created the underlying group, so a
// coordinator's Calendar "Upcoming Panels" list showed every other
// department's (and every other level's) panels too.
const getUpcomingPanels = async (req, res) => {
    try {
        await ensureEvaluationPanelStatusColumn();

        const coordinatorId = req.query.coordinatorId || null;
        const studentId = req.query.studentId || null;

        // studentId takes its own path, entirely separate from the
        // coordinatorId/getCoordinatorScope one below — a student's own
        // users row has their personal academic_unit/level, not their
        // group's, so reusing getCoordinatorScope for a student would
        // (and previously did, when the frontend sent coordinatorId for
        // every logged-in user) scope by the wrong thing. When studentId
        // is absent this resolves to null exactly like scope did before,
        // so the coordinatorId behavior below is completely unchanged.
        const studentGroupScope = studentId ? await getStudentGroupScope(studentId) : null;
        const studentGroupName = studentGroupScope ? studentGroupScope.groupName : null;

        // A student with no resolvable group (not in project_group_members
        // yet, or the lookup itself failed) must see NO panels, not every
        // panel system-wide. Below, `studentGroupName`/`level`/`department`
        // all being null makes every "(? IS NULL OR ...)" clause pass
        // through unfiltered — that's the intended fallback for a
        // coordinator with no scope (see the coordinatorId branch, which
        // deliberately returns everything when no id is given), but a
        // studentId was given here and simply couldn't be resolved to a
        // group, so the safe default is the opposite: show nothing rather
        // than silently handing back every other group's panels too.
        if (studentId && !studentGroupScope) {
            return res.status(200).json([]);
        }

        const scope = studentId ? null : await getCoordinatorScope(coordinatorId);
        // Department wasn't previously checked for a student at all (only
        // level + exact group-name match) — harmless while every group name
        // in the system happens to be unique, but two different departments
        // are free to reuse the same group name at the same level, and a
        // name-only match would then hand a student panels that belong to a
        // same-named group in a different department. Scoping by the
        // student's own group's department too closes that gap.
        const department = studentGroupScope ? studentGroupScope.department : (scope ? scope.department : null);
        const level = studentGroupScope ? studentGroupScope.level : (scope ? scope.level : null);

        const query = `
            SELECT
                ep.*,
                pg.department,
                pg.supervisor_id,
                pg.supervisor_id_2,
                u1.name as group_supervisor_name,
                u2.name as group_supervisor_name_2
            FROM evaluation_panels ep
            LEFT JOIN project_groups pg ON (
                LOWER(TRIM(pg.group_name)) = LOWER(TRIM(ep.target_group))
                AND pg.level = ep.academic_level
            )
            LEFT JOIN users u1 ON u1.id = pg.supervisor_id
            LEFT JOIN users u2 ON u2.id = pg.supervisor_id_2
            WHERE ep.panel_date >= CURRENT_DATE AND ep.status != 'completed'
              AND (? IS NULL OR ep.academic_level = ?)
              AND (? IS NULL OR
                   CASE
                     WHEN UPPER(TRIM(pg.department)) IN ('IDS', 'ITM') THEN 'ITM'
                     WHEN UPPER(TRIM(pg.department)) IN ('CM', 'AI') THEN 'AI'
                     WHEN UPPER(TRIM(pg.department)) = 'IT' THEN 'IT'
                     ELSE UPPER(TRIM(pg.department))
                   END = ?)
              AND (? IS NULL OR LOWER(TRIM(ep.target_group)) = LOWER(TRIM(?)))
            ORDER BY ep.panel_date ASC, ep.start_time ASC
        `;

        // Await the rows from the database and forward them to the client.
        const [results] = await db.promise().query(
            query,
            [level, level, department, department, studentGroupName, studentGroupName],
        );
        res.status(200).json(results);
    } catch (error) {
        console.error('Database error (getUpcomingPanels):', error);
        res.status(500).json({ error: 'Failed to fetch upcoming panels' });
    }
};

/**
 * Panel completion status for every (group, stage) at a level, regardless
 * of panel_date. getUpcomingPanels can't be reused for this: it drops any
 * panel whose date has passed, which by the time a coordinator is reviewing
 * marks in the Reports tab is true for nearly every panel, so it would make
 * an untouched (never-completed) panel look identical to a genuinely
 * completed one. This endpoint answers the narrower question the Reports
 * tab's "Complete" button actually needs — "is THIS panel's status still
 * active?" — straight from evaluation_panels.status, independent of date.
 * Optional ?coordinatorId= scopes to that coordinator's own department,
 * same as getUpcomingPanels.
 */
const getPanelStatusForLevel = async (req, res) => {
    try {
        await ensureEvaluationPanelStatusColumn();

        const level = Number(req.params.level);
        if (!level) {
            return res.status(400).json({ error: 'A valid level is required.' });
        }

        const coordinatorId = req.query.coordinatorId || null;
        const scope = await getCoordinatorScope(coordinatorId);
        const department = scope ? scope.department : null;

        const query = `
            SELECT ep.target_group, ep.evaluation_type, ep.academic_level, ep.status
            FROM evaluation_panels ep
            LEFT JOIN project_groups pg ON (
                LOWER(TRIM(pg.group_name)) = LOWER(TRIM(ep.target_group))
                AND pg.level = ep.academic_level
            )
            WHERE ep.academic_level = ?
              AND (? IS NULL OR
                   CASE
                     WHEN UPPER(TRIM(pg.department)) IN ('IDS', 'ITM') THEN 'ITM'
                     WHEN UPPER(TRIM(pg.department)) IN ('CM', 'AI') THEN 'AI'
                     WHEN UPPER(TRIM(pg.department)) = 'IT' THEN 'IT'
                     ELSE UPPER(TRIM(pg.department))
                   END = ?)
        `;

        const [results] = await db.promise().query(query, [level, department, department]);
        res.status(200).json(results);
    } catch (error) {
        console.error('Database error (getPanelStatusForLevel):', error);
        res.status(500).json({ error: 'Failed to fetch panel status' });
    }
};

const completePanelsForGroups = async (req, res) => {
    const { level, groupNames, stageName } = req.body;
    const academicLevel = Number(level);

    if (!academicLevel || !Array.isArray(groupNames) || groupNames.length === 0) {
        return res.status(400).json({ success: false, message: 'level and a non-empty groupNames array are required.' });
    }

    try {
        await ensureEvaluationPanelStatusColumn();

        let query = `UPDATE evaluation_panels
                      SET status = 'completed'
                      WHERE academic_level = ? AND target_group IN (?) AND status != 'completed'`;
        const params = [academicLevel, groupNames];

        if (stageName) {
            query += ` AND LOWER(TRIM(evaluation_type)) = LOWER(TRIM(?))`;
            params.push(stageName);
        }

        const [result] = await db.promise().query(query, params);

        return res.status(200).json({ success: true, panelsUpdated: result.affectedRows });
    } catch (error) {
        console.error('Database error (completePanelsForGroups):', error);
        return res.status(500).json({ success: false, message: 'Failed to complete panels.' });
    }
};

const deleteEvaluationPanel = async (req, res) => {
    const panelId = Number(req.params.id);

    if (!panelId || Number.isNaN(panelId)) {
        return res.status(400).json({ error: 'A valid panel id is required.' });
    }

    try {
        const [result] = await db.promise().query('DELETE FROM evaluation_panels WHERE id = ?', [panelId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Panel not found.' });
        }

        return res.status(200).json({ message: 'Evaluation panel deleted successfully.' });
    } catch (error) {
        console.error('Database error (deleteEvaluationPanel):', error);
        return res.status(500).json({ error: 'Failed to delete panel.' });
    }
};

/**
 * Freeze a single date (e.g., exam period, holiday) so it can be displayed
 * or used to prevent scheduling on that day.
 * Expects body: { frozen_date, reason, type, created_by }
 */
const freezeDate = async (req, res) => {
    const { frozen_date, reason, type, created_by } = req.body;

    try {
        const query = 'INSERT INTO frozen_dates (frozen_date, reason, type, created_by) VALUES (?, ?, ?, ?)';

        await db.promise().query(query, [frozen_date, reason, type, created_by]);

        res.status(201).json({ message: 'Date successfully frozen!' });
    } catch (error) {
        console.error('Database error (freezeDate):', error);
        res.status(500).json({ error: 'Failed to freeze date' });
    }
};

/**
 * Retrieve all frozen dates (used to decorate calendar UI with special markers).
 */
const getFrozenDates = async (req, res) => {
    try {
        const query = 'SELECT id, DATE_FORMAT(frozen_date, "%Y-%m-%d") as frozen_date, reason, type, created_by, created_at FROM frozen_dates ORDER BY frozen_date ASC';
        const [results] = await db.promise().query(query);

        res.status(200).json(results);
    } catch (error) {
        console.error('Database error (getFrozenDates):', error);
        res.status(500).json({ error: 'Failed to fetch frozen dates' });
    }
};


/**
 * Remove a frozen date by id or date string
 */
const unfreezeDate = async (req, res) => {
    const { id } = req.params;
    try {
        await db.promise().query('DELETE FROM frozen_dates WHERE id = ? OR frozen_date = ?', [id, id]);
        res.status(200).json({ message: 'Frozen date removed successfully.' });
    } catch (error) {
        console.error('Database error (unfreezeDate):', error);
        res.status(500).json({ error: 'Failed to unfreeze date' });
    }
};

module.exports = {
    unfreezeDate,
    scheduleEvaluationPanel,
    updateEvaluationPanel,
    getUpcomingPanels,
    getPanelStatusForLevel,
    completePanelsForGroups,
    deleteEvaluationPanel,
    freezeDate,
    getFrozenDates,
    ensureEvaluationPanelStatusColumn,
};