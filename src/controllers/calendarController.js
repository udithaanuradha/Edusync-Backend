/**
 * Calendar controller
 * Contains handlers for scheduling evaluation panels and managing frozen dates.
 * Routes are mounted under `/api/calendar` in index.js.
 */
const db = require('../config/db');

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
 * Fetch a small list of upcoming panels for sidebar or quick view.
 * Returns panels with panel_date >= CURRENT_DATE ordered by date/time.
 */
const getUpcomingPanels = async (req, res) => {
    try {
        const query = 'SELECT * FROM evaluation_panels WHERE panel_date >= CURRENT_DATE ORDER BY panel_date ASC, start_time ASC LIMIT 5';

        // Await the rows from the database and forward them to the client.
        const [results] = await db.promise().query(query);
        res.status(200).json(results);
    } catch (error) {
        console.error('Database error (getUpcomingPanels):', error);
        res.status(500).json({ error: 'Failed to fetch upcoming panels' });
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
    deleteEvaluationPanel,
    freezeDate,
    getFrozenDates,
};