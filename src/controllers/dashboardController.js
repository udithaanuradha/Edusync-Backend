const db = require('../config/db');

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const projectGroupsHasCreatedBy = async () => {
  try {
    const [rows] = await db.promise().query("SHOW COLUMNS FROM project_groups LIKE 'created_by'");
    return rows.length > 0;
  } catch (error) {
    console.warn('project_groups.created_by check failed in dashboard controller:', error.message);
    return false;
  }
};

const getCoordinatorSummary = async (req, res) => {
  try {
    // Extract coordinatorId from query parameters
    const coordinatorId = req.query.coordinatorId;

    // Build WHERE clause for filtering by coordinator (if coordinatorId is provided)
    const hasCoordinatorFilter = !!coordinatorId;
    const supportsCoordinatorTracking = hasCoordinatorFilter ? await projectGroupsHasCreatedBy() : false;
    const coordinatorParams = coordinatorId && supportsCoordinatorTracking ? [coordinatorId] : [];

    const projectGroupCoordinatorFilter = supportsCoordinatorTracking && hasCoordinatorFilter ? 'WHERE created_by = ?' : '';
    const projectGroupCoordinatorJoinFilter = supportsCoordinatorTracking && hasCoordinatorFilter ? 'AND pg.created_by = ?' : '';

    const totalProjectsQuery = `
      SELECT COUNT(*) AS totalProjects
      FROM project_groups
      ${projectGroupCoordinatorFilter}
    `;

    const activeStudentsQuery = `
      SELECT COUNT(*) AS activeStudents
      FROM users
      WHERE role = 'student'
    `;

    // A panel's evaluation_type ('Proposal'/'Code Review'/...) is matched to
    // project_stages by name WITHIN THE PANEL'S OWN academic_level — the
    // previous version picked an arbitrary stage_id sharing that name
    // anywhere in the system (any level, any coordinator) via a bare
    // `LIMIT 1` with no ORDER BY, so a group's marks almost never matched
    // the (wrong) stage_id it got compared against. Also excludes panels
    // already marked 'completed' (see calendarController's
    // completePanelsForGroups) — those aren't "pending" any more regardless
    // of whether marks exist yet.
    const pendingEvaluationsQuery = `
      SELECT COUNT(DISTINCT ep.id) AS pendingEvaluations
      FROM evaluation_panels ep
      LEFT JOIN project_groups pg ON pg.group_name = ep.target_group
      LEFT JOIN project_stages ps ON ps.level = ep.academic_level
        AND LOWER(TRIM(ps.stage_name)) = LOWER(TRIM(ep.evaluation_type))
      LEFT JOIN marks m ON m.group_id = pg.id AND m.stage_id = ps.stage_id AND m.mark_type = 'stage'
      WHERE ep.panel_date >= CURDATE()
        AND ep.status != 'completed'
        AND pg.id IS NOT NULL
        AND m.mark_id IS NULL
        ${projectGroupCoordinatorJoinFilter}
    `;

    // "Total stages" for completion purposes must be scoped to the GROUP'S
    // OWN LEVEL and deduplicated by name (matching the canonical-stage logic
    // Reports/Gradebook already uses in marksController's
    // computeLevelMarksSummary) — the previous `(SELECT COUNT(*) FROM
    // project_stages)` counted every stage row across every level and every
    // coordinator system-wide (e.g. 11, when a group's own level realistically
    // has 3-4), making "fully evaluated" nearly unreachable and the progress
    // percentage meaningless.
    // A project is "Completed" once its FINAL stage has been evaluated —
    // matches the same rule already applied to Calendar panel completion
    // (the whole evaluation cycle ends at Final, not per-stage). This is
    // also more robust than counting "all stages marked": a stage that was
    // later replaced/recreated can leave old marks rows with a NULL
    // stage_id (no FK match any more), which silently undercounts a
    // marked-every-stage check but never affects a Final-specific one,
    // since Final's own marks still carry a valid stage_id.
    const finalStageMarkedSubquery = `
      EXISTS (
        SELECT 1 FROM marks m
        JOIN project_stages ps ON ps.stage_id = m.stage_id
        WHERE m.group_id = pg.id AND ps.level = pg.level
          AND LOWER(TRIM(ps.stage_name)) = 'final'
      )
    `;

    const completedProjectsQuery = `
      SELECT COUNT(*) AS completedProjects
      FROM project_groups pg
      ${projectGroupCoordinatorFilter}
      ${projectGroupCoordinatorFilter ? 'AND' : 'WHERE'} ${finalStageMarkedSubquery}
    `;

    const recentProjectsQuery = `
      SELECT
        pg.id AS projectId,
        pg.group_name AS groupName,
        COALESCE(u.name, 'Unassigned') AS supervisorName,
        CASE
          WHEN ${finalStageMarkedSubquery} THEN 'Completed'
          WHEN COALESCE(progress.marked_count, 0) > 0 THEN 'In Progress'
          ELSE 'Pending Approval'
        END AS status,
        CASE
          WHEN ${finalStageMarkedSubquery} THEN 100
          WHEN (SELECT COUNT(DISTINCT LOWER(TRIM(stage_name))) FROM project_stages WHERE level = pg.level) = 0 THEN 0
          ELSE ROUND((COALESCE(progress.marked_count, 0) / (SELECT COUNT(DISTINCT LOWER(TRIM(stage_name))) FROM project_stages WHERE level = pg.level)) * 100)
        END AS progress,
        COALESCE(progress.last_activity, pg.created_at) AS updatedAt
      FROM project_groups pg
      LEFT JOIN users u ON u.id = pg.supervisor_id
      LEFT JOIN (
        SELECT
          m.group_id,
          COUNT(DISTINCT LOWER(TRIM(ps.stage_name))) AS marked_count,
          MAX(m.created_at) AS last_activity
        FROM marks m
        JOIN project_stages ps ON ps.stage_id = m.stage_id
        WHERE m.mark_type = 'stage'
        GROUP BY m.group_id
      ) progress ON progress.group_id = pg.id
      ${projectGroupCoordinatorFilter}
      ORDER BY COALESCE(progress.last_activity, pg.created_at) DESC
      LIMIT 4
    `;

    // Sourced from evaluation_panels (the actual scheduled/completed panels
    // the Calendar page manages), not project_stages.deadline — a stage's
    // deadline is a shared template field for every group at that level and
    // has no relationship to whether a given group's panel is done, so it
    // kept "upcoming" stale long after a group's panels were marked
    // completed on the Calendar.
    const upcomingDeadlinesQuery = `
      SELECT
        ep.id AS id,
        ep.panel_date AS date,
        ep.evaluation_type AS title,
        ep.academic_level AS academicLevel,
        ep.start_time AS startTime,
        ep.target_group AS targetGroup,
        ep.location AS location
      FROM evaluation_panels ep
      LEFT JOIN project_groups pg ON pg.group_name = ep.target_group
      WHERE ep.panel_date >= CURDATE()
        AND ep.status != 'completed'
        ${supportsCoordinatorTracking && hasCoordinatorFilter ? 'AND pg.created_by = ?' : ''}
      ORDER BY ep.panel_date ASC, ep.start_time ASC
      LIMIT 3
    `;

    // Build parameter arrays for each query
    const totalProjectsParams = coordinatorParams;
    const pendingEvaluationsParams = coordinatorParams;
    const completedProjectsParams = coordinatorParams;
    const recentProjectsParams = coordinatorParams;
    const upcomingDeadlinesParams = coordinatorParams;

    const [
      [totalProjectsRows],
      [activeStudentsRows],
      [pendingEvaluationsRows],
      [completedProjectsRows],
      [recentProjectsRows],
      [upcomingDeadlinesRows],
    ] = await Promise.all([
      db.promise().query(totalProjectsQuery, totalProjectsParams),
      db.promise().query(activeStudentsQuery),
      db.promise().query(pendingEvaluationsQuery, pendingEvaluationsParams),
      db.promise().query(completedProjectsQuery, completedProjectsParams),
      db.promise().query(recentProjectsQuery, recentProjectsParams),
      db.promise().query(upcomingDeadlinesQuery, upcomingDeadlinesParams),
    ]);

    const statsRow = {
      totalProjects: toNumber(totalProjectsRows?.[0]?.totalProjects),
      activeStudents: toNumber(activeStudentsRows?.[0]?.activeStudents),
      pendingEvaluations: toNumber(pendingEvaluationsRows?.[0]?.pendingEvaluations),
      completedProjects: toNumber(completedProjectsRows?.[0]?.completedProjects),
    };

    const recentProjects = Array.isArray(recentProjectsRows)
      ? recentProjectsRows.map((row) => ({
          projectId: row.projectId,
          groupName: row.groupName,
          supervisorName: row.supervisorName,
          status: row.status,
          progress: toNumber(row.progress),
          updatedAt: row.updatedAt,
        }))
      : [];

    const upcomingDeadlines = Array.isArray(upcomingDeadlinesRows)
      ? upcomingDeadlinesRows.map((row) => ({
          id: row.id,
          date: row.date,
          title: row.title,
          academicLevel: toNumber(row.academicLevel),
          startTime: row.startTime,
          targetGroup: row.targetGroup,
          location: row.location,
        }))
      : [];

    res.json({
      success: true,
      data: {
        stats: statsRow,
        recentProjects,
        upcomingDeadlines,
      },
    });
  } catch (error) {
    console.error('Error fetching coordinator dashboard summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch coordinator dashboard summary.',
    });
  }
};

const getStudentSummary = async (req, res) => {
  try {
    const studentId = req.params.studentId;

    const recentProjectsQuery = `
      SELECT
        pg.id AS projectId,
        pg.group_name AS groupName,
        COALESCE(u.name, 'Unassigned') AS supervisorName,
        CASE
          WHEN COALESCE(progress.marked_count, 0) >= (SELECT COUNT(*) FROM project_stages)
           AND (SELECT COUNT(*) FROM project_stages) > 0
            THEN 'Completed'
          WHEN COALESCE(progress.marked_count, 0) > 0
            THEN 'In Progress'
          ELSE 'Pending Approval'
        END AS status,
        CASE
          WHEN (SELECT COUNT(*) FROM project_stages) = 0 THEN 0
          ELSE ROUND((COALESCE(progress.marked_count, 0) / (SELECT COUNT(*) FROM project_stages)) * 100)
        END AS progress,
        COALESCE(progress.last_activity, pg.created_at) AS updatedAt
      FROM project_groups pg
      JOIN project_group_members gm ON pg.id = gm.group_id
      LEFT JOIN users u ON u.id = pg.supervisor_id
      LEFT JOIN (
        SELECT
          group_id,
          COUNT(DISTINCT stage_id) AS marked_count,
          MAX(created_at) AS last_activity
        FROM marks
        WHERE mark_type = 'stage'
        GROUP BY group_id
      ) progress ON progress.group_id = pg.id
      WHERE gm.student_id = ?
      ORDER BY COALESCE(progress.last_activity, pg.created_at) DESC
      LIMIT 4
    `;

    const upcomingDeadlinesQuery = `
      (
        SELECT
          ps.stage_id AS id,
          COALESCE(ps.deadline, CURDATE()) AS date,
          ps.stage_name AS title,
          NULL AS academicLevel,
          NULL AS startTime,
          'Project Stage' AS targetGroup,
          NULL AS location
        FROM project_stages ps
        WHERE ps.deadline IS NOT NULL
          AND ps.deadline >= CURDATE()
      )
      UNION ALL
      (
        SELECT
          t.id AS id,
          COALESCE(t.due_date, CURDATE()) AS date,
          t.task_name AS title,
          NULL AS academicLevel,
          NULL AS startTime,
          'Personal Task' AS targetGroup,
          NULL AS location
        FROM student_tasks t
        JOIN milestones m ON t.milestone_id = m.id
        WHERE t.assigned_to = ?
          AND t.due_date IS NOT NULL
          AND t.due_date >= CURDATE()
          AND t.status != 'COMPLETED'
      )
      ORDER BY date ASC
      LIMIT 5
    `;

    // The student's own active group — students can only ever belong to one
    // live group at a time (see groupController.js's already-grouped-member
    // checks), so there's no real "which project" ambiguity to resolve here.
    // Ordered the same way recentProjectsQuery above is, so if a stale extra
    // group row ever exists the summary cards below stay scoped to the same
    // project "Recent Projects" surfaces first.
    const activeGroupQuery = `
      SELECT pg.id AS groupId
      FROM project_groups pg
      JOIN project_group_members gm ON gm.group_id = pg.id
      LEFT JOIN (
        SELECT group_id, MAX(created_at) AS last_activity
        FROM marks WHERE mark_type = 'stage' GROUP BY group_id
      ) progress ON progress.group_id = pg.id
      WHERE gm.student_id = ?
      ORDER BY COALESCE(progress.last_activity, pg.created_at) DESC
      LIMIT 1
    `;

    const [
      [recentProjectsRows],
      [upcomingDeadlinesRows],
      [activeGroupRows],
    ] = await Promise.all([
      db.promise().query(recentProjectsQuery, [studentId]),
      db.promise().query(upcomingDeadlinesQuery, [studentId]),
      db.promise().query(activeGroupQuery, [studentId]),
    ]);

    const recentProjects = Array.isArray(recentProjectsRows)
      ? recentProjectsRows.map((row) => ({
          projectId: row.projectId,
          groupName: row.groupName,
          supervisorName: row.supervisorName,
          status: row.status,
          progress: toNumber(row.progress),
          updatedAt: row.updatedAt,
        }))
      : [];

    const upcomingDeadlines = Array.isArray(upcomingDeadlinesRows)
      ? upcomingDeadlinesRows.map((row) => ({
          id: row.id,
          date: row.date,
          title: row.title,
          academicLevel: toNumber(row.academicLevel),
          startTime: row.startTime,
          targetGroup: row.targetGroup,
          location: row.location,
        }))
      : [];

    // Dashboard Overview's 5 summary cards (MyProjectStatus.tsx). Scoped to
    // the same active group as everything above — Completion and Tasks Done
    // share one task dataset (the group's full student_tasks list, same as
    // the Project Management task board's getTasksByGroup) so the percentage
    // always matches the completed/total ratio shown. Delayed reuses the
    // exact same overdue predicate as getMentorProjectDelays
    // (mentorController.js). Deadline reuses upcomingDeadlines above rather
    // than a separate query — it's just that array's soonest entry.
    const activeGroupId = activeGroupRows?.[0]?.groupId || null;

    let stats = {
      completionPercent: null,
      completedTasksCount: 0,
      totalTasksCount: 0,
      delayedCount: 0,
      membersCount: 0,
    };

    if (activeGroupId) {
      const [
        [taskStatsRows],
        [delayedRows],
        [memberRows],
      ] = await Promise.all([
        db.promise().query(
          `SELECT
             COUNT(*) AS totalTasksCount,
             SUM(CASE WHEN UPPER(TRIM(t.status)) = 'COMPLETED' THEN 1 ELSE 0 END) AS completedTasksCount
           FROM student_tasks t
           JOIN milestones m ON t.milestone_id = m.id
           WHERE m.group_id = ?`,
          [activeGroupId]
        ),
        db.promise().query(
          `SELECT COUNT(*) AS delayedCount
           FROM student_tasks t
           JOIN milestones m ON t.milestone_id = m.id
           WHERE m.group_id = ?
             AND UPPER(TRIM(t.status)) != 'COMPLETED'
             AND t.due_date IS NOT NULL
             AND t.due_date < CURRENT_DATE`,
          [activeGroupId]
        ),
        db.promise().query(
          `SELECT COUNT(*) AS membersCount FROM project_group_members WHERE group_id = ?`,
          [activeGroupId]
        ),
      ]);

      const totalTasksCount = toNumber(taskStatsRows?.[0]?.totalTasksCount);
      const completedTasksCount = toNumber(taskStatsRows?.[0]?.completedTasksCount);

      stats = {
        completionPercent: totalTasksCount > 0 ? Math.round((completedTasksCount / totalTasksCount) * 100) : null,
        completedTasksCount,
        totalTasksCount,
        delayedCount: toNumber(delayedRows?.[0]?.delayedCount),
        membersCount: toNumber(memberRows?.[0]?.membersCount),
      };
    }

    const nearestDeadline = upcomingDeadlines.length > 0 ? upcomingDeadlines[0] : null;

    res.json({
      success: true,
      data: {
        recentProjects,
        upcomingDeadlines,
        stats: { ...stats, nearestDeadline },
      },
    });
  } catch (error) {
    console.error('Error fetching student dashboard summary:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch student dashboard summary.',
    });
  }
};

const { getMentorDashboard } = require('./mentorController');

const getMentorSummary = async (req, res) => {
  return getMentorDashboard(req, res);
};

module.exports = {
  getCoordinatorSummary,
  getStudentSummary,
  getMentorSummary,
};