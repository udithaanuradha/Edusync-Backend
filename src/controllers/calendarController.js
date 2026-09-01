/**
 * Calendar controller
 * Contains handlers for scheduling evaluation panels and managing frozen dates.
 * Routes are mounted under `/api/calendar` in index.js.
 */
const db = require('../config/db');
const dbPromise = db.promise();

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

/**
 * Schedule an evaluation panel
 * Expects body: { evaluationType, academicLevel, targetGroup, evaluators, panelDate, startTime, duration, location, meetingLink?, notes?, kind? }
 * Stores evaluators as JSON text in the `evaluation_panels` table.
 */
const scheduleEvaluationPanel = async (req, res) => {
    const {
        evaluationType, academicLevel, targetGroup, evaluators, panelDate, startTime, duration, location,
        meetingLink, notes, kind,
    } = req.body;

    try {
        await ensureEvaluationPanelMeetingColumns();

        // Convert evaluators array/object into a JSON string for storage.
        const evaluatorsString = JSON.stringify(evaluators);

        const query = `
            INSERT INTO evaluation_panels
            (evaluation_type, academic_level, target_group, evaluators, panel_date, start_time, duration, location, meeting_link, notes, kind)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        // Use the promise wrapper on the pool to await the query result.
        await db.promise().query(query, [
            evaluationType, academicLevel, targetGroup, evaluatorsString, panelDate, startTime, duration, location,
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
const getUpcomingPanels = async (req, res) => {
    try {
        await ensureEvaluationPanelStatusColumn();

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
            ORDER BY ep.panel_date ASC, ep.start_time ASC
        `;

        // Await the rows from the database and forward them to the client.
        const [results] = await db.promise().query(query);
        res.status(200).json(results);
    } catch (error) {
        console.error('Database error (getUpcomingPanels):', error);
        res.status(500).json({ error: 'Failed to fetch upcoming panels' });
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
    getUpcomingPanels,
    completePanelsForGroups,
    deleteEvaluationPanel,
    freezeDate,
    getFrozenDates,
    ensureEvaluationPanelStatusColumn,
};