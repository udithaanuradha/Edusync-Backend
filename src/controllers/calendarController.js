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

/**
 * Schedule an evaluation panel
 * Expects body: { evaluationType, academicLevel, targetGroup, evaluators, panelDate, startTime, duration, location }
 * Stores evaluators as JSON text in the `evaluation_panels` table.
 */
const scheduleEvaluationPanel = async (req, res) => {
    const { evaluationType, academicLevel, targetGroup, evaluators, panelDate, startTime, duration, location } = req.body;

    try {
        // Convert evaluators array/object into a JSON string for storage.
        const evaluatorsString = JSON.stringify(evaluators);

        const query = `
            INSERT INTO evaluation_panels 
            (evaluation_type, academic_level, target_group, evaluators, panel_date, start_time, duration, location) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        // Use the promise wrapper on the pool to await the query result.
        await db.promise().query(query, [evaluationType, academicLevel, targetGroup, evaluatorsString, panelDate, startTime, duration, location]);

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

        const query = `SELECT * FROM evaluation_panels
                        WHERE panel_date >= CURRENT_DATE AND status != 'completed'
                        ORDER BY panel_date ASC, start_time ASC`;

        // Await the rows from the database and forward them to the client.
        const [results] = await db.promise().query(query);
        res.status(200).json(results);
    } catch (error) {
        console.error('Database error (getUpcomingPanels):', error);
        res.status(500).json({ error: 'Failed to fetch upcoming panels' });
    }
};

/**
 * Coordinator-driven completion, called from the Reports/Gradebook marksheet
 * (SupervisorReportPanel.tsx). Proposal/Interim/Code Review/Final each
 * happen at genuinely different points in the year for a given group, so
 * completion is scoped per (group, stage) — NOT deferred until Final —
 * otherwise an already-finished Proposal panel from months ago would keep
 * sitting on the calendar as "upcoming" until Final finally happens.
 *
 * `stageName` is optional for backward compatibility: if provided, only that
 * group's panel for that specific stage is completed (the normal case, one
 * "Complete" click per stage cell); if omitted, every still-scheduled panel
 * for the given group(s) is completed regardless of stage.
 * Expects body: { level, groupNames: string[], stageName?: string }
 */
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
        const query = 'SELECT * FROM frozen_dates ORDER BY frozen_date ASC';
        const [results] = await db.promise().query(query);

        res.status(200).json(results);
    } catch (error) {
        console.error('Database error (getFrozenDates):', error);
        res.status(500).json({ error: 'Failed to fetch frozen dates' });
    }
};

module.exports = {
    scheduleEvaluationPanel,
    getUpcomingPanels,
    completePanelsForGroups,
    deleteEvaluationPanel,
    freezeDate,
    getFrozenDates,
    ensureEvaluationPanelStatusColumn,
};