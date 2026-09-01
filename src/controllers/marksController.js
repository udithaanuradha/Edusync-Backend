const db = require('../config/db');
const PDFDocument = require('pdfkit');

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
 * Shared by getLevelMarksSummary (JSON, used by the Reports/Gradebook UI) and
 * downloadMarksDistributionPdf (PDF report) so both stay consistent — pulled
 * out as a plain data function (no req/res) rather than duplicating the
 * aggregation logic in the PDF handler.
 */
const computeLevelMarksSummary = async (level) => {
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
            return {
                stages: canonicalStages.map(s => ({ stage_id: s.canonical_id, stage_name: s.stage_name })),
                data: []
            };
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

        return {
            stages: canonicalStages.map(s => ({ stage_id: s.canonical_id, stage_name: s.stage_name })),
            data: summary
        };
};

/**
 * GET /api/marks/summary/level/:level — JSON wrapper around
 * computeLevelMarksSummary, used by the Reports/Gradebook UI, and by the
 * student Marks tab (via the optional ?studentId= query param) to scope the
 * response down to just that student's own row.
 */
const getLevelMarksSummary = async (req, res) => {
    try {
        const level = Number(req.params.level || 2);
        const studentId = req.query.studentId ? Number(req.query.studentId) : null;
        const { stages, data } = await computeLevelMarksSummary(level);
        const scopedData = studentId ? data.filter((s) => s.student_id === studentId) : data;
        return res.json({ success: true, level, stages, data: scopedData });
    } catch (error) {
        console.error('Error fetching level marks summary:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch marks summary', error: error.message });
    }
};

/**
 * GET /api/marks/report/level/:level/pdf
 * Streams a PDF "Marks Distribution Report" for a level: summary stats
 * (mean/median/std-dev/pass rate) plus a histogram of final marks with a
 * normal-distribution (bell curve) overlay fitted to that mean/std-dev.
 * Drawn directly with PDFKit's vector primitives (rect/line/bezier) rather
 * than a charting library + canvas — see the chat discussion for why:
 * avoids a native `canvas` dependency and headless-Chromium (Puppeteer)
 * entirely, which matters for a small Node/Express backend like this one.
 * No chart is ever rendered in the React UI — this is the only place the
 * distribution is visualized, by design.
 */
const downloadMarksDistributionPdf = async (req, res) => {
    try {
        const level = Number(req.params.level || 2);
        const { data: students } = await computeLevelMarksSummary(level);

        const marks = students
            .map((s) => Number(s.final_mark))
            .filter((m) => Number.isFinite(m));

        const n = marks.length;
        const mean = n > 0 ? marks.reduce((a, b) => a + b, 0) / n : 0;
        const variance = n > 0 ? marks.reduce((a, b) => a + (b - mean) ** 2, 0) / n : 0;
        const stdDev = Math.sqrt(variance);
        const sorted = [...marks].sort((a, b) => a - b);
        const median = n === 0
            ? 0
            : n % 2 === 0
                ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
                : sorted[(n - 1) / 2];
        // 35% matches the 'I' (incomplete/fail) cutoff already used for pass
        // rate on the Reports tab (SupervisorReportPanel.tsx's GRADING_SCALE).
        const passCount = marks.filter((m) => m >= 35).length;
        const passRate = n > 0 ? (passCount / n) * 100 : 0;

        // Histogram: 10-point buckets, 0-9 ... 90-100 (100 folds into the last bucket).
        const bucketSize = 10;
        const bucketCount = 10;
        const buckets = new Array(bucketCount).fill(0);
        marks.forEach((m) => {
            const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor(m / bucketSize)));
            buckets[idx] += 1;
        });
        const maxBucketCount = Math.max(...buckets, 1);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Level_${level}_Marks_Distribution_Report.pdf"`);

        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        doc.pipe(res);

        // ---- Header ----
        doc.fontSize(20).font('Helvetica-Bold').text(`Level ${level} — Marks Distribution Report`, { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica').fillColor('#666666')
            .text(`Generated on ${new Date().toLocaleString()}`, { align: 'center' });
        doc.fillColor('#000000');
        doc.moveDown(1.5);

        // ---- Summary stats ----
        doc.fontSize(12).font('Helvetica-Bold').text('Summary');
        doc.moveDown(0.4);
        doc.fontSize(10).font('Helvetica');
        [
            `Total Students: ${n}`,
            `Mean: ${mean.toFixed(2)}%`,
            `Pass Rate: ${passRate.toFixed(1)}% (${passCount}/${n})`,
        ].forEach((line) => doc.text(line));
        doc.moveDown(1.5);

        // ---- Chart: histogram bars + bell curve overlay ----
        doc.fontSize(12).font('Helvetica-Bold').text('Marks Distribution');
        doc.moveDown(0.5);

        const chartX = doc.page.margins.left;
        const chartTop = doc.y;
        const chartWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const chartHeight = 250;
        const plotHeight = chartHeight - 20; // headroom so the tallest bar/curve peak isn't flush with the top

        const gaussianDensity = (x) =>
            stdDev > 0.001
                ? (1 / (stdDev * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - mean) / stdDev) ** 2)
                : 0;
        const drawCurve = stdDev > 0.001 && n > 1;

        // Bars and the bell curve share one vertical scale so neither clips —
        // a tight cluster of marks (small stdDev) produces a curve peak far
        // taller than any single bar, so the scale must be based on whichever
        // is larger, not the bars alone.
        const curvePeak = drawCurve ? gaussianDensity(mean) * bucketSize * n : 0;
        const plotMax = Math.max(maxBucketCount, curvePeak, 1);

        // Axes
        doc.strokeColor('#333333').lineWidth(1);
        doc.moveTo(chartX, chartTop).lineTo(chartX, chartTop + chartHeight).stroke();
        doc.moveTo(chartX, chartTop + chartHeight).lineTo(chartX + chartWidth, chartTop + chartHeight).stroke();

        // Bars
        const bucketWidth = chartWidth / bucketCount;
        const barGap = 4;
        buckets.forEach((count, i) => {
            const barHeight = (count / plotMax) * plotHeight;
            const barX = chartX + i * bucketWidth + barGap / 2;
            const barY = chartTop + chartHeight - barHeight;
            doc.rect(barX, barY, bucketWidth - barGap, barHeight).fill('#93c5fd');
        });

        // X-axis bucket labels
        doc.fillColor('#333333').fontSize(7).font('Helvetica');
        buckets.forEach((_, i) => {
            const label = i === bucketCount - 1 ? '90-100' : `${i * 10}-${i * 10 + 9}`;
            doc.text(label, chartX + i * bucketWidth, chartTop + chartHeight + 4, { width: bucketWidth, align: 'center' });
        });

        // Bell curve: normal distribution fitted to mean/stdDev, scaled to the
        // same "expected count per bucket" axis as the histogram bars (via
        // plotMax above) so the two are visually comparable and neither clips.
        if (drawCurve) {
            const steps = 100;
            const points = [];
            for (let i = 0; i <= steps; i += 1) {
                const x = (i / steps) * 100;
                const expectedCount = gaussianDensity(x) * bucketSize * n;
                const plotX = chartX + (x / 100) * chartWidth;
                const plotY = chartTop + chartHeight - (expectedCount / plotMax) * plotHeight;
                points.push([plotX, plotY]);
            }

            doc.strokeColor('#dc2626').lineWidth(2);
            doc.moveTo(points[0][0], points[0][1]);
            points.slice(1).forEach(([x, y]) => doc.lineTo(x, y));
            doc.stroke();
        }

        // Legend
        const legendY = chartTop + chartHeight + 26;
        doc.rect(chartX, legendY, 10, 10).fill('#93c5fd');
        doc.fillColor('#333333').fontSize(9).font('Helvetica').text('Number of students', chartX + 16, legendY - 1);
        doc.moveTo(chartX, legendY + 20).lineTo(chartX + 10, legendY + 20).strokeColor('#dc2626').lineWidth(2).stroke();
        doc.fillColor('#333333').text('Normal distribution (bell curve) fit', chartX + 16, legendY + 15);

        doc.end();
    } catch (error) {
        console.error('Error generating marks distribution PDF:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to generate PDF report', error: error.message });
        } else {
            res.end();
        }
    }
};

module.exports = {
    getStageMarks,
    submitMarks,
    getCoordinatorSubmissionTracking,
    getLevelMarksSummary,
    downloadMarksDistributionPdf,
};
