const db = require('../config/db');
const dbPromise = db.promise();
const { extractProjectName } = require('../utils/extractProjectName');

// Percent of `completed` out of `total`, safe for total = 0.
const pct = (completed, total) => (total > 0 ? Math.round((completed / total) * 100) : 0);

/**
 * GET /api/supervice-st-progress/level/:level/supervisor/:supervisorId
 *
 * Overview list for the "Progress" tab: every group this supervisor owns at
 * this level, each with an overall task-completion percentage and a
 * milestone-approval count. Mirrors getSupervisorGroups() in
 * groupDetailsToSupervisorDashboardController.js (query + merge-in-JS, no
 * model layer) since this is the same kind of supervisor+level scoped
 * dashboard read.
 */
const getGroupsProgress = async (req, res) => {
  const level = Number(req.params.level);
  const supervisorId = req.params.supervisorId;

  try {
    const [groups] = await dbPromise.query(
      `SELECT pg.id AS groupId, pg.group_name AS groupName, pg.level
       FROM project_groups pg
       WHERE pg.level = ? AND (pg.supervisor_id = ? OR pg.supervisor_id_2 = ?)
       ORDER BY pg.id ASC`,
      [level, supervisorId, supervisorId]
    );

    if (!groups.length) {
      return res.json([]);
    }

    const groupIds = groups.map((g) => g.groupId);

    const [memberCounts] = await dbPromise.query(
      `SELECT group_id, COUNT(*) AS memberCount
       FROM project_group_members
       WHERE group_id IN (?)
       GROUP BY group_id`,
      [groupIds]
    );

    const [milestones] = await dbPromise.query(
      `SELECT id, group_id, status
       FROM milestones
       WHERE group_id IN (?)`,
      [groupIds]
    );

    const milestoneIds = milestones.map((m) => m.id);

    const [tasks] = milestoneIds.length
      ? await dbPromise.query(
          `SELECT id, milestone_id, status
           FROM student_tasks
           WHERE milestone_id IN (?)`,
          [milestoneIds]
        )
      : [[]];

    const milestoneToGroup = new Map(milestones.map((m) => [m.id, m.group_id]));

    // Same source as groupDetailsToSupervisorDashboardController.js's
    // projectName field: group_requests.request_message via
    // created_group_id, kept as its own query here rather than a shared
    // model so this controller's existing query+merge-in-JS style (per its
    // own file comment) isn't disturbed.
    const [projectRequests] = await dbPromise.query(
      `SELECT created_group_id, request_message
       FROM group_requests
       WHERE created_group_id IN (?)`,
      [groupIds]
    );
    const projectNamesByGroupId = new Map();
    projectRequests.forEach((row) => {
      const name = extractProjectName(row.request_message);
      if (name) projectNamesByGroupId.set(row.created_group_id, name);
    });

    const formattedData = groups.map((group) => {
      const groupMilestones = milestones.filter((m) => m.group_id === group.groupId);
      const groupTasks = tasks.filter(
        (t) => milestoneToGroup.get(t.milestone_id) === group.groupId
      );

      const totalTasks = groupTasks.length;
      const completedTasks = groupTasks.filter((t) => t.status === 'COMPLETED').length;
      const totalMilestones = groupMilestones.length;
      const approvedMilestones = groupMilestones.filter((m) => m.status === 'APPROVED').length;
      const memberCountRow = memberCounts.find((m) => m.group_id === group.groupId);

      return {
        groupId: group.groupId,
        groupName: group.groupName,
        level: group.level,
        memberCount: memberCountRow ? Number(memberCountRow.memberCount) : 0,
        totalTasks,
        completedTasks,
        progressPercent: pct(completedTasks, totalTasks),
        totalMilestones,
        approvedMilestones,
        projectName: projectNamesByGroupId.get(group.groupId) || null,
      };
    });

    return res.json(formattedData);
  } catch (error) {
    console.error('Error fetching supervisor groups progress:', error);
    return res.status(500).json({ error: 'Failed to fetch groups progress' });
  }
};

/**
 * GET /api/supervice-st-progress/group/:groupId
 *
 * Drill-down for one group: overall progress, per-milestone progress, and
 * per-student progress (assigned tasks completed vs total assigned).
 * Students with zero assigned tasks are still included, since we start from
 * the members list rather than from student_tasks.
 */
const getGroupProgressDetail = async (req, res) => {
  const { groupId } = req.params;
  const userRole = req.headers['x-user-role'];

  // This is a supervisor-facing drill-down; students have their own "My
  // Tasks" views for this data, so block them here (same guard style as
  // updateMilestoneStatus in milestoneController.js).
  if (userRole === 'student') {
    return res.status(403).json({ success: false, error: 'Access denied.' });
  }

  try {
    const [groupRows] = await dbPromise.query(
      `SELECT id AS groupId, group_name AS groupName, level, supervisor_id AS supervisorId
       FROM project_groups WHERE id = ?`,
      [groupId]
    );

    if (!groupRows.length) {
      return res.status(404).json({ success: false, error: 'Group not found.' });
    }

    const [members] = await dbPromise.query(
      `SELECT gm.student_id AS id, u.name, u.university_id, gm.is_leader
       FROM project_group_members gm
       LEFT JOIN users u ON u.id = gm.student_id
       WHERE gm.group_id = ?
       ORDER BY gm.is_leader DESC, u.name ASC`,
      [groupId]
    );

    const [milestones] = await dbPromise.query(
      `SELECT id, title, description, status, start_date, due_date
       FROM milestones WHERE group_id = ? ORDER BY created_at ASC`,
      [groupId]
    );

    const [tasks] = await dbPromise.query(
      `SELECT t.id, t.milestone_id, t.assigned_to, t.task_name, t.description,
              t.status, t.due_date, t.created_at, u.name AS assigned_to_name
       FROM student_tasks t
       JOIN milestones m ON t.milestone_id = m.id
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE m.group_id = ?`,
      [groupId]
    );

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t) => t.status === 'COMPLETED').length;

    const milestoneTitleById = new Map(milestones.map((m) => [m.id, m.title]));
    const tasksWithContext = tasks.map((t) => ({
      id: t.id,
      milestone_id: t.milestone_id,
      milestone_title: milestoneTitleById.get(t.milestone_id) || '',
      assigned_to: t.assigned_to,
      assigned_to_name: t.assigned_to_name || 'Unassigned',
      task_name: t.task_name,
      description: t.description,
      status: t.status,
      due_date: t.due_date,
      created_at: t.created_at,
    }));

    const milestonesWithProgress = milestones.map((m) => {
      const mTasks = tasks.filter((t) => t.milestone_id === m.id);
      const completed = mTasks.filter((t) => t.status === 'COMPLETED').length;
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        status: m.status,
        start_date: m.start_date,
        due_date: m.due_date,
        total: mTasks.length,
        completed,
        percent: pct(completed, mTasks.length),
      };
    });

    const membersWithProgress = members.map((member) => {
      const memberTasks = tasks.filter((t) => t.assigned_to === member.id);
      const completed = memberTasks.filter((t) => t.status === 'COMPLETED').length;
      return {
        id: member.id,
        name: member.name || 'Unknown Student',
        university_id: member.university_id,
        is_leader: member.is_leader,
        total: memberTasks.length,
        completed,
        percent: pct(completed, memberTasks.length),
      };
    });

    res.status(200).json({
      success: true,
      data: {
        group: {
          id: groupRows[0].groupId,
          name: groupRows[0].groupName,
          level: groupRows[0].level,
        },
        overall: {
          total: totalTasks,
          completed: completedTasks,
          percent: pct(completedTasks, totalTasks),
        },
        milestones: milestonesWithProgress,
        members: membersWithProgress,
        tasks: tasksWithContext,
      },
    });
  } catch (error) {
    console.error('Error fetching group progress detail:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch group progress detail.' });
  }
};

module.exports = { getGroupsProgress, getGroupProgressDetail };
