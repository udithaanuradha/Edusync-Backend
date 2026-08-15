const db = require('../config/db');

/**
 * 🚀 1. Supervisor/Evaluator හට අදාළ Panels Fetch කිරීම (All OR By Date & Level)
 * Query params: ?evaluatorName=kelum sagara&date=2026-04-30&level=1
 */
const getPanelsByEvaluator = async (req, res) => {
    try {
        const { evaluatorName, date, level } = req.query;

        // Logged-in User name or Token Fallback
        const supervisorName = evaluatorName || (req.user && (req.user.name || req.user.full_name));

        if (!supervisorName) {
            return res.status(400).json({ 
                success: false, 
                message: 'evaluatorName query parameter or authenticated user identity is required' 
            });
        }

        let query = `SELECT * FROM evaluation_panels WHERE 1=1`;
        const queryParams = [];

        // Dynamic Filtering: Evaluator Name in JSON array OR String Search
        query += ` AND (JSON_CONTAINS(LOWER(evaluators), JSON_QUOTE(LOWER(?))) OR LOWER(evaluators) LIKE LOWER(?))`;
        queryParams.push(supervisorName, `%${supervisorName}%`);

        // Date එකක් එවා ඇත්නම් පමණක් Date Filter කරන්න
        if (date) {
            query += ` AND panel_date = ?`;
            queryParams.push(date);
        }

        // Academic Level එක Filter කරන්න
        if (level) {
            query += ` AND academic_level = ?`;
            queryParams.push(level);
        }

        const [results] = await db.promise().query(query, queryParams);

        return res.status(200).json({ 
            success: true, 
            count: results.length,
            data: results 
        });

    } catch (error) {
        console.error('Database error (getPanelsByEvaluator):', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch evaluation panels', 
            error: error.message 
        });
    }
};

/**
 * 🚀 2. Panel එකේ Target Group එකට අයත් Students සහ Marks Fetch කිරීම
 * URL param: /panel-students/:panelId
 */
const getStudentsForPanel = async (req, res) => {
    const { panelId } = req.params;

    try {
        // First fetch panel details
        const [panelRows] = await db.promise().query(
            `SELECT * FROM evaluation_panels WHERE id = ?`, 
            [panelId]
        );

        if (panelRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Evaluation panel not found' });
        }

        const panel = panelRows[0];

        // Target group eke name eken students la fetch kireema
        const query = `
            SELECT 
                ? AS panel_id,
                ? AS evaluation_type,
                ? AS academic_level,
                ? AS group_name,
                u.id AS student_id,
                u.name AS student_name,
                u.email AS student_email,
                m.marks_obtained,
                m.feedback
            FROM users u
            LEFT JOIN marks m ON m.student_id = u.id AND m.stage_id = ?
            WHERE LOWER(u.role) = 'student'
              AND (u.group_name = ? OR u.id IN (
                    SELECT student_id FROM group_members gm 
                    JOIN project_groups pg ON pg.id = gm.group_id 
                    WHERE pg.group_name = ?
              ))
        `;

        const [students] = await db.promise().query(query, [
            panel.id,
            panel.evaluation_type,
            panel.academic_level,
            panel.target_group,
            panel.id,
            panel.target_group,
            panel.target_group
        ]);

        return res.status(200).json({ 
            success: true, 
            panel: panel,
            data: students 
        });

    } catch (error) {
        console.error('Database error (getStudentsForPanel):', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch students for panel',
            error: error.message 
        });
    }
};

/**
 * 🎯 3. Level එකට අදාළව Logged-in User Evaluator කෙනෙක්දැයි Check කිරීම
 * Query params: ?level=1&evaluatorName=kelum sagara
 */
const checkEvaluatorStatus = async (req, res) => {
    try {
        const { level, evaluatorName } = req.query;

        // User identity from query param or auth token
        const supervisorName = evaluatorName || (req.user && (req.user.name || req.user.full_name));

        if (!level || !supervisorName) {
            return res.status(200).json({ isEvaluator: false });
        }

        const query = `
            SELECT id FROM evaluation_panels 
            WHERE academic_level = ? 
              AND (JSON_CONTAINS(LOWER(evaluators), JSON_QUOTE(LOWER(?))) OR LOWER(evaluators) LIKE LOWER(?))
        `;

        const [rows] = await db.promise().query(query, [level, supervisorName, `%${supervisorName}%`]);

        return res.status(200).json({ 
            success: true,
            isEvaluator: rows.length > 0 
        });

    } catch (error) {
        console.error('Database error (checkEvaluatorStatus):', error);
        return res.status(500).json({ 
            isEvaluator: false, 
            error: error.message 
        });
    }
};

module.exports = {
    getPanelsByEvaluator,
    getPanelsByDateAndEvaluator: getPanelsByEvaluator, // Backward compatibility
    getStudentsForPanel,
    checkEvaluatorStatus, // 👈 🎯 Added export
};