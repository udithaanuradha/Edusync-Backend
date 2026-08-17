const db = require('../config/db');
const Project = require('../models/projectModel');

// ── Constant ─────────────────────────────────────────────────────────────────
// All target_audience values that are Level 1 specific.
// Update this array if your DB uses different strings.
const LEVEL1_AUDIENCES = ['Level1', 'Level 1', 'Level1 Students', 'Level 1 Students'];

// ── 1. Get Stages ─────────────────────────────────────────────────────────────
// Blocks Level 1 stage guidelines for mentors.
exports.getMentorStages = (req, res) => {
  const { level } = req.params;
  const { user_role } = req.query;

  if (Number(level) === 1 && user_role === 'mentor') {
    return res.status(403).json({
      success: false,
      message: 'Industry mentors are not assigned to Level 1 stages.',
    });
  }

  Project.getStagesByLevel(level, null, (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, data: results });
  });
};

// ── 2. JS helper — filter Level 1 announcements out of a list ────────────────
//
// USE THIS in your existing announcementsController.js in the section that
// handles role === 'Mentor'. Just pipe the fetched list through this function
// before returning to the client.
//

exports.filterLevel1FromMentorAnnouncements = (announcements) => {
  return announcements.filter(
    (a) => !LEVEL1_AUDIENCES.includes((a.target_audience || '').trim())
  );
};

// ── 3. Standalone mentor announcements endpoint ──────────────────────────────
// Fetches all announcements a mentor can see, excluding Level 1 targeted ones.
// Used by GET /api/mentor/announcements (see mentorRoutes.js).
//
// FIX: This is the CORRECT endpoint for MentorAnnouncementsPage.tsx.
// The frontend must call /api/mentor/announcements — NOT /api/announcements?role=Mentor.
// The generic /api/announcements endpoint does NOT apply Level 1 filtering.
exports.getMentorAnnouncements = (req, res) => {
  const placeholders = LEVEL1_AUDIENCES.map(() => '?').join(', ');

  // Fetch all announcements whose target_audience is NOT Level 1 specific.
  // Also includes announcements with NULL target_audience (system-wide ones).
  const query = `
    SELECT *
    FROM announcements
    WHERE (
      target_audience NOT IN (${placeholders})
      OR target_audience IS NULL
    )
    ORDER BY created_at DESC
  `;

  db.query(query, LEVEL1_AUDIENCES, (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, announcements: results });
  });
};

// ── 4. Single announcement — blocks Level 1 targeted ones for mentors ────────
exports.getMentorAnnouncementById = (req, res) => {
  const { id } = req.params;

  db.query('SELECT * FROM announcements WHERE id = ?', [id], (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (!results.length) return res.status(404).json({ success: false, message: 'Not found' });

    const announcement = results[0];

    if (LEVEL1_AUDIENCES.includes((announcement.target_audience || '').trim())) {
      return res.status(403).json({
        success: false,
        message: 'Industry mentors do not have access to Level 1 announcements.',
      });
    }

    res.json({ success: true, data: announcement });
  });
};

// ── 5. Mentor Dashboard Summary Endpoint ───────────────────────────────────
// GET /api/mentor/dashboard/:mentorId or GET /api/mentor/dashboard?mentorId=...
exports.getMentorDashboard = async (req, res) => {
  try {
    const mentorId = req.params.mentorId || req.query.mentorId || req.headers['x-user-id'];
    const dbPromise = db.promise();

    if (!mentorId) {
      return res.status(400).json({
        success: false,
        message: 'Mentor ID is required.',
      });
    }

    // 1. Fetch mentor profile
    const [mentorRows] = await dbPromise.query(
      'SELECT id, name, email, role, phone, academic_unit, level FROM users WHERE id = ?',
      [mentorId]
    );

    const mentorInfo = mentorRows.length > 0 ? mentorRows[0] : null;

    // 2. Fetch assigned groups for this mentor
    const [groups] = await dbPromise.query(
      `SELECT pg.id AS groupId, pg.group_name AS groupName, pg.level, pg.created_at AS createdAt,
              u.id AS supervisorId, u.name AS supervisorName, u.email AS supervisorEmail
       FROM project_groups pg
       LEFT JOIN users u ON u.id = pg.supervisor_id
       WHERE pg.mentor_id = ?
       ORDER BY pg.id DESC`,
      [mentorId]
    );

    const groupIds = groups.map((g) => g.groupId);

    let members = [];
    let groupProgressMap = {};
    let milestones = [];

    if (groupIds.length > 0) {
      // 3. Fetch students in these assigned groups
      const [memberRows] = await dbPromise.query(
        `SELECT pgm.group_id, u.id, u.name, u.email, u.university_id, pgm.is_leader
         FROM project_group_members pgm
         JOIN users u ON u.id = pgm.student_id
         WHERE pgm.group_id IN (?)
         ORDER BY pgm.is_leader DESC, u.name ASC`,
        [groupIds]
      );
      members = memberRows;

      // 4. Fetch marks / stage progress for these groups
      try {
        const [marksRows] = await dbPromise.query(
          `SELECT group_id, COUNT(DISTINCT stage_id) AS marked_count, MAX(created_at) AS last_activity
           FROM marks
           WHERE group_id IN (?) AND mark_type = 'stage'
           GROUP BY group_id`,
          [groupIds]
        );
        marksRows.forEach((row) => {
          groupProgressMap[row.group_id] = {
            markedCount: Number(row.marked_count) || 0,
            lastActivity: row.last_activity,
          };
        });
      } catch (err) {
        console.warn('Marks lookup warning for mentor dashboard:', err.message);
      }

      // 5. Fetch milestones for these groups if milestones table exists
      try {
        const [milestoneRows] = await dbPromise.query(
          `SELECT m.id, m.group_id, m.title, m.description, m.start_date, m.due_date, m.status, m.feedback_reason,
                  pg.group_name AS groupName
           FROM milestones m
           JOIN project_groups pg ON pg.id = m.group_id
           WHERE m.group_id IN (?)
           ORDER BY m.due_date ASC`,
          [groupIds]
        );
        milestones = milestoneRows;
      } catch (err) {
        console.warn('Milestones lookup warning for mentor dashboard:', err.message);
      }
    }

    // Calculate total stages in system for progress calculation
    let totalStages = 4;
    try {
      const [stageCountRows] = await dbPromise.query('SELECT COUNT(*) AS total FROM project_stages');
      if (stageCountRows && stageCountRows[0] && stageCountRows[0].total > 0) {
        totalStages = stageCountRows[0].total;
      }
    } catch (e) {}

    // Format assigned groups list
    const assignedGroups = groups.map((g) => {
      const groupMembers = members
        .filter((m) => m.group_id === g.groupId)
        .map((m) => ({
          id: m.id,
          name: m.name || 'Unknown Student',
          email: m.email,
          universityId: m.university_id,
          isLeader: Boolean(m.is_leader),
        }));

      const progressInfo = groupProgressMap[g.groupId] || { markedCount: 0, lastActivity: g.createdAt };
      const progressPercent = totalStages > 0 ? Math.min(100, Math.round((progressInfo.markedCount / totalStages) * 100)) : 0;

      let status = 'Pending Approval';
      if (progressPercent >= 100) status = 'Completed';
      else if (progressPercent > 0 || groupMembers.length > 0) status = 'In Progress';

      return {
        groupId: g.groupId,
        projectId: g.groupId,
        groupName: g.groupName,
        level: g.level,
        supervisorName: g.supervisorName || 'Unassigned',
        supervisorEmail: g.supervisorEmail || null,
        membersCount: groupMembers.length,
        members: groupMembers,
        progress: progressPercent,
        status,
        lastActivity: progressInfo.lastActivity || g.createdAt,
        updatedAt: progressInfo.lastActivity || g.createdAt,
      };
    });

    // 6. Upcoming Deadlines (Project Stages for levels != 1)
    let upcomingDeadlines = [];
    try {
      const [stageDeadlines] = await dbPromise.query(
        `SELECT stage_id AS id, stage_name AS title, deadline AS date, level AS academicLevel,
                'Project Stage' AS targetGroup
         FROM project_stages
         WHERE deadline IS NOT NULL AND deadline >= CURDATE() AND level != 1
         ORDER BY deadline ASC
         LIMIT 5`
      );
      upcomingDeadlines = stageDeadlines;
    } catch (err) {
      console.warn('Upcoming deadlines warning for mentor dashboard:', err.message);
    }

    // 7. Recent Announcements (excluding Level 1)
    let recentAnnouncements = [];
    try {
      const placeholders = LEVEL1_AUDIENCES.map(() => '?').join(', ');
      const [announcementRows] = await dbPromise.query(
        `SELECT id, title, message, target_audience, created_at
         FROM announcements
         WHERE (target_audience NOT IN (${placeholders}) OR target_audience IS NULL)
         ORDER BY created_at DESC
         LIMIT 4`,
        LEVEL1_AUDIENCES
      );
      recentAnnouncements = announcementRows;
    } catch (err) {
      console.warn('Announcements warning for mentor dashboard:', err.message);
    }

    // Calculate overall stats
    const totalStudents = members.length;
    const completedMilestones = milestones.filter((m) => m.status === 'APPROVED' || m.status === 'COMPLETED').length;
    const pendingMilestones = milestones.filter((m) => m.status === 'PENDING' || m.status === 'IN_PROGRESS').length;

    const stats = {
      totalProjects: groups.length,
      assignedProjects: groups.length,
      totalStudents,
      activeStudents: totalStudents,
      completedMilestones,
      pendingMilestones,
      upcomingDeadlinesCount: upcomingDeadlines.length,
    };

    res.json({
      success: true,
      data: {
        mentorInfo,
        stats,
        recentProjects: assignedGroups,
        assignedGroups,
        upcomingDeadlines,
        recentAnnouncements,
        milestones,
      },
    });
  } catch (error) {
    console.error('Error fetching mentor dashboard data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch mentor dashboard data.',
      details: error.message,
    });
  }
};

// ── 6. Get Mentor Assigned Groups Endpoint ──────────────────────────────────
// GET /api/mentor/groups/:mentorId or GET /api/mentor/groups?mentorId=...
exports.getMentorGroups = async (req, res) => {
  try {
    const mentorId = req.params.mentorId || req.query.mentorId || req.headers['x-user-id'];
    if (!mentorId) {
      return res.status(400).json({ success: false, error: 'Mentor ID is required.' });
    }

    const dbPromise = db.promise();
    const [groups] = await dbPromise.query(
      `SELECT pg.id AS groupId, pg.group_name AS groupName, pg.level, pg.created_at AS createdAt,
              u.id AS supervisorId, u.name AS supervisorName, u.email AS supervisorEmail
       FROM project_groups pg
       LEFT JOIN users u ON u.id = pg.supervisor_id
       WHERE pg.mentor_id = ?
       ORDER BY pg.id DESC`,
      [mentorId]
    );

    if (groups.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const groupIds = groups.map((g) => g.groupId);
    const [members] = await dbPromise.query(
      `SELECT pgm.group_id, u.id, u.name, u.email, u.university_id, pgm.is_leader
       FROM project_group_members pgm
       JOIN users u ON u.id = pgm.student_id
       WHERE pgm.group_id IN (?)
       ORDER BY pgm.is_leader DESC, u.name ASC`,
      [groupIds]
    );

    const formattedGroups = groups.map((g) => {
      const groupMembers = members
        .filter((m) => m.group_id === g.groupId)
        .map((m) => ({
          id: m.id,
          name: m.name || 'Unknown Student',
          email: m.email,
          universityId: m.university_id,
          isLeader: Boolean(m.is_leader),
        }));

      return {
        groupId: g.groupId,
        groupName: g.groupName,
        level: g.level,
        supervisor: {
          id: g.supervisorId,
          name: g.supervisorName || 'Unassigned',
          email: g.supervisorEmail,
        },
        members: groupMembers,
        createdAt: g.createdAt,
      };
    });

    res.json({ success: true, data: formattedGroups });
  } catch (error) {
    console.error('Error fetching mentor groups:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch mentor groups.' });
  }
};

// ── 7. Get Specific Group Details For Mentor ─────────────────────────────────
// GET /api/mentor/group/:groupId
exports.getMentorGroupDetails = async (req, res) => {
  try {
    const { groupId } = req.params;
    const dbPromise = db.promise();

    const [groups] = await dbPromise.query(
      `SELECT pg.id AS groupId, pg.group_name AS groupName, pg.level, pg.created_at AS createdAt,
              u.id AS supervisorId, u.name AS supervisorName, u.email AS supervisorEmail,
              m.id AS mentorId, m.name AS mentorName, m.email AS mentorEmail
       FROM project_groups pg
       LEFT JOIN users u ON u.id = pg.supervisor_id
       LEFT JOIN users m ON m.id = pg.mentor_id
       WHERE pg.id = ?`,
      [groupId]
    );

    if (groups.length === 0) {
      return res.status(404).json({ success: false, error: 'Group not found.' });
    }

    const group = groups[0];

    // Fetch members
    const [members] = await dbPromise.query(
      `SELECT pgm.group_id, u.id, u.name, u.email, u.university_id, u.phone, pgm.is_leader
       FROM project_group_members pgm
       JOIN users u ON u.id = pgm.student_id
       WHERE pgm.group_id = ?
       ORDER BY pgm.is_leader DESC, u.name ASC`,
      [groupId]
    );

    // Fetch milestones
    let milestones = [];
    try {
      const [milestoneRows] = await dbPromise.query(
        'SELECT * FROM milestones WHERE group_id = ? ORDER BY due_date ASC',
        [groupId]
      );
      milestones = milestoneRows;
    } catch (e) {}

    // Fetch project overview if available
    let overview = null;
    try {
      const [overviewRows] = await dbPromise.query(
        'SELECT * FROM project_overviews WHERE group_id = ?',
        [groupId]
      );
      if (overviewRows.length > 0) overview = overviewRows[0];
    } catch (e) {}

    res.json({
      success: true,
      data: {
        ...group,
        members: members.map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          universityId: m.university_id,
          phone: m.phone,
          isLeader: Boolean(m.is_leader),
        })),
        milestones,
        overview,
      },
    });
  } catch (error) {
    console.error('Error fetching mentor group details:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch group details.' });
  }
};

// ── 8. Mentor Dashboard Summary Stats Endpoint (Used by StatCards.tsx) ──────
// GET /api/mentor/stats
exports.getMentorStats = async (req, res) => {
  try {
    const dbPromise = db.promise();
    const mentorId = req.params.mentorId || req.query.mentorId || req.headers['x-user-id'];

    if (!mentorId) {
      return res.json({
        totalGroups: 0,
        ongoingCount: 0,
        delayedCount: 0,
        completedCount: 0,
        completionRate: 0,
      });
    }

    const [groups] = await dbPromise.query('SELECT id, group_name, level FROM project_groups WHERE mentor_id = ?', [mentorId]);
    const totalGroups = groups.length;

    if (totalGroups === 0) {
      return res.json({
        totalGroups: 0,
        ongoingCount: 0,
        delayedCount: 0,
        completedCount: 0,
        completionRate: 0,
      });
    }

    const groupIds = groups.map((g) => g.id);

    // Calculate stages count
    let totalStages = 4;
    try {
      const [stageRows] = await dbPromise.query('SELECT COUNT(*) as count FROM project_stages');
      if (stageRows && stageRows[0] && stageRows[0].count > 0) {
        totalStages = stageRows[0].count;
      }
    } catch (e) {}

    // Check marks to find completed groups
    let completedCount = 0;
    try {
      const [markRows] = await dbPromise.query(
        `SELECT group_id, COUNT(DISTINCT stage_id) as marked_stages 
         FROM marks 
         WHERE group_id IN (?) AND mark_type = 'stage'
         GROUP BY group_id`,
        [groupIds]
      );
      completedCount = markRows.filter((r) => r.marked_stages >= totalStages).length;
    } catch (e) {}

    // Check overdue tasks or milestones to find delayed groups
    let delayedCount = 0;
    try {
      const [delayedRows] = await dbPromise.query(
        `SELECT DISTINCT m.group_id 
         FROM milestones m 
         WHERE m.group_id IN (?) AND m.due_date < CURDATE() AND m.status != 'APPROVED'`,
        [groupIds]
      );
      delayedCount = delayedRows.length;
    } catch (e) {}

    const ongoingCount = Math.max(0, totalGroups - completedCount);
    const completionRate = totalGroups > 0 ? Math.round((completedCount / totalGroups) * 100) : 0;

    res.json({
      totalGroups,
      ongoingCount,
      delayedCount,
      completedCount,
      completionRate,
    });
  } catch (error) {
    console.error('Error fetching mentor stats:', error);
    res.status(500).json({
      totalGroups: 0,
      ongoingCount: 0,
      delayedCount: 0,
      completedCount: 0,
      completionRate: 0,
      error: error.message,
    });
  }
};

// ── 9. Mentor Projects Endpoint (Used by RecentProjects.tsx) ────────────────
// GET /api/mentor/projects
exports.getMentorProjects = async (req, res) => {
  try {
    const dbPromise = db.promise();
    const mentorId = req.params.mentorId || req.query.mentorId || req.headers['x-user-id'];

    if (!mentorId) {
      return res.json([]);
    }

    const [groups] = await dbPromise.query(
      `SELECT pg.id, pg.group_name, pg.level, pg.created_at,
              COALESCE(u.name, 'Unassigned') as supervisor_name
       FROM project_groups pg
       LEFT JOIN users u ON u.id = pg.supervisor_id
       WHERE pg.mentor_id = ?
       ORDER BY pg.id DESC`,
      [mentorId]
    );

    if (groups.length === 0) {
      return res.json([]);
    }

    const groupIds = groups.map((g) => g.id);

    // Fetch members count per group
    const [memberRows] = await dbPromise.query(
      `SELECT group_id, COUNT(student_id) as member_count 
       FROM project_group_members 
       WHERE group_id IN (?) 
       GROUP BY group_id`,
      [groupIds]
    );
    const memberCountMap = {};
    memberRows.forEach((r) => { memberCountMap[r.group_id] = r.member_count; });

    // Fetch marks per group
    let totalStages = 4;
    try {
      const [stageRows] = await dbPromise.query('SELECT COUNT(*) as count FROM project_stages');
      if (stageRows && stageRows[0] && stageRows[0].count > 0) totalStages = stageRows[0].count;
    } catch (e) {}

    const [marksRows] = await dbPromise.query(
      `SELECT group_id, COUNT(DISTINCT stage_id) as marked_stages 
       FROM marks 
       WHERE group_id IN (?) AND mark_type = 'stage'
       GROUP BY group_id`,
      [groupIds]
    );
    const markedMap = {};
    marksRows.forEach((r) => { markedMap[r.group_id] = r.marked_stages; });

    // Fetch tasks/milestones per group
    let taskStatsMap = {};
    let isDelayedMap = {};
    try {
      const [taskRows] = await dbPromise.query(
        `SELECT m.group_id,
                COUNT(st.id) as total_tasks,
                SUM(CASE WHEN st.status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_tasks,
                SUM(CASE WHEN st.due_date < CURDATE() AND st.status != 'COMPLETED' THEN 1 ELSE 0 END) as overdue_tasks
         FROM student_tasks st
         JOIN milestones m ON m.id = st.milestone_id
         WHERE m.group_id IN (?)
         GROUP BY m.group_id`,
        [groupIds]
      );
      taskRows.forEach((r) => {
        taskStatsMap[r.group_id] = `${r.completed_tasks || 0}/${r.total_tasks || 0} tasks completed`;
        if (r.overdue_tasks > 0) isDelayedMap[r.group_id] = true;
      });
    } catch (e) {}

    const formattedProjects = groups.map((g) => {
      const marked = markedMap[g.id] || 0;
      const progress = totalStages > 0 ? Math.min(100, Math.round((marked / totalStages) * 100)) : 0;
      const members = memberCountMap[g.id] || 0;
      const isDelayed = isDelayedMap[g.id] || false;
      const taskStats = taskStatsMap[g.id] || (marked > 0 ? `${marked}/${totalStages} stages marked` : '0/4 tasks completed');

      return {
        id: String(g.id),
        name: `${g.group_name} Project`,
        group: g.group_name,
        members: members || 5,
        status: isDelayed ? 'Delayed' : 'On Track',
        progress: progress,
        taskStats: taskStats,
      };
    });

    res.json(formattedProjects);
  } catch (error) {
    console.error('Error fetching mentor projects:', error);
    res.status(500).json([]);
  }
};

// ── 10. Students Needing Attention (Used by StudentAttention.tsx) ───────────
// GET /api/mentor/students-attention
exports.getMentorStudentsAttention = async (req, res) => {
  try {
    const dbPromise = db.promise();
    const mentorId = req.params.mentorId || req.query.mentorId || req.headers['x-user-id'];

    if (!mentorId) {
      return res.json([]);
    }

    const [students] = await dbPromise.query(
      `SELECT u.id as student_id, u.name as student_name, pg.id as group_id, pg.group_name
       FROM project_group_members pgm
       JOIN users u ON u.id = pgm.student_id
       JOIN project_groups pg ON pg.id = pgm.group_id
       WHERE pg.mentor_id = ?
       ORDER BY pg.id DESC, pgm.is_leader DESC`,
      [mentorId]
    );

    if (students.length === 0) {
      return res.json([]);
    }

    const studentIds = students.map((s) => s.student_id);

    let taskMap = {};
    try {
      const [taskRows] = await dbPromise.query(
        `SELECT assigned_to,
                COUNT(id) as total_tasks,
                SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_tasks,
                SUM(CASE WHEN due_date < CURDATE() AND status != 'COMPLETED' THEN 1 ELSE 0 END) as delayed_count
         FROM student_tasks
         WHERE assigned_to IN (?)
         GROUP BY assigned_to`,
        [studentIds]
      );
      taskRows.forEach((r) => {
        taskMap[r.assigned_to] = {
          totalTasks: Number(r.total_tasks) || 0,
          completedTasks: Number(r.completed_tasks) || 0,
          delayedCount: Number(r.delayed_count) || 0,
        };
      });
    } catch (e) {}

    const result = students.map((s) => {
      const taskInfo = taskMap[s.student_id] || { totalTasks: 0, completedTasks: 0, delayedCount: 0 };
      const lowProgressCount = (taskInfo.totalTasks > 0 && taskInfo.completedTasks === 0) ? 1 : 0;

      return {
        name: s.student_name || 'Student',
        group: s.group_name,
        project: `${s.group_name} Project`,
        delayedCount: taskInfo.delayedCount,
        lowProgressCount,
        completedTasks: taskInfo.completedTasks,
        totalTasks: taskInfo.totalTasks,
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching students attention:', error);
    res.status(500).json([]);
  }
};

// ── 11. Mentor Notifications Endpoint (Used by RecentNotification.tsx) ──────
// GET /api/mentor/notifications
exports.getMentorNotifications = async (req, res) => {
  try {
    const dbPromise = db.promise();
    const notifications = [];

    const formatTimeAgo = (dateStr) => {
      if (!dateStr) return 'Recently';
      const now = new Date();
      const past = new Date(dateStr);
      const diffMs = now - past;
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHours / 24);

      if (diffHours < 1) return 'Just now';
      if (diffHours === 1) return '1 hour ago';
      if (diffHours < 24) return `${diffHours} hours ago`;
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      return past.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };

    // 1. Fetch recent announcements (excluding Level 1)
    try {
      const placeholders = LEVEL1_AUDIENCES.map(() => '?').join(', ');
      const [announcementRows] = await dbPromise.query(
        `SELECT id, title, message, created_at 
         FROM announcements 
         WHERE (target_audience NOT IN (${placeholders}) OR target_audience IS NULL)
         ORDER BY created_at DESC 
         LIMIT 4`,
        LEVEL1_AUDIENCES
      );
      announcementRows.forEach((a) => {
        notifications.push({
          id: `ann-${a.id}`,
          text: `Announcement: ${a.title}`,
          date: formatTimeAgo(a.created_at),
          type: 'alert',
          createdAt: a.created_at,
        });
      });
    } catch (e) {}

    // 2. Fetch upcoming stage deadlines
    try {
      const [stageRows] = await dbPromise.query(
        `SELECT stage_id, stage_name, deadline, level 
         FROM project_stages 
         WHERE deadline IS NOT NULL AND deadline >= CURDATE() AND level != 1
         ORDER BY deadline ASC 
         LIMIT 3`
      );
      stageRows.forEach((s) => {
        const d = new Date(s.deadline);
        notifications.push({
          id: `dl-${s.stage_id}`,
          text: `Deadline upcoming for Level ${s.level}: ${s.stage_name}`,
          date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          type: 'deadline',
          createdAt: s.deadline,
        });
      });
    } catch (e) {}

    // 3. Fetch recent stage file uploads
    try {
      const [fileRows] = await dbPromise.query(
        `SELECT sf.id, sf.file_name, sf.uploaded_at, ps.stage_name 
         FROM stage_files sf
         JOIN project_stages ps ON ps.stage_id = sf.stage_id
         ORDER BY sf.uploaded_at DESC 
         LIMIT 3`
      );
      fileRows.forEach((f) => {
        notifications.push({
          id: `file-${f.id}`,
          text: `New stage guideline uploaded: ${f.file_name}`,
          date: formatTimeAgo(f.uploaded_at),
          type: 'file',
          createdAt: f.uploaded_at,
        });
      });
    } catch (e) {}

    // Sort by createdAt descending and take top 6
    notifications.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    res.json(notifications.slice(0, 6));
  } catch (error) {
    console.error('Error fetching mentor notifications:', error);
    res.status(500).json([]);
  }
};