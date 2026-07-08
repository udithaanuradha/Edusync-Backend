const db = require('../config/db');

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getCoordinatorSummary = async (req, res) => {
  try {
    // Extract coordinatorId from query parameters
    const coordinatorId = req.query.coordinatorId;
    
    // Build WHERE clause for filtering by coordinator (if coordinatorId is provided)
    const hasCoordinatorFilter = !!coordinatorId;
    const coordinatorParams = coordinatorId ? [coordinatorId] : [];

    const totalProjectsQuery = `
      SELECT COUNT(*) AS totalProjects
      FROM project_groups
      ${hasCoordinatorFilter ? 'WHERE created_by = ?' : ''}
    `;

    const activeStudentsQuery = `
      SELECT COUNT(*) AS activeStudents
      FROM users
      WHERE role = 'student'
    `;

    const pendingEvaluationsQuery = `
      WITH stage_mapping AS (
        SELECT stage_id, stage_name FROM project_stages
      ),
      panel_groups AS (
        SELECT 
          ep.id as panel_id,
          pg.id as group_id,
          CASE
            WHEN ep.evaluation_type = 'proposal' THEN (SELECT stage_id FROM stage_mapping WHERE stage_name = 'Proposal' LIMIT 1)
            WHEN ep.evaluation_type = 'code review' THEN (SELECT stage_id FROM stage_mapping WHERE stage_name = 'Code Review' LIMIT 1)
            WHEN ep.evaluation_type = 'interim' THEN (SELECT stage_id FROM stage_mapping WHERE stage_name = 'Interim' LIMIT 1)
            WHEN ep.evaluation_type = 'final' THEN (SELECT stage_id FROM stage_mapping WHERE stage_name = 'Final' LIMIT 1)
            ELSE NULL
          END as stage_id
        FROM evaluation_panels ep
        LEFT JOIN project_groups pg ON pg.group_name = ep.target_group
        WHERE ep.panel_date >= CURDATE()
          ${hasCoordinatorFilter ? 'AND pg.created_by = ?' : ''}
      )
      SELECT COUNT(DISTINCT panel_id) AS pendingEvaluations
      FROM panel_groups pg_info
      LEFT JOIN marks m ON m.group_id = pg_info.group_id 
        AND m.stage_id = pg_info.stage_id
        AND m.mark_type = 'stage'
      WHERE pg_info.group_id IS NOT NULL
        AND m.mark_id IS NULL
    `;

    const completedProjectsQuery = `
      SELECT COUNT(*) AS completedProjects
      FROM (
        SELECT
          pg.id,
          COALESCE(mark_summary.marked_stages, 0) AS marked_stages,
          (SELECT COUNT(*) FROM project_stages) AS totalStages
        FROM project_groups pg
        LEFT JOIN (
          SELECT group_id, COUNT(DISTINCT stage_id) AS marked_stages
          FROM marks
          WHERE mark_type = 'stage'
          GROUP BY group_id
        ) mark_summary ON mark_summary.group_id = pg.id
        ${hasCoordinatorFilter ? 'WHERE created_by = ?' : ''}
      ) completed_groups
      WHERE completed_groups.totalStages > 0
        AND completed_groups.marked_stages >= completed_groups.totalStages
    `;

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
      ${hasCoordinatorFilter ? 'WHERE created_by = ?' : ''}
      ORDER BY COALESCE(progress.last_activity, pg.created_at) DESC
      LIMIT 4
    `;

    const upcomingDeadlinesQuery = `
      SELECT
        ps.stage_id AS id,
        COALESCE(ps.deadline, CURDATE()) AS date,
        ps.stage_name AS title,
        NULL AS academicLevel,
        NULL AS startTime,
        NULL AS targetGroup,
        NULL AS location
      FROM project_stages ps
      ${hasCoordinatorFilter ? 'WHERE created_by = ?' : 'WHERE ps.deadline IS NOT NULL AND ps.deadline >= CURDATE()'}
      ${!hasCoordinatorFilter ? '' : 'AND ps.deadline IS NOT NULL AND ps.deadline >= CURDATE()'}
      ORDER BY ps.deadline ASC, ps.stage_id ASC
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

module.exports = {
  getCoordinatorSummary,
};