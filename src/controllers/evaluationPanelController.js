const db = require('../config/db');

/**
 * 1. Fetch Panels by Evaluator / Date / Level
 */
const getPanelsByEvaluator = async (req, res) => {
    try {
        const { evaluatorName, date, level } = req.query;
        const supervisorName = evaluatorName || (req.user && (req.user.name || req.user.full_name));

        if (!supervisorName) {
            return res.status(400).json({ 
                success: false, 
                message: 'evaluatorName query parameter or authenticated user identity is required' 
            });
        }

        let query = `SELECT * FROM evaluation_panels WHERE 1=1`;
        const queryParams = [];

        // `evaluators` now holds only the external evaluators the coordinator
        // hand-picked; the group's own supervisor(s) live in `supervisors`
        // instead (see calendarController.js's scheduleEvaluationPanel /
        // updateEvaluationPanel). Check both columns so a supervisor still
        // shows up as "assigned" to their own group's panel.
        query += ` AND (LOWER(evaluators) LIKE LOWER(?) OR LOWER(supervisors) LIKE LOWER(?))`;
        queryParams.push(`%${supervisorName}%`, `%${supervisorName}%`);

        if (date) {
            query += ` AND panel_date = ?`;
            queryParams.push(date);
        }

        if (level) {
            query += ` AND academic_level = ?`;
            queryParams.push(String(level));
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
 * 2. Check if logged-in user is an evaluator
 */
const checkEvaluatorStatus = async (req, res) => {
    try {
        const { evaluatorName } = req.query;
        const supervisorName = evaluatorName || (req.user && (req.user.name || req.user.full_name));

        if (!supervisorName) {
            return res.status(200).json({ isEvaluator: false, assignedPanelsCount: 0 });
        }

        // See getPanelsByEvaluator above: `evaluators` is external evaluators
        // only now, so a group's own supervisor is found via `supervisors`.
        const [results] = await db.promise().query(
            `SELECT COUNT(*) as count FROM evaluation_panels WHERE LOWER(evaluators) LIKE LOWER(?) OR LOWER(supervisors) LIKE LOWER(?)`,
            [`%${supervisorName}%`, `%${supervisorName}%`]
        );

        const count = results[0]?.count || 0;
        return res.status(200).json({
            isEvaluator: count > 0,
            assignedPanelsCount: count
        });

    } catch (error) {
        console.error('Database error (checkEvaluatorStatus):', error);
        return res.status(500).json({ success: false, message: 'Failed to check evaluator status' });
    }
};

/**
 * 3. Fetch students and group for panel
 */
const getStudentsForPanel = async (req, res) => {
    try {
        const { panelId } = req.params;
        const [panels] = await db.promise().query(
            `SELECT * FROM evaluation_panels WHERE id = ? LIMIT 1`,
            [panelId]
        );

        if (panels.length === 0) {
            return res.status(404).json({ success: false, message: 'Panel not found' });
        }

        const panel = panels[0];
        const [groups] = await db.promise().query(
            `SELECT * FROM project_groups WHERE group_name = ? LIMIT 1`,
            [panel.target_group]
        );

        let students = [];
        if (groups.length > 0) {
            const [members] = await db.promise().query(
                `SELECT u.id, u.name, u.email, u.university_id, pgm.is_leader
                 FROM project_group_members pgm
                 JOIN users u ON u.id = pgm.student_id
                 WHERE pgm.group_id = ?
                 ORDER BY pgm.is_leader DESC, u.name ASC`,
                [groups[0].id]
            );
            students = members;
        }

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
 * 4. Get My Assigned Groups with correct stage canonical IDs and evaluator-wise marks
 */
const getMyAssignedGroups = async (req, res) => {
    try {
        const { level, evaluatorName } = req.query;
        const supervisorName = evaluatorName || (req.user && (req.user.name || req.user.full_name));

        if (!supervisorName) {
            return res.status(400).json({ 
                success: false, 
                message: 'evaluatorName is required to fetch assigned groups' 
            });
        }

        // Find user ID for this evaluator (filter by lecturer/supervisor role to avoid student collisions)
        let evaluatorUserId = req.user?.id || null;
        if (!evaluatorUserId) {
            const [userRows] = await db.promise().query(
                `SELECT id FROM users WHERE LOWER(TRIM(name)) LIKE LOWER(TRIM(?)) AND role IN ('lecturer', 'supervisor', 'coordinator', 'admin') ORDER BY id DESC LIMIT 1`,
                [`%${supervisorName}%`]
            );
            if (userRows.length > 0) {
                evaluatorUserId = userRows[0].id;
            } else {
                const [fallbackUser] = await db.promise().query(
                    `SELECT id FROM users WHERE LOWER(TRIM(name)) LIKE LOWER(TRIM(?)) LIMIT 1`,
                    [`%${supervisorName}%`]
                );
                if (fallbackUser.length > 0) evaluatorUserId = fallbackUser[0].id;
            }
        }

        // Find assigned evaluation panels. `evaluators` is external
        // evaluators only; a group's own supervisor is found via
        // `supervisors` instead (see getPanelsByEvaluator above).
        let panelQuery = `SELECT * FROM evaluation_panels WHERE (LOWER(evaluators) LIKE LOWER(?) OR LOWER(supervisors) LIKE LOWER(?))`;
        const panelParams = [`%${supervisorName}%`, `%${supervisorName}%`];

        if (level) {
            panelQuery += ` AND academic_level = ?`;
            panelParams.push(String(level));
        }
        panelQuery += ` ORDER BY panel_date ASC, start_time ASC`;

        const [panels] = await db.promise().query(panelQuery, panelParams);

        if (panels.length === 0) {
            return res.status(200).json({ 
                success: true, 
                count: 0, 
                data: [] 
            });
        }

        const enrichedGroups = [];

        for (const panel of panels) {
            const targetGroupName = panel.target_group;
            const academicLevel = Number(panel.academic_level) || (level ? Number(level) : 1);

            // 1. Find group
            const [groupRows] = await db.promise().query(
                `SELECT * FROM project_groups WHERE group_name = ? AND level = ? LIMIT 1`,
                [targetGroupName, academicLevel]
            );

            let group = groupRows[0];
            if (!group) {
                const [fallbackGroup] = await db.promise().query(
                    `SELECT * FROM project_groups WHERE group_name = ? LIMIT 1`,
                    [targetGroupName]
                );
                group = fallbackGroup[0];
            }

            const groupId = group ? group.id : null;

            // 2. Find corresponding canonical stage_ids for this evaluation_type (case-insensitive)
            let stageId = null;
            let stageName = panel.evaluation_type;
            let matchingStageIds = [];

            const [stageRows] = await db.promise().query(
                `SELECT stage_id, stage_name FROM project_stages WHERE level = ? AND LOWER(TRIM(stage_name)) = LOWER(TRIM(?))`,
                [academicLevel, panel.evaluation_type]
            );

            if (stageRows.length > 0) {
                stageId = stageRows[0].stage_id;
                stageName = stageRows[0].stage_name;
                matchingStageIds = stageRows.map(s => s.stage_id);
            } else {
                const [fuzzyStage] = await db.promise().query(
                    `SELECT stage_id, stage_name FROM project_stages WHERE level = ? AND LOWER(stage_name) LIKE LOWER(?)`,
                    [academicLevel, `%${panel.evaluation_type}%`]
                );
                if (fuzzyStage.length > 0) {
                    stageId = fuzzyStage[0].stage_id;
                    stageName = fuzzyStage[0].stage_name;
                    matchingStageIds = [fuzzyStage[0].stage_id];
                }
            }

            // 3. Find group members & stage marks
            let members = [];
            let leaderName = '';
            let groupTotalMarks = 60; // Default or configured stage max marks

            if (groupId) {
                const [memberRows] = await db.promise().query(
                    `SELECT 
                        pgm.student_id,
                        pgm.is_leader,
                        u.name AS student_name,
                        u.email AS student_email,
                        u.university_id,
                        u.academic_unit
                     FROM project_group_members pgm
                     JOIN users u ON u.id = pgm.student_id
                     WHERE pgm.group_id = ?
                     ORDER BY pgm.is_leader DESC, u.name ASC`,
                    [groupId]
                );

                let existingMarksMap = {};
                let stageAvgMap = {};

                if (matchingStageIds.length > 0) {
                    // Check if any mark in this group & stage defines total_marks
                    const [totalMarksRows] = await db.promise().query(
                        `SELECT total_marks FROM marks 
                         WHERE group_id = ? AND stage_id IN (?) AND total_marks IS NOT NULL AND total_marks > 0
                         ORDER BY mark_id DESC LIMIT 1`,
                        [groupId, matchingStageIds]
                    );

                    if (totalMarksRows.length > 0 && totalMarksRows[0].total_marks) {
                        groupTotalMarks = Number(totalMarksRows[0].total_marks);
                    }

                    // Fetch previously submitted marks by THIS evaluator
                    if (evaluatorUserId) {
                        const [marksRows] = await db.promise().query(
                            `SELECT student_id, marks_obtained, total_marks, feedback 
                             FROM marks 
                             WHERE group_id = ? AND stage_id IN (?) AND marked_by = ?`,
                            [groupId, matchingStageIds, evaluatorUserId]
                        );
                        marksRows.forEach((m) => {
                            if (m.total_marks) {
                                groupTotalMarks = Number(m.total_marks);
                            }
                            existingMarksMap[m.student_id] = {
                                marks: m.marks_obtained,
                                total_marks: m.total_marks ? Number(m.total_marks) : groupTotalMarks,
                                feedback: m.feedback || '',
                            };
                        });
                    }

                    // Stage Average calculation across all evaluators for this stage
                    const [avgRows] = await db.promise().query(
                        `SELECT 
                            student_id, 
                            AVG(marks_obtained) AS avg_mark, 
                            MAX(total_marks) AS max_total,
                            COUNT(DISTINCT marked_by) as evaluator_count
                         FROM marks 
                         WHERE group_id = ? AND stage_id IN (?)
                         GROUP BY student_id`,
                        [groupId, matchingStageIds]
                    );

                    avgRows.forEach((a) => {
                        stageAvgMap[a.student_id] = {
                            avg_mark: Number(Number(a.avg_mark).toFixed(2)),
                            total_marks: a.max_total ? Number(a.max_total) : groupTotalMarks,
                            evaluator_count: a.evaluator_count,
                        };
                    });
                }

                members = memberRows.map((m) => {
                    if (m.is_leader) leaderName = m.student_name;
                    const prev = existingMarksMap[m.student_id] || {};
                    const stats = stageAvgMap[m.student_id] || {};
                    return {
                        student_id: m.student_id,
                        student_name: m.student_name,
                        student_email: m.student_email,
                        reg_number: m.university_id || 'N/A',
                        academic_unit: m.academic_unit || '',
                        is_leader: Boolean(m.is_leader),
                        marks: prev.marks !== undefined ? prev.marks : '',
                        total_marks: prev.total_marks || groupTotalMarks || 60,
                        feedback: prev.feedback || '',
                        stage_avg_mark: stats.avg_mark !== undefined ? stats.avg_mark : null,
                        evaluator_count: stats.evaluator_count || 0,
                    };
                });
            }

            enrichedGroups.push({
                panel_id: panel.id,
                group_id: groupId || panel.id,
                group_name: panel.target_group,
                project_title: panel.target_group,
                evaluation_type: panel.evaluation_type,
                academic_level: panel.academic_level,
                stage_id: stageId,
                stage_name: stageName,
                panel_date: panel.panel_date,
                start_time: panel.start_time,
                duration: panel.duration,
                location: panel.location,
                meeting_link: panel.meeting_link || panel.meetingLink || "",
                evaluators: panel.evaluators,
                supervisors: panel.supervisors,
                supervisor_name: (typeof panel.supervisors === "string" && panel.supervisors.startsWith("[") ? (JSON.parse(panel.supervisors || "[]") || []).join(", ") : (panel.supervisors || "")),
                leader_name: leaderName,
                evaluator_id: evaluatorUserId,
                total_marks: groupTotalMarks || 60,
                members: members,
            });
        }

        return res.status(200).json({ 
            success: true, 
            count: enrichedGroups.length, 
            data: enrichedGroups 
        });

    } catch (error) {
        console.error('Database error (getMyAssignedGroups):', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch assigned groups', 
            error: error.message 
        });
    }
};

/**
 * 5. Submit individual student marks for a stage/panel with configurable total_marks
 */
const submitEvaluationMarks = async (req, res) => {
    try {
        const {
            panel_id,
            group_id,
            stage_id,
            evaluation_type,
            marked_by,
            evaluator_name,
            academic_level,
            total_marks,
            evaluations
        } = req.body;

        if (!group_id || !Array.isArray(evaluations) || evaluations.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'group_id and evaluations array are required.'
            });
        }

        const maxTotalMarks = Math.max(1, parseFloat(total_marks) || 60);

        // 1. Resolve evaluator ID
        let evaluatorId = marked_by || req.user?.id;
        if (!evaluatorId && evaluator_name) {
            const [userRows] = await db.promise().query(
                `SELECT id FROM users WHERE LOWER(TRIM(name)) LIKE LOWER(TRIM(?)) AND role IN ('lecturer', 'supervisor', 'coordinator', 'admin') ORDER BY id DESC LIMIT 1`,
                [`%${evaluator_name}%`]
            );
            if (userRows.length > 0) evaluatorId = userRows[0].id;
        }

        if (!evaluatorId) {
            const [fallbackUser] = await db.promise().query(
                `SELECT id FROM users WHERE role IN ('supervisor', 'lecturer', 'coordinator', 'admin') LIMIT 1`
            );
            evaluatorId = fallbackUser.length > 0 ? fallbackUser[0].id : 1;
        }

        // 2. Resolve stage_id if not directly passed
        let resolvedStageId = stage_id ? Number(stage_id) : null;
        if (!resolvedStageId && evaluation_type) {
            const levelVal = academic_level || 2;
            const [stageRows] = await db.promise().query(
                `SELECT stage_id FROM project_stages WHERE level = ? AND LOWER(stage_name) LIKE LOWER(?) LIMIT 1`,
                [levelVal, `%${evaluation_type}%`]
            );
            if (stageRows.length > 0) {
                resolvedStageId = stageRows[0].stage_id;
            } else {
                // Calendar panels (evaluation_panels.evaluation_type) aren't
                // required to match a coordinator-authored project_stages row
                // 1:1 — a supervisor can be scheduled to evaluate a stage
                // (e.g. "Interim") the coordinator never manually created a
                // template for. Previously this left resolvedStageId as
                // null, so the mark got inserted with no stage_id at all —
                // recorded but invisible everywhere the marksheet/canonical
                // stage list is built from project_stages (Reports tab,
                // dashboard completion logic). Create the stage on first use
                // instead, keyed to the evaluator who's actually conducting
                // it, so the stage — and the marks against it — show up
                // dynamically rather than requiring the coordinator to have
                // pre-defined every possible stage name in advance.
                const [insertResult] = await db.promise().query(
                    `INSERT INTO project_stages (level, stage_name, created_by) VALUES (?, ?, ?)`,
                    [levelVal, evaluation_type, evaluatorId]
                );
                resolvedStageId = insertResult.insertId;
            }
        }

        // 3. Upsert marks for each student with total_marks
        for (const item of evaluations) {
            const studentId = Number(item.student_id);
            if (!studentId) continue;

            const marksObtained = Math.min(maxTotalMarks, Math.max(0, parseFloat(item.marks) || 0));
            const feedbackText = item.feedback ? String(item.feedback).trim() : '';

            let checkQuery = `SELECT mark_id FROM marks WHERE group_id = ? AND student_id = ? AND marked_by = ?`;
            const checkParams = [group_id, studentId, evaluatorId];

            if (resolvedStageId) {
                checkQuery += ` AND stage_id = ?`;
                checkParams.push(resolvedStageId);
            } else {
                checkQuery += ` AND stage_id IS NULL`;
            }

            const [existing] = await db.promise().query(checkQuery, checkParams);

            if (existing.length > 0) {
                await db.promise().query(
                    `UPDATE marks 
                     SET marks_obtained = ?, total_marks = ?, feedback = ? 
                     WHERE mark_id = ?`,
                    [marksObtained, maxTotalMarks, feedbackText, existing[0].mark_id]
                );
            } else {
                await db.promise().query(
                    `INSERT INTO marks (group_id, student_id, stage_id, marked_by, marks_obtained, total_marks, feedback, mark_type) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'stage')`,
                    [group_id, studentId, resolvedStageId, evaluatorId, marksObtained, maxTotalMarks, feedbackText]
                );
            }
        }

        // 4. Synchronize total_marks across existing evaluations for this stage/group so max mark is uniform
        if (resolvedStageId) {
            await db.promise().query(
                `UPDATE marks 
                 SET total_marks = ? 
                 WHERE group_id = ? AND stage_id = ?`,
                [maxTotalMarks, group_id, resolvedStageId]
            );
        }

        return res.status(200).json({
            success: true,
            message: 'Evaluation marks and feedback submitted successfully.'
        });

    } catch (error) {
        console.error('Database error (submitEvaluationMarks):', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to submit evaluation marks',
            error: error.message
        });
    }
};

module.exports = {
    getPanelsByEvaluator,
    getPanelsByDateAndEvaluator: getPanelsByEvaluator,
    getStudentsForPanel,
    checkEvaluatorStatus,
    getMyAssignedGroups,
    submitEvaluationMarks,
};
