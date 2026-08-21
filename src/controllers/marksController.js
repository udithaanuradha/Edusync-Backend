const db = require('../config/db');

const getCoordinatorSubmissionTracking = async (req, res) => {
  try {
    const level = Number(req.params.level ?? req.query.level ?? 0);

    if (!level) {
      return res.status(400).json({ success: false, message: 'A valid level is required.' });
    }

    const query = `
      SELECT
        ss.submission_id,
        ss.stage_id,
        ss.student_id,
        ss.file_paths,
        ss.submitted_at,
        ss.status,
        ps.stage_name,
        ps.deadline,
        COALESCE(pg.group_name, 'Student Submission') AS group_name,
        COALESCE(u.name, 'Not assigned') AS evaluator_name,
        NULL AS mark,
        'submission' AS mark_type
      FROM student_submissions ss
      LEFT JOIN project_stages ps ON ps.stage_id = ss.stage_id
      LEFT JOIN project_group_members pgm ON pgm.student_id = ss.student_id
      LEFT JOIN project_groups pg ON pg.id = pgm.group_id AND pg.level = ?
      LEFT JOIN users u ON u.id = pg.created_by
      WHERE ps.level = ?
      ORDER BY ss.submitted_at DESC
    `;

    const [rows] = await db.promise().query(query, [level, level]);

    const normalized = (rows || []).map((row) => ({
      ...row,
      group_id: row.group_id ?? null,
      group_name: row.group_name || 'Student Submission',
      submission_date: row.submitted_at || null,
      submitted_at: row.submitted_at || null,
      current_status: row.status || 'submitted',
      mark: row.mark ?? null,
      evaluator_name: row.evaluator_name || 'Not assigned',
      mark_type: row.mark_type || 'submission',
      file_paths: typeof row.file_paths === 'string' ? JSON.parse(row.file_paths) : row.file_paths || [],
    }));

    return res.json({ success: true, data: normalized });
  } catch (error) {
    console.error('Error fetching coordinator submission tracking:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch submission tracking data.' });
  }
};

// Get all marks for Coordinator View
const getStageMarks = async (req, res) => {
    try {
        const sql = `
            SELECT 
                m.mark_id,
                m.group_id,
                m.student_id,
                m.stage_id,
                m.marked_by,
                m.marks_obtained,
                m.total_marks,
                m.feedback,
                m.created_at,
                u.name AS student_name,
                u.university_id,
                u.email,
                u.academic_unit,
                u.academic_unit AS department,
                pg.group_name,
                pg.department AS group_department,
                ps.stage_name,
                ps.level,
                eval.name AS evaluator_name
            FROM marks m
            LEFT JOIN users u ON u.id = m.student_id
            LEFT JOIN project_groups pg ON pg.id = m.group_id
            LEFT JOIN project_stages ps ON ps.stage_id = m.stage_id
            LEFT JOIN users eval ON eval.id = m.marked_by
            ORDER BY m.created_at DESC
        `;
        const [rows] = await db.promise().query(sql);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error fetching marks:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

const submitMarks = async (req, res) => {
    const { group_id, stage_id, marked_by, marks_obtained, total_marks, feedback } = req.body;
    try {
        const sql = `
            INSERT INTO marks (group_id, stage_id, marked_by, marks_obtained, total_marks, feedback, mark_type) 
            VALUES (?, ?, ?, ?, ?, ?, 'stage')
        `;
        await db.promise().query(sql, [group_id, stage_id, marked_by, marks_obtained, total_marks || 100, feedback]);
        res.status(201).json({ message: 'Mark submitted successfully!' });
    } catch (error) {
        console.error('Error submitting mark:', error);
        res.status(500).json({ error: 'Failed to submit marks.' });
    }
};

/**
 * Marks Aggregation: Evaluators -> Stage Marks (Average) -> Final Mark {(Total Obtained / Total Max) * 100}%
 */
const getLevelMarksSummary = async (req, res) => {
    try {
        const level = Number(req.params.level || 2);
        const studentId = req.query.studentId ? Number(req.query.studentId) : null;

        // Fetch all project stages for this level
        const [rawStages] = await db.promise().query(
            `SELECT stage_id, stage_name, description, deadline FROM project_stages WHERE level = ? ORDER BY stage_id ASC`,
            [level]
        );

        // Normalize and deduplicate stages by normalized name (case-insensitive)
        const stageMap = new Map();
        const canonicalStages = [];

        rawStages.forEach((stg) => {
            const rawName = String(stg.stage_name || '').trim();
            const normalizedKey = rawName.toLowerCase();
            const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();

            if (!stageMap.has(normalizedKey)) {
                const stageObj = {
                    canonical_id: stg.stage_id,
                    stage_name: displayName,
                    stage_ids: [stg.stage_id],
                    description: stg.description || '',
                    deadline: stg.deadline || null
                };
                stageMap.set(normalizedKey, stageObj);
                canonicalStages.push(stageObj);
            } else {
                stageMap.get(normalizedKey).stage_ids.push(stg.stage_id);
            }
        });

        // Fetch all students in groups for this level
        // Department is taken directly from users table's academic_unit column
        const [students] = await db.promise().query(
            `SELECT 
                u.id AS student_id,
                u.name AS student_name,
                u.university_id,
                u.email,
                u.academic_unit,
                pg.id AS group_id,
                pg.group_name,
                pg.department AS group_department,
                pgm.is_leader,
                sup.name AS supervisor_name
             FROM project_groups pg
             JOIN project_group_members pgm ON pgm.group_id = pg.id
             JOIN users u ON u.id = pgm.student_id
             LEFT JOIN users sup ON sup.id = pg.supervisor_id
             WHERE pg.level = ?
             ORDER BY pg.group_name ASC, pgm.is_leader DESC, u.name ASC`,
            [level]
        );

        if (students.length === 0) {
            return res.json({ 
                success: true, 
                stages: canonicalStages.map(s => ({ stage_id: s.canonical_id, stage_name: s.stage_name })), 
                data: [] 
            });
        }

        // Fetch all marks for this level. Scoped by stage_id (via the canonical
        // stage list for this level), not group_id — a mark's group_id can go
        // stale if the group is later deleted/recreated, but student_id and
        // stage_id stay valid and are what the summary below actually matches
        // against, so filtering on group existence here only hid real marks
        // for no reason.
        const stageIds = canonicalStages.flatMap((s) => s.stage_ids);

        const [allMarks] = stageIds.length
            ? await db.promise().query(
                `SELECT
                    m.mark_id,
                    m.group_id,
                    m.student_id,
                    m.stage_id,
                    m.marked_by,
                    m.marks_obtained,
                    m.total_marks,
                    m.feedback,
                    u.name AS evaluator_name,
                    u.role AS evaluator_role
                 FROM marks m
                 JOIN users u ON u.id = m.marked_by
                 WHERE m.stage_id IN (?)`,
                [stageIds]
              )
            : [[]];

        // Build structured summary per student
        const summary = students.map((student) => {
            const studentMarks = allMarks.filter((m) => m.student_id === student.student_id);
            const stageBreakdown = {};
            let sumObtainedMarks = 0;
            let sumTotalMaxMarks = 0;
            let stagesEvaluatedCount = 0;

            canonicalStages.forEach((canonicalStg) => {
                const marksForThisStage = studentMarks.filter((m) => 
                    canonicalStg.stage_ids.includes(m.stage_id)
                );

                if (marksForThisStage.length > 0) {
                    const avg = marksForThisStage.reduce((sum, item) => sum + Number(item.marks_obtained), 0) / marksForThisStage.length;
                    const stageTotal = Number(marksForThisStage.find(m => m.total_marks)?.total_marks) || Number(marksForThisStage[0]?.total_marks) || 60;
                    const roundedAvg = Number(avg.toFixed(2));

                    stageBreakdown[canonicalStg.canonical_id] = {
                        stage_name: canonicalStg.stage_name,
                        average_mark: roundedAvg,
                        total_marks: stageTotal,
                        evaluator_count: marksForThisStage.length,
                        evaluators: marksForThisStage.map((sm) => ({
                            evaluator_name: sm.evaluator_name,
                            evaluator_role: sm.evaluator_role || '',
                            mark: Number(sm.marks_obtained),
                            total_marks: Number(sm.total_marks) || stageTotal,
                            feedback: sm.feedback || ''
                        }))
                    };

                    sumObtainedMarks += roundedAvg;
                    sumTotalMaxMarks += stageTotal;
                    stagesEvaluatedCount++;
                } else {
                    stageBreakdown[canonicalStg.canonical_id] = {
                        stage_name: canonicalStg.stage_name,
                        average_mark: null,
                        total_marks: 60,
                        evaluator_count: 0,
                        evaluators: []
                    };
                }
            });

            const finalPercentage = sumTotalMaxMarks > 0 
                ? Number(((sumObtainedMarks / sumTotalMaxMarks) * 100).toFixed(2))
                : 0;

            // Student's department / degree directly from users table's academic_unit column
            const unit = String(student.academic_unit || '').trim().toUpperCase();
            let degree = 'ITM';
            if (unit === 'ITM' || unit.includes('ITM') || unit.includes('MANAGEMENT')) {
                degree = 'ITM';
            } else if (unit === 'AI' || unit.includes('AI') || unit.includes('ARTIFICIAL')) {
                degree = 'AI';
            } else if (unit === 'IT' || unit.includes('INFORMATION')) {
                degree = 'IT';
            } else {
                degree = student.academic_unit || 'ITM';
            }

            return {
                student_id: student.student_id,
                student_name: student.student_name,
                university_id: student.university_id || 'N/A',
                degree: degree,
                academic_unit: student.academic_unit || degree,
                department: student.academic_unit || degree, // Directly from users table's academic_unit column
                group_id: student.group_id,
                group_name: student.group_name,
                group_department: student.group_department || '',
                supervisor_name: student.supervisor_name || 'Assigned Supervisor',
                is_leader: Boolean(student.is_leader),
                stages: stageBreakdown,
                sum_obtained_marks: Number(sumObtainedMarks.toFixed(2)),
                sum_total_max_marks: Number(sumTotalMaxMarks.toFixed(2)),
                final_mark: finalPercentage,
                stages_completed: stagesEvaluatedCount,
                total_stages: canonicalStages.length
            };
        });

        const responseData = studentId ? summary.filter((s) => s.student_id === studentId) : summary;

        return res.json({
            success: true,
            level: level,
            stages: canonicalStages.map(s => ({ stage_id: s.canonical_id, stage_name: s.stage_name })),
            data: responseData
        });

    } catch (error) {
        console.error('Error fetching level marks summary:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch marks summary', error: error.message });
    }
};

module.exports = { 
    getStageMarks, 
    submitMarks, 
    getCoordinatorSubmissionTracking,
    getLevelMarksSummary,
};
