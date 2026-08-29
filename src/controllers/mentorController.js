const db = require('../config/db');
const Project = require('../models/projectModel');

// Helper to retry transient DB connection timeouts (e.g. TiDB Cloud cold starts or network latency)
const queryWithRetry = async (sql, params = [], retries = 2) => {
  const dbPromise = db.promise();
  for (let i = 0; i <= retries; i++) {
    try {
      return await dbPromise.query(sql, params);
    } catch (err) {
      const isTransient = err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'PROTOCOL_CONNECTION_LOST';
      if (isTransient && i < retries) {
        console.warn(`[mentorController] DB query transient error (${err.code}). Retrying attempt ${i + 2}/${retries + 1}...`);
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      throw err;
    }
  }
};

// ── Constant ─────────────────────────────────────────────────────────────────
const LEVEL1_AUDIENCES = ['Level1', 'Level 1', 'Level1 Students', 'Level 1 Students'];

// ── 1. Get Stages (Strict Real Coordinator Filtering for Mentor Role) ─────────
// Mentors only see official stage documents and guidelines published by the designated
// coordinator for their assigned group and level (e.g. ITM -> Level 2 IDS Coordinator Hiruni Karunarathna).
// Excludes test stages created by non-coordinators or supervisors.
exports.getMentorStages = async (req, res) => {
  const level = Number(req.params.level);
  const mentorId = req.query.mentorId || req.params.mentorId || req.headers['x-user-id'];
  const groupId = req.query.groupId || req.params.groupId;

  if (level === 1) {
    return res.status(403).json({
      success: false,
      message: 'Industry mentors are not assigned to Level 1 stages.',
    });
  }

  try {
    // 1. Find assigned group for this mentor at this level
    let assignedGroup = null;
    if (groupId) {
      const [groups] = await queryWithRetry('SELECT * FROM project_groups WHERE id = ?', [groupId]);
      if (groups.length > 0) assignedGroup = groups[0];
    } else if (mentorId) {
      const [groups] = await queryWithRetry(
        'SELECT * FROM project_groups WHERE mentor_id = ? AND level = ? ORDER BY id DESC',
        [mentorId, level]
      );
      if (groups.length > 0) assignedGroup = groups[0];
    }

    let coordinatorId = assignedGroup ? assignedGroup.created_by : null;
    let groupDept = (assignedGroup ? (assignedGroup.department || '') : '').toUpperCase().trim();

    // 2. Map department to designated coordinator academic units
    let allowedUnits = ['IDS', 'ITM']; // default for ITM
    if (groupDept === 'AI') {
      allowedUnits = ['CM', 'AI'];
    } else if (groupDept === 'IT') {
      allowedUnits = ['IT'];
    } else if (groupDept === 'ITM') {
      allowedUnits = ['IDS', 'ITM'];
    }

    // 3. Query ONLY official coordinator stages for this group and level
    let stageQuery = `
      SELECT ps.*, u.name AS coordinator_name, u.academic_unit AS coordinator_academic_unit
      FROM project_stages ps
      JOIN users u ON ps.created_by = u.id
      WHERE ps.level = ?
        AND u.role IN ('lecturer', 'coordinator', 'admin')
    `;
    let queryParams = [level];

    // If group has an assigned coordinator (created_by), strictly query that coordinator's stages
    if (coordinatorId) {
      stageQuery += ` AND ps.created_by = ?`;
      queryParams.push(coordinatorId);
    } else if (groupDept) {
      // Fallback: match official level coordinator for the group's academic department
      stageQuery += ` AND u.academic_unit IN (?) AND (u.level = ? OR u.level IS NULL)`;
      queryParams.push(allowedUnits, level);
    }

    stageQuery += ` ORDER BY ps.stage_id ASC`;

    const [stages] = await queryWithRetry(stageQuery, queryParams);

    if (stages.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // 4. Attach stage files
    const stageIds = stages.map((s) => s.stage_id);
    const [files] = await queryWithRetry(
      'SELECT * FROM stage_files WHERE stage_id IN (?) ORDER BY uploaded_at DESC',
      [stageIds]
    );

    const stagesWithFiles = stages.map((stage) => ({
      ...stage,
      files: files.filter((f) => String(f.stage_id) === String(stage.stage_id)),
    }));

    return res.json({ success: true, data: stagesWithFiles });
  } catch (err) {
    console.error('getMentorStages error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── 2. JS helper — filter Level 1 announcements out of a list ────────────────
exports.filterLevel1FromMentorAnnouncements = (announcements) => {
  return announcements.filter(
    (a) => !LEVEL1_AUDIENCES.includes((a.target_audience || '').trim())
  );
};

// ── 3. Standalone mentor announcements endpoint ──────────────────────────────
exports.getMentorAnnouncements = async (req, res) => {
  const mentorId = req.query.mentorId || req.params.mentorId || req.headers['x-user-id'] || req.user?.id;

  try {
    let assignedLevels = [];
    let assignedDepartments = [];
    let assignedGroups = [];

    if (mentorId) {
      const [groups] = await queryWithRetry(
        `SELECT id, group_name, level, department FROM project_groups WHERE mentor_id = ?`,
        [mentorId]
      );
      assignedGroups = groups || [];
      assignedLevels = Array.from(new Set(assignedGroups.map((g) => Number(g.level)).filter((lvl) => lvl > 1)));
      assignedDepartments = Array.from(new Set(assignedGroups.map((g) => g.department).filter(Boolean)));
    }

    // Build smart where conditions for Mentor:
    // 1. Never show Level 1
    // 2. Always show general/system announcements ('All', 'All system users')
    // 3. Always show announcements targeted to 'mentor' / 'mentors'
    // 4. Show announcements for assigned levels (e.g. Level 2)
    // 5. Show announcements for assigned groups (e.g. Cygen 123)
    // 6. Show announcements authored by this mentor

    let whereClauses = [];
    let params = [];

    // Exclude Level 1 strictly
    whereClauses.push(
      `(LOWER(a.target_audience) NOT LIKE '%level1%' AND LOWER(a.target_audience) NOT LIKE '%level 1%' OR a.target_audience IS NULL)`
    );

    let relevanceConditions = [
      `LOWER(a.target_audience) IN ('all', 'all system users')`,
      `LOWER(a.target_audience) LIKE '%mentor%'`,
    ];

    if (mentorId) {
      relevanceConditions.push(`a.author_id = ?`);
      params.push(Number(mentorId));
    }

    assignedLevels.forEach((lvl) => {
      relevanceConditions.push(`LOWER(a.target_audience) LIKE ?`);
      params.push(`%level${lvl}%`);
      relevanceConditions.push(`LOWER(a.target_audience) LIKE ?`);
      params.push(`%level ${lvl}%`);
    });

    assignedGroups.forEach((g) => {
      if (g.group_name && g.group_name.trim()) {
        relevanceConditions.push(`LOWER(a.target_audience) LIKE ?`);
        params.push(`%${g.group_name.toLowerCase().trim()}%`);
      }
    });

    whereClauses.push(`(${relevanceConditions.join(' OR ')})`);

    const query = `
      SELECT a.*, COALESCE(u.name, a.author_name) AS author_name, u.role AS author_role
      FROM announcements a
      LEFT JOIN users u ON a.author_id = u.id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY a.created_at DESC
    `;

    const [results] = await queryWithRetry(query, params);

    res.json({
      success: true,
      data: results || [],
      announcements: results || [],
      meta: {
        mentorId: mentorId || null,
        assignedLevels,
        assignedDepartments,
        assignedGroups: assignedGroups.map((g) => ({ id: g.id, groupName: g.group_name, level: g.level })),
        count: (results || []).length,
      },
    });
  } catch (err) {
    console.error('[getMentorAnnouncements] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getMentorAnnouncementById = async (req, res) => {
  const { id } = req.params;
  const query = `
    SELECT a.*, COALESCE(u.name, a.author_name) AS author_name, u.role AS author_role
    FROM announcements a
    LEFT JOIN users u ON a.author_id = u.id
    WHERE a.id = ?
  `;

  try {
    const [results] = await queryWithRetry(query, [id]);
    if (results.length === 0) {
      return res.status(404).json({ success: false, message: 'Announcement not found.' });
    }
    const announcement = results[0];
    if (LEVEL1_AUDIENCES.includes((announcement.target_audience || '').trim())) {
      return res.status(403).json({
        success: false,
        message: 'Industry mentors cannot access Level 1 announcements.',
      });
    }
    res.json({ success: true, data: announcement });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.createMentorAnnouncement = async (req, res) => {
  const mentorId = req.body.mentorId || req.body.author_id || req.headers['x-user-id'] || req.user?.id;
  const { title, message, target_audience, groupId } = req.body;

  if (!title || !title.trim() || !message || !message.trim()) {
    return res.status(400).json({ success: false, error: 'Title and message are required.' });
  }

  try {
    let mentorName = req.body.author_name || 'Industry Mentor';
    let assignedGroups = [];

    if (mentorId) {
      const [users] = await queryWithRetry('SELECT name FROM users WHERE id = ?', [mentorId]);
      if (users.length > 0 && users[0].name) {
        mentorName = users[0].name;
      }
      const [groups] = await queryWithRetry(
        'SELECT id, group_name, level FROM project_groups WHERE mentor_id = ?',
        [mentorId]
      );
      assignedGroups = groups || [];
    }

    let finalAudience = target_audience;
    if (groupId) {
      const matched = assignedGroups.find((g) => Number(g.id) === Number(groupId));
      if (matched) {
        finalAudience = `Level ${matched.level} Assigned Students (${matched.group_name})`;
      }
    }

    if (!finalAudience) {
      if (assignedGroups.length > 0) {
        const lvl = assignedGroups[0].level;
        finalAudience = `Level ${lvl} Assigned Students`;
      } else {
        finalAudience = 'Assigned Students';
      }
    }

    const insertSql = `
      INSERT INTO announcements (title, message, target_audience, author_name, author_id)
      VALUES (?, ?, ?, ?, ?)
    `;

    const [result] = await queryWithRetry(insertSql, [
      title.trim(),
      message.trim(),
      finalAudience.trim(),
      mentorName,
      mentorId ? Number(mentorId) : null,
    ]);

    res.status(201).json({
      success: true,
      message: 'Announcement posted successfully for your assigned students!',
      announcement: {
        id: result.insertId,
        title: title.trim(),
        message: message.trim(),
        target_audience: finalAudience.trim(),
        author_name: mentorName,
        author_id: mentorId ? Number(mentorId) : null,
        created_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[createMentorAnnouncement] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateMentorAnnouncement = async (req, res) => {
  const { id } = req.params;
  const mentorId = req.body.mentorId || req.headers['x-user-id'] || req.user?.id;
  const { title, message } = req.body;

  if (!title || !message) {
    return res.status(400).json({ success: false, error: 'Title and message are required.' });
  }

  try {
    let sql = `UPDATE announcements SET title = ?, message = ? WHERE id = ?`;
    let params = [title.trim(), message.trim(), id];

    if (mentorId) {
      sql += ` AND author_id = ?`;
      params.push(Number(mentorId));
    }

    const [result] = await queryWithRetry(sql, params);
    if (result.affectedRows === 0) {
      return res.status(403).json({ success: false, error: 'Cannot update announcement or unauthorized.' });
    }

    res.json({ success: true, message: 'Announcement updated successfully.' });
  } catch (err) {
    console.error('[updateMentorAnnouncement] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.deleteMentorAnnouncement = async (req, res) => {
  const { id } = req.params;
  const mentorId = req.query.mentorId || req.headers['x-user-id'] || req.user?.id;

  try {
    let sql = `DELETE FROM announcements WHERE id = ?`;
    let params = [id];

    if (mentorId) {
      sql += ` AND author_id = ?`;
      params.push(Number(mentorId));
    }

    const [result] = await queryWithRetry(sql, params);
    if (result.affectedRows === 0) {
      return res.status(403).json({ success: false, error: 'Cannot delete announcement or unauthorized.' });
    }

    res.json({ success: true, message: 'Announcement deleted successfully.' });
  } catch (err) {
    console.error('[deleteMentorAnnouncement] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── 4. Mentor Groups ─────────────────────────────────────────────────────────
exports.getMentorGroups = async (req, res) => {
  const mentorId = req.params.mentorId || req.query.mentorId || req.headers['x-user-id'];
  const level = req.params.level || req.query.level;

  if (!mentorId) {
    return res.status(400).json({ success: false, message: 'Mentor ID is required.' });
  }

  const numLevel = Number(level);
  // Industry mentors are strictly not assigned to Level 1 stages or groups
  if (numLevel === 1) {
    return res.json({ success: true, data: [] });
  }

  try {
    let query = `SELECT pg.id AS groupId, pg.group_name AS groupName, pg.department AS department, pg.level, pg.created_at AS createdAt,
              sup.id AS supervisorId, sup.name AS supervisorName, sup.email AS supervisorEmail
       FROM project_groups pg
       LEFT JOIN users sup ON sup.id = pg.supervisor_id
       WHERE pg.mentor_id = ? AND pg.level > 1`;
    const queryParams = [mentorId];

    if (level && !isNaN(numLevel) && numLevel > 1) {
      query += ' AND pg.level = ?';
      queryParams.push(numLevel);
    }

    query += ' ORDER BY pg.level ASC, pg.id ASC';

    const [groups] = await queryWithRetry(query, queryParams);

    if (groups.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const groupIds = groups.map((g) => g.groupId);
    const [members] = await queryWithRetry(
      `SELECT pgm.group_id AS groupId, u.id, u.name, u.email, u.university_id AS universityId, pgm.is_leader AS isLeader
       FROM project_group_members pgm
       JOIN users u ON u.id = pgm.student_id
       WHERE pgm.group_id IN (?)`,
      [groupIds]
    );

    const formattedGroups = groups.map((g) => ({
      groupId: g.groupId,
      groupName: g.groupName,
      project_name: g.groupName,
      department: g.department || 'ITM',
      level: g.level,
      supervisor: {
        id: g.supervisorId,
        name: g.supervisorName,
        email: g.supervisorEmail,
      },
      members: members
        .filter((m) => m.groupId === g.groupId)
        .map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          universityId: m.universityId,
          isLeader: Boolean(m.isLeader),
        })),
      createdAt: g.createdAt,
    }));

    res.json({ success: true, data: formattedGroups });
  } catch (err) {
    console.error('getMentorGroups error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getMentorGroupDetails = async (req, res) => {
  const { groupId } = req.params;
  try {
    const [groups] = await queryWithRetry(
      `SELECT pg.id AS groupId, pg.group_name AS groupName, pg.department AS department, pg.level, pg.created_at AS createdAt,
              sup.id AS supervisorId, sup.name AS supervisorName, sup.email AS supervisorEmail
       FROM project_groups pg
       LEFT JOIN users sup ON sup.id = pg.supervisor_id
       WHERE pg.id = ?`,
      [groupId]
    );

    if (groups.length === 0) {
      return res.status(404).json({ success: false, message: 'Group not found.' });
    }

    const g = groups[0];
    const [members] = await queryWithRetry(
      `SELECT pgm.group_id AS groupId, u.id, u.name, u.email, u.university_id AS universityId, pgm.is_leader AS isLeader
       FROM project_group_members pgm
       JOIN users u ON u.id = pgm.student_id
       WHERE pgm.group_id = ?`,
      [groupId]
    );

    res.json({
      success: true,
      data: {
        groupId: g.groupId,
        groupName: g.groupName,
        project_name: g.groupName,
        department: g.department || 'ITM',
        level: g.level,
        supervisor: {
          id: g.supervisorId,
          name: g.supervisorName,
          email: g.supervisorEmail,
        },
        members: members.map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          universityId: m.universityId,
          isLeader: Boolean(m.isLeader),
        })),
        createdAt: g.createdAt,
      },
    });
  } catch (err) {
    console.error('getMentorGroupDetails error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ── 5. Mentor Dashboard / Stats / Projects ───────────────────────────────────
exports.getMentorDashboard = (req, res) => {
  const mentorId = req.params.mentorId || req.query.mentorId || req.headers['x-user-id'];
  res.json({ success: true, message: 'Mentor dashboard loaded', mentorId });
};

exports.getMentorStats = async (req, res) => {
  const mentorId = req.params.mentorId || req.query.mentorId || req.headers['x-user-id'];
  try {
    const [groups] = await queryWithRetry('SELECT COUNT(*) as count FROM project_groups WHERE mentor_id = ? AND level > 1', [mentorId]);
    res.json({ success: true, data: { assignedGroupsCount: groups[0]?.count || 0 } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getMentorProjects = async (req, res) => {
  const mentorId = req.params.mentorId || req.query.mentorId || req.headers['x-user-id'];
  try {
    const [groups] = await queryWithRetry(
      'SELECT id, group_name as name, department, level, created_at FROM project_groups WHERE mentor_id = ? AND level > 1',
      [mentorId]
    );
    res.json({ success: true, data: groups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getMentorStudentsAttention = async (req, res) => {
  res.json({ success: true, data: [] });
};

exports.getMentorNotifications = async (req, res) => {
  res.json({ success: true, data: [] });
};

// ── 6. Mentor Group Tasks & Feedback ─────────────────────────────────────────
exports.getMentorGroupTasks = async (req, res) => {
  const { groupId } = req.params;
  try {
    const [tasks] = await queryWithRetry(
      `SELECT st.*, u.name AS assigned_to_name, u.email AS assigned_to_email,
              u.university_id, m.title AS milestone_title, m.group_id
       FROM student_tasks st
       JOIN milestones m ON m.id = st.milestone_id
       LEFT JOIN users u ON u.id = st.assigned_to
       WHERE m.group_id = ?
       ORDER BY st.due_date ASC, st.id ASC`,
      [groupId]
    );
    res.json({ success: true, data: tasks });
  } catch (err) {
    console.error('getMentorGroupTasks error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.saveMentorTaskFeedback = async (req, res) => {
  const { taskId } = req.params;
  const { feedback, mentor_feedback } = req.body;
  const fbText = (mentor_feedback || feedback || '').trim();
  const mentorId = req.user?.id || req.headers['x-user-id'] || null;

  try {
    // 1. Save mentor feedback into student_tasks database table
    await queryWithRetry(
      'UPDATE student_tasks SET mentor_feedback = ? WHERE id = ?',
      [fbText, taskId]
    );

    // 2. Automatically sync feedback as a 1-on-1 Direct Message to the assigned student
    if (fbText) {
      try {
        const [taskRows] = await queryWithRetry(
          `SELECT st.id, st.task_name, st.assigned_to, m.id AS milestone_id, m.title AS milestone_title,
                  m.group_id, u.name AS student_name, pg.mentor_id, pg.group_name
           FROM student_tasks st
           JOIN milestones m ON m.id = st.milestone_id
           JOIN project_groups pg ON pg.id = m.group_id
           LEFT JOIN users u ON u.id = st.assigned_to
           WHERE st.id = ?`,
          [taskId]
        );

        if (taskRows && taskRows.length > 0) {
          const task = taskRows[0];
          const senderId = mentorId || task.mentor_id;

          if (senderId) {
            const MessageV2Model = require('../models/MessageV2Model');

            // Format message containing only Task, Milestone, and Feedback
            const messageLines = [
              `📝 [Mentor Task Feedback]`,
              `📌 Task: ${task.task_name || 'Untitled Task'}`,
            ];

            if (task.milestone_title) {
              messageLines.push(`🎯 Milestone: ${task.milestone_title}`);
            }

            messageLines.push(`💬 Feedback: ${fbText}`);

            const messageText = messageLines.join('\n');

            // Remove any previous feedback message for this task to avoid duplicates
            try {
              const taskPattern = `%Task: ${task.task_name}%`;
              const taskQuotedPattern = `%Task: "${task.task_name}"%`;
              if (task.assigned_to) {
                await queryWithRetry(
                  `DELETE FROM messages_v2 
                   WHERE sender_id = ? AND receiver_id = ? 
                     AND (message_text LIKE ? OR message_text LIKE ?)`,
                  [senderId, task.assigned_to, taskPattern, taskQuotedPattern]
                );
              }
            } catch (delOldErr) {
              console.warn('Old feedback message cleanup warning:', delOldErr.message);
            }

            if (task.assigned_to) {
              // Direct 1-on-1 message to the assigned student only
              await MessageV2Model.saveMessage({
                sender_id: Number(senderId),
                receiver_id: Number(task.assigned_to),
                message_text: messageText,
              });
            } else if (task.group_id) {
              // Fallback to group chat only if task is unassigned
              const GroupConversationV2Model = require('../models/GroupConversationV2Model');
              const convId = await GroupConversationV2Model.ensureGroupConversation(task.group_id, 'mentor');
              if (convId) {
                await GroupConversationV2Model.saveMessage(
                  convId,
                  Number(senderId),
                  messageText
                );
              }
            }
          }
        }
      } catch (chatSyncErr) {
        console.warn('⚠️ [Mentor Feedback -> Student Direct Message Sync Warning]:', chatSyncErr.message);
      }
    }

    res.json({ success: true, message: 'Feedback saved successfully.' });
  } catch (err) {
    console.error('saveMentorTaskFeedback error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.clearMentorTaskFeedback = async (req, res) => {
  const { taskId } = req.params;
  const mentorId = req.user?.id || req.headers['x-user-id'] || null;

  try {
    // 1. Fetch task details to identify assigned student and task name
    const [taskRows] = await queryWithRetry(
      `SELECT st.id, st.task_name, st.assigned_to, m.group_id, pg.mentor_id
       FROM student_tasks st
       JOIN milestones m ON m.id = st.milestone_id
       JOIN project_groups pg ON pg.id = m.group_id
       WHERE st.id = ?`,
      [taskId]
    );

    // 2. Clear mentor_feedback in student_tasks table
    await queryWithRetry(
      'UPDATE student_tasks SET mentor_feedback = NULL WHERE id = ?',
      [taskId]
    );

    // 3. Automatically delete the feedback message from Communication (V2) chat
    if (taskRows && taskRows.length > 0) {
      const task = taskRows[0];
      const senderId = mentorId || task.mentor_id;

      try {
        const taskPattern = `%Task: ${task.task_name}%`;
        const taskQuotedPattern = `%Task: "${task.task_name}"%`;

        if (senderId && task.assigned_to) {
          // Delete from 1-on-1 direct messages with the student
          await queryWithRetry(
            `DELETE FROM messages_v2 
             WHERE sender_id = ? AND receiver_id = ? 
               AND (message_text LIKE ? OR message_text LIKE ?)`,
            [senderId, task.assigned_to, taskPattern, taskQuotedPattern]
          );
        }

        // Clean up from group conversation if any was posted there
        if (senderId && task.group_id) {
          await queryWithRetry(
            `DELETE FROM messages_v2 
             WHERE sender_id = ? 
               AND (message_text LIKE ? OR message_text LIKE ?)`,
            [senderId, taskPattern, taskQuotedPattern]
          );
        }
      } catch (chatDelErr) {
        console.warn('⚠️ [Mentor Feedback -> Message Delete Sync Warning]:', chatDelErr.message);
      }
    }

    res.json({ success: true, message: 'Feedback cleared successfully.' });
  } catch (err) {
    console.error('clearMentorTaskFeedback error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};


// ── 7. Mentor Student Submissions ──────────────────────────────────────────
// Mentors view deliverables and documents submitted by their assigned group members.
exports.getMentorSubmissions = async (req, res) => {
  const level = Number(req.params.level);
  const mentorId = req.query.mentorId || req.params.mentorId || req.headers['x-user-id'];
  const groupId = req.query.groupId || req.params.groupId;

  if (level === 1) {
    return res.status(403).json({
      success: false,
      message: 'Industry mentors are not assigned to Level 1 student submissions.',
    });
  }

  try {
    // 1. Find assigned group for this mentor at this level
    let assignedGroup = null;
    if (groupId) {
      const [groups] = await queryWithRetry('SELECT * FROM project_groups WHERE id = ?', [groupId]);
      if (groups.length > 0) assignedGroup = groups[0];
    } else if (mentorId) {
      const [groups] = await queryWithRetry(
        'SELECT * FROM project_groups WHERE mentor_id = ? AND level = ? ORDER BY id DESC',
        [mentorId, level]
      );
      if (groups.length > 0) assignedGroup = groups[0];
    }

    if (!assignedGroup) {
      return res.json({ success: true, data: [] });
    }

    // 2. Query student submissions for this group
    const [submissions] = await queryWithRetry(
      `SELECT ss.submission_id, ss.stage_id, ss.student_id, ss.file_paths, ss.submitted_at, ss.status,
              ps.stage_name, ps.deadline, ps.level,
              u.name AS student_name, u.email AS student_email, u.university_id,
              pgm.is_leader,
              pg.id AS group_id, pg.group_name
       FROM student_submissions ss
       JOIN project_stages ps ON ps.stage_id = ss.stage_id
       JOIN users u ON u.id = ss.student_id
       JOIN project_group_members pgm ON pgm.student_id = ss.student_id
       JOIN project_groups pg ON pg.id = pgm.group_id
       WHERE pg.id = ? AND ps.level = ?
       ORDER BY ss.submitted_at DESC`,
      [assignedGroup.id, level]
    );

    const normalized = submissions.map((row) => {
      let files = [];
      if (typeof row.file_paths === 'string') {
        try {
          files = JSON.parse(row.file_paths);
        } catch (e) {
          files = row.file_paths ? [row.file_paths] : [];
        }
      } else if (Array.isArray(row.file_paths)) {
        files = row.file_paths;
      }

      const fileObjects = files.map((f, idx) => {
        const url = typeof f === 'string' ? f : f.url || f.file_url || '';
        let fileName = typeof f === 'string' ? f.split('/').pop() || `Attachment_${idx + 1}` : f.name || f.file_name || `Attachment_${idx + 1}`;
        // Clean up timestamp prefix from filename if present
        fileName = fileName.replace(/^\d+[-_]/, '');
        return {
          file_id: idx + 1,
          file_name: fileName,
          file_url: url,
        };
      });

      return {
        submission_id: row.submission_id,
        stage_id: row.stage_id,
        stage_name: row.stage_name,
        deadline: row.deadline,
        level: row.level,
        student_id: row.student_id,
        student_name: row.student_name,
        student_email: row.student_email,
        university_id: row.university_id,
        is_leader: Boolean(row.is_leader),
        group_id: row.group_id,
        group_name: row.group_name,
        submitted_at: row.submitted_at,
        status: row.status || 'On Time',
        files: fileObjects,
      };
    });

    return res.json({ success: true, data: normalized });
  } catch (err) {
    console.error('getMentorSubmissions error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};


// ── 8. Mentor Calendar Events ──────────────────────────────────────────────
// Retrieves aggregated student tasks due dates, milestones, and coordinator stage deadlines for mentor's assigned groups.
exports.getMentorCalendarEvents = async (req, res) => {
  const mentorId = req.query.mentorId || req.params.mentorId || req.headers['x-user-id'];

  if (!mentorId) {
    return res.status(400).json({ success: false, message: 'mentorId is required' });
  }

  try {
    // 1. Fetch assigned groups for this mentor
    const [groups] = await queryWithRetry(
      `SELECT id, group_name, level, department, created_by
       FROM project_groups
       WHERE mentor_id = ? AND level > 1`,
      [mentorId]
    );

    if (groups.length === 0) {
      return res.json({
        success: true,
        data: {
          groups: [],
          tasks: [],
          milestones: [],
          stages: [],
        },
      });
    }

    const groupIds = groups.map((g) => g.id);
    const levels = Array.from(new Set(groups.map((g) => g.level)));
    const coordinatorIds = Array.from(new Set(groups.map((g) => g.created_by).filter(Boolean)));

    // 2. Fetch student tasks with due dates
    const [tasks] = await queryWithRetry(
      `SELECT st.id, st.task_name, st.description, st.status, st.due_date, st.created_at, st.mentor_feedback,
              u.name AS assigned_to_name, u.university_id,
              m.title AS milestone_title, m.group_id,
              pg.group_name, pg.level
       FROM student_tasks st
       JOIN milestones m ON m.id = st.milestone_id
       JOIN project_groups pg ON pg.id = m.group_id
       LEFT JOIN users u ON u.id = st.assigned_to
       WHERE m.group_id IN (?) AND st.due_date IS NOT NULL
       ORDER BY st.due_date ASC`,
      [groupIds]
    );

    // 3. Fetch project milestones with due dates
    const [milestones] = await queryWithRetry(
      `SELECT m.id, m.group_id, m.title, m.description, m.start_date, m.due_date, m.status,
              pg.group_name, pg.level
       FROM milestones m
       JOIN project_groups pg ON pg.id = m.group_id
       WHERE m.group_id IN (?) AND m.due_date IS NOT NULL
       ORDER BY m.due_date ASC`,
      [groupIds]
    );

    // 4. Fetch coordinator stages with deadlines (filtered to official group coordinators)
    let stages = [];
    if (levels.length > 0 && coordinatorIds.length > 0) {
      const [stageRows] = await queryWithRetry(
        `SELECT ps.stage_id, ps.level, ps.stage_name, ps.description, ps.deadline, ps.created_by,
                u.name AS coordinator_name
         FROM project_stages ps
         JOIN users u ON ps.created_by = u.id
         WHERE ps.level IN (?) AND ps.created_by IN (?) AND ps.deadline IS NOT NULL
         ORDER BY ps.deadline ASC`,
        [levels, coordinatorIds]
      );
      stages = stageRows;
    }

    return res.json({
      success: true,
      data: {
        groups,
        tasks,
        milestones,
        stages,
      },
    });
  } catch (err) {
    console.error('getMentorCalendarEvents error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── 9. Mentor Project Delays (Uncompleted tasks past their due date) ─────────
exports.getMentorProjectDelays = async (req, res) => {
  const mentorId = req.params.mentorId || req.query.mentorId || req.headers['x-user-id'];
  const level = req.query.level;

  if (!mentorId) {
    return res.status(400).json({ success: false, message: 'Mentor ID is required.' });
  }

  try {
    // 1. Get all assigned project groups for this mentor
    let groupQuery = `SELECT pg.id, pg.group_name, pg.level, pg.department 
                      FROM project_groups pg 
                      WHERE pg.mentor_id = ? AND pg.level > 1`;
    let groupParams = [mentorId];

    if (level && !isNaN(Number(level)) && Number(level) > 1) {
      groupQuery += ' AND pg.level = ?';
      groupParams.push(Number(level));
    }

    const [groups] = await queryWithRetry(groupQuery, groupParams);

    if (groups.length === 0) {
      return res.json({
        success: true,
        data: [],
        stats: { totalDelayed: 0, groupsCount: 0, studentsCount: 0, maxDaysOverdue: 0 },
      });
    }

    const groupIds = groups.map((g) => g.id);

    // 2. Query all tasks from these groups where due_date is in the past and status is not COMPLETED
    const [delayedTasks] = await queryWithRetry(
      `SELECT st.id AS task_id, st.task_name, st.description, st.status, st.due_date, st.created_at,
              st.mentor_feedback, st.assigned_to,
              u.name AS assigned_to_name, u.email AS assigned_to_email, u.university_id,
              m.id AS milestone_id, m.title AS milestone_title,
              pg.id AS group_id, pg.group_name, pg.level, pg.department,
              DATEDIFF(CURRENT_DATE, st.due_date) AS days_overdue
       FROM student_tasks st
       JOIN milestones m ON m.id = st.milestone_id
       JOIN project_groups pg ON pg.id = m.group_id
       LEFT JOIN users u ON u.id = st.assigned_to
       WHERE m.group_id IN (?)
         AND UPPER(TRIM(st.status)) != 'COMPLETED'
         AND st.due_date IS NOT NULL
         AND st.due_date < CURRENT_DATE
       ORDER BY st.due_date ASC, st.id ASC`,
      [groupIds]
    );

    const affectedGroups = new Set(delayedTasks.map((t) => t.group_id)).size;
    const affectedStudents = new Set(delayedTasks.map((t) => t.assigned_to).filter(Boolean)).size;
    const maxDaysOverdue = delayedTasks.reduce((max, t) => Math.max(max, Number(t.days_overdue) || 0), 0);

    return res.json({
      success: true,
      data: delayedTasks,
      stats: {
        totalDelayed: delayedTasks.length,
        groupsCount: affectedGroups,
        studentsCount: affectedStudents,
        maxDaysOverdue,
      },
    });
  } catch (err) {
    console.error('getMentorProjectDelays error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
