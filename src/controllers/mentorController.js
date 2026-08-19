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
  return announcements.filter((a) => {
    const aud = String(a.target_audience || '').trim().toLowerCase();
    return !aud.includes('level 1') && !aud.includes('level1');
  });
};

// ── Department mapping helper ─────────────────────────────────────────────────
const mapAllowedDepartments = (deptList) => {
  const mapped = new Set(deptList.map((d) => String(d).toUpperCase().trim()));
  if (mapped.has('ITM') || mapped.has('IDS')) {
    mapped.add('ITM');
    mapped.add('IDS');
  }
  if (mapped.has('AI') || mapped.has('CM')) {
    mapped.add('AI');
    mapped.add('CM');
  }
  if (mapped.has('IT')) {
    mapped.add('IT');
  }
  return Array.from(mapped);
};

// ── 3. Standalone mentor announcements endpoint ──────────────────────────────
// Strictly filters announcements by the mentor's assigned level(s) and group department(s).
exports.getMentorAnnouncements = async (req, res) => {
  const mentorId = req.query.mentorId || req.params.mentorId || req.headers['x-user-id'] || req.user?.id;
  const levelFilter = req.query.level ? Number(req.query.level) : null;
  const departmentFilter = req.query.department ? String(req.query.department).trim().toUpperCase() : null;

  try {
    let assignedLevels = [];
    let assignedDepts = [];
    let coordinatorIds = [];
    let supervisorIds = [];

    if (mentorId) {
      // 1. Fetch mentor profile
      const [mentorRows] = await queryWithRetry(
        'SELECT id, name, role, academic_unit, level FROM users WHERE id = ?',
        [mentorId]
      );
      if (mentorRows.length > 0) {
        const mUser = mentorRows[0];
        if (mUser.level && Number(mUser.level) > 1) {
          assignedLevels.push(Number(mUser.level));
        }
        if (mUser.academic_unit) {
          assignedDepts.push(String(mUser.academic_unit).trim().toUpperCase());
        }
      }

      // 2. Fetch assigned groups for this mentor
      const [assignedGroups] = await queryWithRetry(
        'SELECT id, group_name, level, department, created_by, supervisor_id FROM project_groups WHERE mentor_id = ? AND level > 1',
        [mentorId]
      );

      for (const g of assignedGroups) {
        if (g.level && Number(g.level) > 1 && !assignedLevels.includes(Number(g.level))) {
          assignedLevels.push(Number(g.level));
        }
        if (g.department) {
          const dept = String(g.department).trim().toUpperCase();
          if (!assignedDepts.includes(dept)) assignedDepts.push(dept);
        }
        if (g.created_by && !coordinatorIds.includes(g.created_by)) {
          coordinatorIds.push(g.created_by);
        }
        if (g.supervisor_id && !supervisorIds.includes(g.supervisor_id)) {
          supervisorIds.push(g.supervisor_id);
        }
      }
    }

    if (levelFilter && !isNaN(levelFilter) && levelFilter > 1) {
      assignedLevels = [levelFilter];
    }
    if (departmentFilter) {
      assignedDepts = [departmentFilter];
    }

    const allowedUnits = mapAllowedDepartments(assignedDepts);

    // 3. Query all announcements with author metadata
    const query = `
      SELECT a.id, a.title, a.message, a.message AS content, a.target_audience, a.created_at,
             COALESCE(u.name, a.author_name) AS author_name,
             a.author_id,
             u.role AS author_role,
             u.academic_unit AS author_academic_unit,
             u.level AS author_level
      FROM announcements a
      LEFT JOIN users u ON a.author_id = u.id
      ORDER BY a.created_at DESC
    `;

    const [rows] = await queryWithRetry(query);

    // 4. Apply strict filtering
    const filtered = rows.filter((a) => {
      const aud = String(a.target_audience || '').trim().toLowerCase();
      const authorRole = String(a.author_role || '').toLowerCase();
      const authorDept = String(a.author_academic_unit || '').trim().toUpperCase();
      const authorLevel = a.author_level ? Number(a.author_level) : null;
      const authorId = a.author_id;

      // 4a. STRICTLY EXCLUDE Level 1
      if (
        aud.includes('level 1') ||
        aud.includes('level1') ||
        aud === 'level 1 students' ||
        aud === 'level 1 assigned students'
      ) {
        return false;
      }

      // 4b. Exclude specific other roles (Supervisors/Coordinators/Admins only) unless mentor or group supervisor
      if (
        (aud.includes('supervisor') && !aud.includes('all') && !aud.includes('mentor') && !supervisorIds.includes(authorId)) ||
        (aud.includes('coordinator') && !aud.includes('all') && !aud.includes('mentor')) ||
        (aud.includes('admin') && !aud.includes('all') && !aud.includes('mentor'))
      ) {
        if (aud.includes('assigned student') || aud.includes('assigned students')) {
          return Boolean(authorId && supervisorIds.includes(authorId));
        }
        return false;
      }

      // 4c. Supervisor announcements for assigned students
      if (aud.includes('assigned student') || aud.includes('assigned students')) {
        return Boolean(authorId && supervisorIds.includes(authorId));
      }

      // 4d. ALWAYS INCLUDE General / System-wide announcements
      if (
        aud === 'all' ||
        aud === 'all system users' ||
        aud === 'all students and staff' ||
        aud === 'all users' ||
        aud === '' ||
        aud === 'system'
      ) {
        return true;
      }

      // 4e. ALWAYS INCLUDE Mentor-targeted announcements
      if (
        aud.includes('mentor') ||
        aud.includes('industry mentor') ||
        aud.includes('mentors')
      ) {
        return true;
      }

      // 4f. Level check
      const isLevel2Target = aud.includes('level 2') || aud.includes('level2');
      const isLevel3Target = aud.includes('level 3') || aud.includes('level3');
      const isLevel4Target = aud.includes('level 4') || aud.includes('level4');

      if (isLevel2Target || isLevel3Target || isLevel4Target) {
        if (assignedLevels.length > 0) {
          const matchesLevel =
            (isLevel2Target && assignedLevels.includes(2)) ||
            (isLevel3Target && assignedLevels.includes(3)) ||
            (isLevel4Target && assignedLevels.includes(4));

          if (!matchesLevel) return false;
        }

        // Department/Coordinator scoping if author is a coordinator
        if (assignedDepts.length > 0 && authorDept && allowedUnits.length > 0) {
          if (!allowedUnits.includes(authorDept)) {
            if (coordinatorIds.length > 0 && authorId && !coordinatorIds.includes(authorId)) {
              return false;
            }
          }
        }

        return true;
      }

      // 4g. Group coordinator announcements
      if (authorId && coordinatorIds.includes(authorId)) {
        return true;
      }

      // 4h. Coordinator for mentor's level & department
      if (authorRole === 'coordinator' || authorRole === 'lecturer') {
        if (
          authorDept &&
          allowedUnits.includes(authorDept) &&
          (!authorLevel || assignedLevels.includes(authorLevel))
        ) {
          return true;
        }
      }

      // If mentor has no assigned groups/levels, fallback to showing general + mentor announcements
      if (assignedLevels.length === 0 && assignedDepts.length === 0) {
        return true;
      }

      return false;
    });

    return res.json({
      success: true,
      announcements: filtered,
      data: filtered,
      meta: {
        mentorId: mentorId || null,
        assignedLevels,
        assignedDepartments: assignedDepts,
        count: filtered.length,
      },
    });
  } catch (err) {
    console.error('getMentorAnnouncements error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.getMentorAnnouncementById = async (req, res) => {
  const { id } = req.params;
  const query = `
    SELECT a.id, a.title, a.message, a.message AS content, a.target_audience, a.created_at,
           COALESCE(u.name, a.author_name) AS author_name,
           a.author_id,
           u.role AS author_role,
           u.academic_unit AS author_academic_unit,
           u.level AS author_level
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
    const aud = String(announcement.target_audience || '').trim().toLowerCase();
    if (aud.includes('level 1') || aud.includes('level1')) {
      return res.status(403).json({
        success: false,
        message: 'Industry mentors cannot access Level 1 announcements.',
      });
    }
    return res.json({ success: true, announcement, data: announcement });
  } catch (err) {
    console.error('getMentorAnnouncementById error:', err);
    return res.status(500).json({ success: false, error: err.message });
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
  const fbText = mentor_feedback || feedback || '';
  try {
    await queryWithRetry(
      'UPDATE student_tasks SET mentor_feedback = ? WHERE id = ?',
      [fbText, taskId]
    );
    res.json({ success: true, message: 'Feedback saved successfully.' });
  } catch (err) {
    console.error('saveMentorTaskFeedback error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.clearMentorTaskFeedback = async (req, res) => {
  const { taskId } = req.params;
  try {
    await queryWithRetry(
      'UPDATE student_tasks SET mentor_feedback = NULL WHERE id = ?',
      [taskId]
    );
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
