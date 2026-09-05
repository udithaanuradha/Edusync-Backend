const db = require('../config/db');
const dbPromise = db.promise();

let ensureMembersTablePromise = null;
let projectGroupsHasCreatedByCache = null;
let ensureRequestLifecycleColumnsPromise = null;

const ensureRequestLifecycleColumns = async () => {
  if (!ensureRequestLifecycleColumnsPromise) {
    ensureRequestLifecycleColumnsPromise = (async () => {
      try {
        const [columns] = await dbPromise.query('SHOW COLUMNS FROM group_requests');
        const columnNames = new Set((columns || []).map((column) => column.Field));

        if (!columnNames.has('is_group_created')) {
          await dbPromise.query(`ALTER TABLE group_requests ADD COLUMN is_group_created BOOLEAN NOT NULL DEFAULT FALSE`);
        }

        if (!columnNames.has('created_group_id')) {
          await dbPromise.query(`ALTER TABLE group_requests ADD COLUMN created_group_id INT NULL`);
        }

        const [fkCheck] = await dbPromise.query(
          `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'group_requests' AND COLUMN_NAME = 'created_group_id' LIMIT 1`
        );

        if (fkCheck.length === 0) {
          try {
            await dbPromise.query(
              `ALTER TABLE group_requests ADD CONSTRAINT fk_gr_created_group
               FOREIGN KEY (created_group_id) REFERENCES project_groups(id) ON DELETE SET NULL`
            );
          } catch (constraintError) {
            if (!String(constraintError.message).includes('Duplicate key') && !String(constraintError.message).includes('already exists')) {
              throw constraintError;
            }
          }
        }
      } catch (error) {
        console.warn('group_requests lifecycle tracking check failed:', error.message);
      }
    })();
  }

  await ensureRequestLifecycleColumnsPromise;
};

// A group_requests row can carry up to 2 approved supervisors (see
// group_request_supervisors / the "both must approve" workflow), but
// project_groups only ever had room for one — creating a group from a
// dual-supervisor request silently dropped the second approver entirely.
// Self-heals the same way ensureRequestLifecycleColumns does.
let ensureGroupSupervisorId2ColumnPromise = null;
const ensureGroupSupervisorId2Column = async () => {
  if (!ensureGroupSupervisorId2ColumnPromise) {
    ensureGroupSupervisorId2ColumnPromise = (async () => {
      // TiDB rejects ADD COLUMN + ADD CONSTRAINT on that same new column in
      // one combined ALTER TABLE ("Key column ... doesn't exist in table") —
      // unlike vanilla MySQL, they must be two separate statements here.
      const [columns] = await dbPromise.query("SHOW COLUMNS FROM project_groups LIKE 'supervisor_id_2'");
      if (columns.length === 0) {
        await dbPromise.query(`ALTER TABLE project_groups ADD COLUMN supervisor_id_2 INT NULL`);
        await dbPromise.query(
          `ALTER TABLE project_groups ADD CONSTRAINT fk_pg_supervisor_2 FOREIGN KEY (supervisor_id_2) REFERENCES users(id)`
        );
      }
    })().catch((error) => {
      // Don't cache a failed attempt — an error here (e.g. a transient
      // connection issue) would otherwise permanently skip the column for
      // the rest of the process's lifetime, since the resolved promise is
      // reused by every subsequent call.
      console.warn('project_groups.supervisor_id_2 check failed:', error.message);
      ensureGroupSupervisorId2ColumnPromise = null;
    });
  }
  await ensureGroupSupervisorId2ColumnPromise;
};

const projectGroupsHasCreatedBy = async () => {
  if (projectGroupsHasCreatedByCache !== null) {
    return projectGroupsHasCreatedByCache;
  }

  try {
    const [rows] = await dbPromise.query("SHOW COLUMNS FROM project_groups LIKE 'created_by'");
    projectGroupsHasCreatedByCache = rows.length > 0;
  } catch (error) {
    console.warn('project_groups.created_by check failed, assuming column is missing:', error.message);
    projectGroupsHasCreatedByCache = false;
  }

  return projectGroupsHasCreatedByCache;
};

/**
 * Ensures the 'project_group_members' table exists in the database.
 * Uses a promise variable to prevent multiple redundant 'CREATE TABLE' checks.
 */
const ensureGroupMembersTable = async () => {
  if (!ensureMembersTablePromise) {
    ensureMembersTablePromise = dbPromise.query(`
      CREATE TABLE IF NOT EXISTS project_group_members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        group_id INT NOT NULL,
        student_id INT NOT NULL,
        is_leader TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_group_student (group_id, student_id),
        KEY idx_group_id (group_id),
        KEY idx_student_id (student_id)
      )
    `);
  }
  await ensureMembersTablePromise;
};


//--------------------------------------------------------------------------------------------------------------------------------
// --- HELPER FUNCTIONS (PRESERVED) ---
/**
 * Regular expression helper to pull the project name from a raw text message
 */
const extractProjectName = (requestMessage) => {
  const text = String(requestMessage || '');
  const match = text.match(/Project:\s*([^\n.]+)/i);
  return match ? match[1].trim() : 'Untitled Project';
};


/**
 * Regular expression helper to identify the leader's name from a formatted members list
 */
const extractLeaderName = (membersList) => {
  const text = String(membersList || '');
  const match = text.match(/Leader:\s*([^,\n]+)/i);
  return match ? match[1].trim() : 'Not provided';
};


/**
 * Regular expression helper to extract up to 5 unique University IDs (5-8 digits) from text
 */
const extractMemberIndexes = (membersList) => {
  const text = String(membersList || '');
  const matches = text.match(/\b\d{5,8}[A-Za-z]?\b/g) || [];
  return [...new Set(matches.map((item) => item.toUpperCase()))].slice(0, 5);
};


/**
 * Helper to parse names from a list, removing keywords like 'Leader' or 'Member'
 */
const extractMemberNames = (membersList) => {
  const text = String(membersList || '');
  const normalized = text.replace(/\bLeader:\s*/gi, '').replace(/\bMembers?:\s*/gi, '');
  const tokens = normalized.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)
    .map((item) => item.split('-')[0].trim())
    .filter((item) => /[A-Za-z]/.test(item) && item.length >= 3);
  return [...new Set(tokens)].slice(0, 5);
};

//--------------------------------------------------------------------------------------------------------------------------------
// --- CONTROLLER FUNCTIONS ---

const getGroupsByLevel = async (req, res) => {
  const level = Number(req.params.level);
  const coordinatorId = req.query.coordinatorId; // Extract from query string
  console.log(`🔍 Fetching groups for Level: ${level}${coordinatorId ? ` created by Coordinator: ${coordinatorId}` : ' (ALL coordinators)'}`);
  
  try {
    await ensureGroupMembersTable();
    await ensureGroupSupervisorId2Column();
    const supportsCoordinatorTracking = await projectGroupsHasCreatedBy();

    // 1. Get the Groups - filter by coordinator if provided
    // supervisor_id_2 is included (alongside the primary supervisor_id) so
    // the Calendar page's panel-scheduling drawer can auto-detect BOTH of a
    // group's assigned supervisors when building the panel roster, rather
    // than only ever seeing the first one.
    let groupQuery = `SELECT pg.id AS groupId, pg.group_name AS groupName,
                     pg.supervisor_id AS supervisorId, u.name AS supervisor,
                     pg.supervisor_id_2 AS supervisorId2, u2.name AS supervisor2,
                     pg.mentor_id AS mentorId
                     FROM project_groups pg
                     LEFT JOIN users u ON u.id = pg.supervisor_id
                     LEFT JOIN users u2 ON u2.id = pg.supervisor_id_2
                     WHERE pg.level = ?`;
    let params = [level];
    
    if (coordinatorId && supportsCoordinatorTracking) {
      groupQuery += ` AND pg.created_by = ?`;
      params.push(coordinatorId);
    }
    
    groupQuery += ` ORDER BY pg.id DESC`;
    
    const [groups] = await dbPromise.query(groupQuery, params);

    console.log(`📊 Found ${groups.length} groups for Level ${level}${coordinatorId ? ` by Coordinator ${coordinatorId}` : ''}.`);

    if (!groups.length) {
      return res.json([]); // Return empty array if no groups
    }

    const groupIds = groups.map((g) => g.groupId);



    // Fetch detailed user info for all students in those groups
    const [members] = await dbPromise.query(
      `SELECT gm.group_id, u.id, u.name, u.university_id, gm.is_leader
       FROM project_group_members gm
       LEFT JOIN users u ON u.id = gm.student_id
       WHERE gm.group_id IN (?)
       ORDER BY gm.is_leader DESC, u.name ASC`,
      [groupIds]
    );

    // Fetch all mentors from project_group_mentors junction table
    let assignedMentors = [];
    try {
      const [mRows] = await dbPromise.query(
        `SELECT pgm.group_id, u.id, u.name, u.email, u.phone
         FROM project_group_mentors pgm
         JOIN users u ON u.id = pgm.mentor_id
         WHERE pgm.group_id IN (?)
         ORDER BY u.name ASC`,
        [groupIds]
      );
      assignedMentors = mRows || [];
    } catch (mErr) {
      console.warn('project_group_mentors query fallback in groupController:', mErr.message);
    }

    // Fallback: fetch legacy mentors
    const [legacyMentors] = await dbPromise.query(
      `SELECT pg.id AS group_id, u.id, u.name, u.email, u.phone
       FROM project_groups pg
       JOIN users u ON u.id = pg.mentor_id
       WHERE pg.id IN (?) AND pg.mentor_id IS NOT NULL`,
      [groupIds]
    );

    // 3. Format the data into an Array of objects
    const formattedData = groups.map((group) => {
      const groupMembers = members
        .filter((m) => m.group_id === group.groupId)
        .map((m) => ({
          id: m.id,
          name: m.name || "Unknown Student",
          university_id: m.university_id,
          is_leader: m.is_leader
        }));

      const leader = groupMembers.find(
        (m) => Number(m.is_leader) === 1
      );

      // Merge mentors from junction table + legacy column
      const junctionGroupMentors = assignedMentors.filter((m) => m.group_id === group.groupId);
      const legacyGroupMentors = legacyMentors.filter((m) => m.group_id === group.groupId);
      
      const allMentorsMap = new Map();
      junctionGroupMentors.forEach(m => allMentorsMap.set(m.id, m));
      legacyGroupMentors.forEach(m => {
        if (!allMentorsMap.has(m.id)) allMentorsMap.set(m.id, m);
      });
      const groupMentorsList = Array.from(allMentorsMap.values());

      const mentorDisplayNames = groupMentorsList.map(m => m.name).filter(Boolean);
      const mentorDisplayName = mentorDisplayNames.join(', ') || 'Unassigned';

      return {
        groupId: group.groupId,
        groupName: group.groupName,
        department: group.department,
        supervisorId: group.supervisorId || null,
        supervisor: group.supervisor || 'Not Assigned',
        supervisorId2: group.supervisorId2 || null,
        supervisor2: group.supervisor2 || null,
        mentorId: groupMentorsList[0]?.id || group.mentorId || null,
        mentor: mentorDisplayName,
        mentorName: mentorDisplayName,
        assignedMentor: mentorDisplayName,
        mentors: groupMentorsList,
        mentorNames: mentorDisplayNames,
        leader: leader ? leader.name : (groupMembers[0]?.name || 'Not Assigned'),
        members: groupMembers,
        status: 'Active'
      };
    });

    // CRITICAL: Send only the array so frontend can use .map()
    return res.json(formattedData);

  } catch (error) {
    console.error('❌ Get Groups Backend Error:', error);
    return res.status(500).json({ error: 'Failed to fetch groups' });
  }
};








/**
 * GET: Fetches the specific group(s) a student belongs to
 */

const getStudentGroup = async (req, res) => {
  const studentId = req.params.studentId;
  const level = req.params.level ? Number(req.params.level) : null;
  
  console.log(`🔍 Fetching group for Student ID: ${studentId}, Level: ${level}`);

  try {
    await ensureGroupMembersTable();
    
    //  Join groups with members table to find where student_id matches and optionally filter by level
    
    const [userGroups] = await dbPromise.query(
      `SELECT pg.id AS groupId, pg.group_name AS groupName, u.name AS supervisor, pg.level,
              pg.supervisor_id AS supervisorId, u2.name AS supervisor2, pg.supervisor_id_2 AS supervisorId2
       FROM project_groups pg
       JOIN project_group_members gm ON pg.id = gm.group_id
       LEFT JOIN users u ON u.id = pg.supervisor_id
       LEFT JOIN users u2 ON u2.id = pg.supervisor_id_2
       WHERE gm.student_id = ? ${level ? 'AND pg.level = ?' : ''}`,
      level ? [studentId, level] : [studentId]
    );

    console.log(`📊 Found ${userGroups.length} groups for this student.`);

    if (!userGroups.length) {
      return res.json([]); 
    }

    const groupIds = userGroups.map((g) => g.groupId);

    // 2. Get all members for these groups with more details
    const [members] = await dbPromise.query(
      `SELECT gm.group_id, u.id, u.name, u.university_id, gm.is_leader
       FROM project_group_members gm
       LEFT JOIN users u ON u.id = gm.student_id
       WHERE gm.group_id IN (?)
       ORDER BY gm.is_leader DESC, u.name ASC`,
      [groupIds]
    );

    // 3. Format the data
    const formattedData = userGroups.map((group) => {
      const groupMembers = members
        .filter((m) => m.group_id === group.groupId)
        .map((m) => ({
          id: m.id,
          name: m.name || "Unknown Student",
          university_id: m.university_id,
          is_leader: m.is_leader
        }));

      const leader = groupMembers.find(
        (m) => Number(m.is_leader) === 1
      );

      return {
        groupId: group.groupId,
        groupName: group.groupName,
        level: group.level,
        supervisor: group.supervisor || 'Not Assigned',
        // Additive — id (and the optional second supervisor) for callers
        // that need to actually reference the assigned supervisor(s), e.g.
        // populating a dropdown restricted to this student's own group.
        supervisorId: group.supervisorId || null,
        supervisorId2: group.supervisorId2 || null,
        supervisor2: group.supervisor2 || null,
        leader: leader ? leader.name : (groupMembers[0]?.name || 'Not Assigned'),
        members: groupMembers,
        status: 'Active'
      };
    });

    return res.json(formattedData);

  } catch (error) {
    console.error('❌ Get Student Group Backend Error:', error);
    return res.status(500).json({ error: 'Failed to fetch student group' });
  }
};







/**
 * GET: Fetches requests approved by supervisors that are ready for coordinator review
 */

const getCoordinatorApprovedRequests = async (req, res) => {
  const rawLevel = req.query.level;
  const level = rawLevel === undefined ? null : Number(rawLevel);
  const finalOnly = String(req.query.finalOnly || '0') === '1' ? 1 : 0;
  const coordinatorId = req.query.coordinatorId ? Number(req.query.coordinatorId) : null;

  try {
    await ensureRequestLifecycleColumns();

    // Scope results to the requesting coordinator's own department so
    // requests aren't shared across every coordinator at a level. If
    // coordinatorId is missing/unresolved, coordinatorDepartment stays null
    // and the added WHERE condition below passes through unfiltered.
    //
    // Students choose a degree program from {AI, IT, ITM} at signup;
    // lecturers/coordinators choose a department from {IT, IDS, CM} — for
    // the same real-world program these are different raw codes
    // (IDS==ITM, CM==AI; see ProjectModel.js's normalizeAcademicUnit for
    // the equivalent used on stage visibility). A raw string comparison
    // here meant a coordinator stored as 'IDS' could never match their own
    // students stored as 'ITM', silently hiding every one of their
    // students' finalized requests from "Pending Group Formations".
    const normalizeAcademicUnit = (unit) => {
      const clean = String(unit || '').trim().toUpperCase();
      if (clean === 'IDS' || clean === 'ITM') return 'ITM';
      if (clean === 'CM' || clean === 'AI') return 'AI';
      if (clean === 'IT') return 'IT';
      return clean || null;
    };

    let coordinatorDepartment = null;
    if (coordinatorId) {
      const [coordRows] = await dbPromise.query('SELECT academic_unit FROM users WHERE id = ?', [coordinatorId]);
      coordinatorDepartment = normalizeAcademicUnit(coordRows[0]?.academic_unit);
    }

    // Build the WHERE clause dynamically
    let whereCondition = `gr.status = 'approved'
         AND (COALESCE(gr.is_group_created, 0) = 0 OR gr.created_group_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM project_groups pg WHERE pg.id = gr.created_group_id
         ))
         AND (? = 0 OR COALESCE(gr.is_final_submitted, 0) = 1)
         AND (? IS NULL OR COALESCE(gr.project_level, student.level) = ?)
         AND (? IS NULL OR
              CASE
                WHEN UPPER(TRIM(student.academic_unit)) IN ('IDS', 'ITM') THEN 'ITM'
                WHEN UPPER(TRIM(student.academic_unit)) IN ('CM', 'AI') THEN 'AI'
                WHEN UPPER(TRIM(student.academic_unit)) = 'IT' THEN 'IT'
                ELSE UPPER(TRIM(student.academic_unit))
              END = ?)`;
    let params = [finalOnly, level, level, coordinatorDepartment, coordinatorDepartment];

    const [rows] = await dbPromise.query(
      `SELECT gr.*, student.name AS student_name, student.level AS student_level,
              student.academic_unit AS department,
              (SELECT GROUP_CONCAT(u.name SEPARATOR ', ')
               FROM group_request_supervisors grs
               JOIN users u ON u.id = grs.supervisor_id
               WHERE grs.request_id = gr.request_id AND grs.status = 'approved') AS supervisor_name
       FROM group_requests gr
       LEFT JOIN users student ON student.id = gr.student_id
       WHERE ${whereCondition}
       ORDER BY gr.created_at DESC`,
      params
    );

// Business Logic: Resolve the raw member list into actual database user records
    const data = await Promise.all(rows.map(async (row) => {
      const normalizedLevel = Number(row.project_level ?? row.student_level ?? 0);
      const indexes = extractMemberIndexes(row.members_list);
      let resolvedMembers = [];

      if (indexes.length > 0 && normalizedLevel > 0) {
        const [memberRows] = await dbPromise.query(
          //Find students matching the university IDs extracted from the request
          `SELECT id, name, university_id, email, level FROM users
           WHERE role = 'student' AND level = ? AND university_id IN (?)`,
          [normalizedLevel, indexes]
        );
        resolvedMembers = memberRows;
      }

      // Fallback: if no members matched by university ID, try matching by name
      if (resolvedMembers.length === 0 && normalizedLevel > 0) {
        const names = extractMemberNames(row.members_list);
        if (names.length > 0) {
          const [memberRowsByName] = await dbPromise.query(
            `SELECT id, name, university_id, email, level FROM users
             WHERE role = 'student' AND level = ? AND name IN (?)`,
            [normalizedLevel, names]
          );
          resolvedMembers = memberRowsByName;
        }
      }

      // Always ensure the leader (row.student_id) is present via a direct FK lookup
      if (normalizedLevel > 0 && Number(row.student_id) > 0) {
        const [requesterRows] = await dbPromise.query(
          `SELECT id, name, university_id, email, level FROM users
           WHERE id = ? AND role = 'student' AND level = ?
           LIMIT 1`,
          [row.student_id, normalizedLevel]
        );

        if (requesterRows.length > 0) {
          const requester = requesterRows[0];
          if (!resolvedMembers.some((member) => member.id === requester.id)) {
            resolvedMembers = [requester, ...resolvedMembers];
          }
        }
      }

      return {
        request_id: row.request_id,
        project_name: extractProjectName(row.request_message),
        group_name: row.group_name,
        group_leader: extractLeaderName(row.members_list),
        supervisor_name: row.supervisor_name || 'Not assigned',
        supervisor_id: row.supervisor_id,
        department: row.department,
        resolved_members: resolvedMembers,
        created_at: row.created_at,
        is_group_created: !!row.is_group_created,
        created_group_id: row.created_group_id || null,
        group_status: row.is_group_created ? 'already_created' : 'pending_creation'
      };
    }));

    return res.json({ success: true, data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: 'Failed to load requests.' });
  }
};

const resolveGroupRequestForCreatedGroup = async (connection, { leaderId, level, groupName }) => {
  const safeGroupName = String(groupName || '').trim();
  const [matches] = await connection.query(
    `SELECT request_id, group_name
     FROM group_requests
     WHERE student_id = ?
       AND project_level = ?
       AND status = 'approved'
       AND COALESCE(is_group_created, 0) = 0
     ORDER BY created_at DESC, request_id DESC
     LIMIT 20`,
    [leaderId, level]
  );

  if (!matches.length) {
    return null;
  }

  if (safeGroupName) {
    const exact = matches.find((row) => String(row.group_name || '').trim().toLowerCase() === safeGroupName.toLowerCase());
    if (exact) {
      return exact.request_id;
    }

    const fuzzy = matches.find((row) => {
      const existingName = String(row.group_name || '').trim().toLowerCase();
      return existingName.includes(safeGroupName.toLowerCase()) || safeGroupName.toLowerCase().includes(existingName);
    });

    if (fuzzy) {
      return fuzzy.request_id;
    }
  }

  return matches[0].request_id;
};

const createGroup = async (req, res) => {
  const {
    groupName,
    level,
    supervisorId,
    supervisorId2,
    leaderId,
    memberIds,
    createdBy,
    created_by,
    department,
  } = req.body;
  const coordinatorId = createdBy ?? created_by ?? null;
  let connection;
  try {
    await ensureGroupMembersTable();
    await ensureRequestLifecycleColumns();
    await ensureGroupSupervisorId2Column();
    const supportsCoordinatorTracking = await projectGroupsHasCreatedBy();
    connection = await dbPromise.getConnection();
    await connection.beginTransaction();

    // Department isn't always known by the caller — resolve it from the
    // group leader's own department (academic_unit) when not supplied.
    let resolvedDepartment = department || null;
    if (!resolvedDepartment && leaderId) {
      const [leaderRows] = await connection.query('SELECT academic_unit FROM users WHERE id = ?', [leaderId]);
      resolvedDepartment = leaderRows[0]?.academic_unit || null;
    }

    let insertQuery = `INSERT INTO project_groups (group_name, level, supervisor_id, supervisor_id_2, department`;
    const insertValues = [groupName, level, supervisorId || null, supervisorId2 || null, resolvedDepartment];

    if (supportsCoordinatorTracking) {
      insertQuery += ', created_by';
      insertValues.push(coordinatorId);
    }

    insertQuery += ') VALUES (?, ?, ?, ?, ?';
    if (supportsCoordinatorTracking) {
      insertQuery += ', ?';
    }
    insertQuery += ')';

    const [groupInsert] = await connection.query(insertQuery, insertValues);

    const groupId = groupInsert.insertId;

    // NEW: defense-in-depth — reject if any member being added here already
    // belongs to a different, already-existing group. createGroupRequest
    // checks this earlier in the flow, but this step can in principle run
    // on its own, so it's checked again right before the members are
    // actually inserted.
    const [alreadyGroupedAtCreate] = await connection.query(
      `SELECT pm.student_id
       FROM project_group_members pm
       JOIN project_groups pg ON pg.id = pm.group_id
       WHERE pm.student_id IN (?)
         AND pg.id != ?`,
      [memberIds, groupId]
    );
    if (alreadyGroupedAtCreate.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: 'One or more members already belong to another group.',
        already_grouped_member_ids: alreadyGroupedAtCreate.map((m) => m.student_id),
      });
    }

    const memberRows = memberIds.map((id) => [groupId, id, id === leaderId ? 1 : 0]);

    await connection.query(
      `INSERT INTO project_group_members (group_id, student_id, is_leader) VALUES ?`,
      [memberRows]
    );

    const matchedRequestId = await resolveGroupRequestForCreatedGroup(connection, { leaderId, level, groupName });
    if (matchedRequestId) {
      await connection.query(
        `UPDATE group_requests
         SET is_group_created = TRUE,
             created_group_id = ?,
             processed_at = NOW()
         WHERE request_id = ?`,
        [groupId, matchedRequestId]
      );
    }

    await connection.commit();
    res.status(201).json({ success: true, data: { groupId } });
  } catch (error) {
    if (connection) await connection.rollback();
    res.status(500).json({ success: false, error: 'Failed to create group.' });
  } finally {
    if (connection) connection.release();
  }};




// update group details and members 
const updateGroup = async (req, res) => {
  const groupId = req.params.id;
  const { groupName, level, supervisorId, supervisorId2, department } = req.body;
  try {
    await ensureGroupSupervisorId2Column();
    if (department !== undefined) {
      await dbPromise.query(
        `UPDATE project_groups SET group_name = ?, level = ?, supervisor_id = ?, supervisor_id_2 = ?, department = ? WHERE id = ?`,
        [groupName, level, supervisorId || null, supervisorId2 || null, department || null, groupId]
      );
    } else {
      await dbPromise.query(
        `UPDATE project_groups SET group_name = ?, level = ?, supervisor_id = ?, supervisor_id_2 = ? WHERE id = ?`,
        [groupName, level, supervisorId || null, supervisorId2 || null, groupId]
      );
    }
    res.json({ success: true, message: 'Group updated.' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Update failed.' });
  }
};




//delete group details and members 
const deleteGroup = async (req, res) => {
  const groupId = Number(req.params.id);

  if (!groupId) {
    return res.status(400).json({ success: false, error: 'Group id is required.' });
  }

  const connection = await dbPromise.getConnection();

  try {
    await ensureRequestLifecycleColumns();
    await connection.beginTransaction();

    const [groupRows] = await connection.query(
      `SELECT group_name, level FROM project_groups WHERE id = ? LIMIT 1`,
      [groupId]
    );

    const groupRow = groupRows[0];

    if (!groupRow) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Group not found.' });
    }

    // Delete (not just unlink) the originating request(s) so the student sees a
    // clean slate afterwards. Previously this only cleared is_group_created/
    // created_group_id, leaving `status` (e.g. 'approved') in place — since
    // getStudentRequestStatus treats any row with no live created_group_id as
    // "latest", the stale approved/pending row resurfaced and blocked the
    // student from submitting a new group request after the old one was deleted.
    await connection.query(
      `DELETE FROM group_requests
       WHERE created_group_id = ?
          OR (group_name = ? AND project_level = ?)
          OR (student_id IN (SELECT student_id FROM project_group_members WHERE group_id = ?))`,
      [groupId, groupRow.group_name, groupRow.level, groupId]
    );

    await connection.query(`DELETE FROM project_group_members WHERE group_id = ?`, [groupId]);
    // `marks.group_id` has no ON DELETE cascade in the schema (unlike milestones/
    // project_overviews/group_members), so evaluated groups must be cleared manually
    // or the delete below fails with ER_ROW_IS_REFERENCED_2 (fk_mark_group).
    await connection.query(`DELETE FROM marks WHERE group_id = ?`, [groupId]);
    await connection.query(`DELETE FROM project_groups WHERE id = ?`, [groupId]);

    await connection.commit();
    return res.json({ success: true, message: 'Deleted.' });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('❌ deleteGroup error:', error);
    return res.status(500).json({ success: false, error: 'Delete failed.' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};



//Fetches all groups managed by a specific coordinator

const getCoordinatorGroups = async (req, res) => {
  const coordinatorId = req.params.coordinatorId;
  const level = Number(req.params.level);
  console.log(`🔍 Fetching groups created by Coordinator ${coordinatorId} for Level: ${level}`);
  
  try {
    await ensureGroupMembersTable();
    await ensureGroupSupervisorId2Column();
    const supportsCoordinatorTracking = await projectGroupsHasCreatedBy();

    // 1. Get the Groups created by this coordinator at this level
    let groupQuery = `SELECT pg.id AS groupId, pg.group_name AS groupName, pg.department AS department,
              u.name AS supervisor, u2.name AS supervisor2
       FROM project_groups pg
       LEFT JOIN users u ON u.id = pg.supervisor_id
       LEFT JOIN users u2 ON u2.id = pg.supervisor_id_2
       WHERE pg.level = ?`;
    const groupParams = [level];

    if (supportsCoordinatorTracking && coordinatorId) {
      groupQuery += ` AND pg.created_by = ?`;
      groupParams.push(coordinatorId);
    }

    groupQuery += ` ORDER BY pg.id DESC`;

    const [groups] = await dbPromise.query(groupQuery, groupParams);

    console.log(`📊 Found ${groups.length} groups created by coordinator ${coordinatorId} for Level ${level}.`);

    if (!groups.length) {
      return res.json([]); // Return empty array if no groups
    }

    const groupIds = groups.map((g) => g.groupId);

    // 2. Get all members for these groups (full objects — id/university_id
    // are required for the member "View Profile" feature to resolve a target)
    const [members] = await dbPromise.query(
      `SELECT gm.group_id, u.id, u.name, u.university_id, gm.is_leader
       FROM project_group_members gm
       LEFT JOIN users u ON u.id = gm.student_id
       WHERE gm.group_id IN (?)
       ORDER BY gm.is_leader DESC, u.name ASC`,
      [groupIds]
    );

    // 3. Format the data into an Array of objects
    const formattedData = groups.map((group) => {
      const groupMembers = members
        .filter((m) => m.group_id === group.groupId)
        .map((m) => ({
          id: m.id,
          name: m.name || "Unknown Student",
          university_id: m.university_id,
          is_leader: m.is_leader,
        }));

      const leader = groupMembers.find((m) => Number(m.is_leader) === 1);

      return {
        groupId: group.groupId,
        groupName: group.groupName,
        department: group.department,
        supervisor: group.supervisor || 'Not Assigned',
        supervisor2: group.supervisor2 || null,
        leaderName: leader ? leader.name : (groupMembers[0]?.name || 'Not Assigned'),
        memberCount: groupMembers.length,
        members: groupMembers,
        status: 'Active'
      };
    });

    return res.json(formattedData);

  } catch (error) {
    console.error('❌ Get Coordinator Groups Backend Error:', error);
    return res.status(500).json({ error: 'Failed to fetch coordinator groups' });
  }
};






//Retrieves a list of members for a specific group  

const getGroupMembers = async (req, res) => {
  const groupId = req.params.groupId;
  const userId = req.headers['x-user-id'];
  const userRole = req.headers['x-user-role'];

  console.log(`🔍 Fetching members for Group ID: ${groupId}`);
  
  try {
    await ensureGroupMembersTable();

    //  If user is a student, verify they actually belong to the group they are requesting
    if (userId && userRole === 'student') {
      const [membership] = await dbPromise.query(
        'SELECT 1 FROM project_group_members WHERE student_id = ? AND group_id = ?',
        [userId, groupId]
      );
      if (membership.length === 0) {
        return res.status(403).json({ success: false, error: 'Access denied. You are not a member of this group.' });
      }
    }


//Fetch all member details for the target group
    const [members] = await dbPromise.query(
      `SELECT gm.group_id AS group_id, u.id AS id, u.name AS name, gm.is_leader AS is_leader
       FROM project_group_members gm
       LEFT JOIN users u ON u.id = gm.student_id
       WHERE gm.group_id = ?
       ORDER BY gm.is_leader DESC, u.name ASC`,
      [groupId]
    );

    // Also resolve the group's assigned supervisor (project_groups.supervisor_id)
    // and industry mentor (project_groups.mentor_id) so the frontend can show
    // them alongside student members without a second round trip.
    const [groupRows] = await dbPromise.query(
      `SELECT pg.supervisor_id, su.name AS supervisor_name, pg.mentor_id, mu.name AS mentor_name
       FROM project_groups pg
       LEFT JOIN users su ON su.id = pg.supervisor_id
       LEFT JOIN users mu ON mu.id = pg.mentor_id
       WHERE pg.id = ?
       LIMIT 1`,
      [groupId]
    );
    const groupRow = groupRows[0] || {};
    const supervisor = groupRow.supervisor_id
      ? { id: groupRow.supervisor_id, name: groupRow.supervisor_name || 'Unknown Supervisor' }
      : null;
    const mentor = groupRow.mentor_id
      ? { id: groupRow.mentor_id, name: groupRow.mentor_name || 'Unknown Mentor' }
      : null;

    res.status(200).json({ success: true, data: members, supervisor, mentor });
  } catch (error) {
    console.error('❌ Error fetching group members:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch group members.' });
  }
};



/**
 * GET: Returns every user who can act as a supervisor for group requests —
 * either the legacy direct role ('supervisor') or a lecturer the admin has
 * designated as one (role='lecturer' AND designation='supervisor'). No
 * department/academic_unit filtering: a student may request any supervisor
 * regardless of the student's own department.
 */
const getSupervisors = async (req, res) => {
  try {
    // academic_unit added so the Schedule Panel evaluator picker
    // (CalendarPage.tsx) can group supervisors by department (IT/CM/ITM).
    const [results] = await dbPromise.query(
      `SELECT id, name, email, academic_unit FROM users
       WHERE role = 'supervisor' OR (role = 'lecturer' AND designation = 'supervisor')
       ORDER BY name ASC`
    );
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET: Students at a given level (same department as the requester) who are
 * NOT already an active member of a real, live group — used to populate the
 * "Add Group Members" picker so an already-grouped student can no longer be
 * selected into a second group.
 *
 * This is intentionally separate from getStudentsByLevel (userController.js),
 * which the coordinator's Group Management page still uses, unchanged — that
 * page needs to see every student regardless of group status, so its query
 * was left exactly as it was.
 */
const getAvailableMembersForLevel = async (req, res) => {
  const level = req.params.level;
  const studentId = req.query.studentId;

  if (!level) {
    return res.status(400).json({ error: 'Please provide an Academic Level.' });
  }

  try {
    let department = null;
    if (studentId) {
      const [requesterRows] = await dbPromise.query(
        `SELECT academic_unit FROM users WHERE id = ? AND role = 'student'`,
        [studentId]
      );
      if (requesterRows.length === 0) {
        return res.status(404).json({ error: 'Requesting student not found.' });
      }
      department = requesterRows[0].academic_unit;
    }

    const params = [level];
    let sql = `
      SELECT id, name, university_id, academic_unit AS department, level
      FROM users
      WHERE role = 'student' AND level = ?
        AND NOT EXISTS (
          SELECT 1 FROM project_group_members pm
          JOIN project_groups pg ON pg.id = pm.group_id
          WHERE pm.student_id = users.id AND pg.id IS NOT NULL
        )
    `;

    if (studentId) {
      sql += ` AND id != ?`;
      params.push(studentId);
      sql += ` AND academic_unit ${department === null ? 'IS NULL' : '= ?'}`;
      if (department !== null) params.push(department);
    }

    sql += ` ORDER BY name ASC`;

    const [results] = await dbPromise.query(sql, params);
    res.status(200).json(results);
  } catch (err) {
    console.error('Error fetching available members for level:', err);
    res.status(500).json({ error: 'Failed to fetch available members.' });
  }
};





/**
 * POST: Submits a new group request to one or more supervisors for approval.
 * Accepts `supervisor_ids` (array, preferred) or the legacy single
 * `supervisor_id` (kept for backward compatibility with any other caller).
 * If the student already has a fully-rejected request for this level, that
 * row is reused (reset to pending with a fresh supervisor list) instead of
 * inserting a new one — see getStudentRequestStatus for why this matters.
 */

const createGroupRequest = async (req, res) => {
  const { group_name, members_list, request_message, student_id, project_level, member_ids } = req.body;
  const supervisorIds = Array.isArray(req.body.supervisor_ids)
    ? req.body.supervisor_ids
    : req.body.supervisor_id
      ? [req.body.supervisor_id]
      : [];

  try {
    if (supervisorIds.length === 0) {
      return res.status(400).json({ error: 'At least one supervisor must be selected.' });
    }

    // Validate student exists and level matches the requested project_level
    const [userRows] = await dbPromise.query('SELECT id, level, academic_unit FROM users WHERE id = ?', [student_id]);
    if (userRows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const studentLevel = Number(userRows[0].level || 0);
    const studentDepartment = userRows[0].academic_unit;
    if (Number(project_level) !== studentLevel) {
      return res.status(403).json({ error: 'You can only create group requests for your own level' });
    }
    if (!studentDepartment) {
      return res.status(400).json({ error: 'Set your department/degree program on your profile before forming a group.' });
    }

    // Department/level consistency (requirement: reject if any selected
    // member is not in the same department and level as the requester)
    if (Array.isArray(member_ids) && member_ids.length > 0) {
      const [memberRows] = await dbPromise.query(
        `SELECT id, level, academic_unit FROM users WHERE id IN (?)`,
        [member_ids]
      );
      const foundIds = new Set(memberRows.map((m) => m.id));
      const missing = member_ids.filter((id) => !foundIds.has(Number(id)));
      if (missing.length > 0) {
        return res.status(400).json({ error: `Member(s) not found: ${missing.join(', ')}` });
      }
      const mismatched = memberRows.filter(
        (m) => Number(m.level) !== studentLevel || m.academic_unit !== studentDepartment
      );
      if (mismatched.length > 0) {
        return res.status(400).json({
          error: `All members must be in the same department (${studentDepartment}) and level (${studentLevel}) as you.`,
          invalid_member_ids: mismatched.map((m) => m.id),
        });
      }

      // NEW: reject if any selected member already belongs to a real, live
      // group. Mirrors the existing "already a member" check just below
      // this block, which only covers the requester themselves.
      const [membersAlreadyGrouped] = await dbPromise.query(
        `SELECT pm.student_id
         FROM project_group_members pm
         JOIN project_groups pg ON pg.id = pm.group_id
         WHERE pm.student_id IN (?)
           AND pg.id IS NOT NULL`,
        [member_ids]
      );
      if (membersAlreadyGrouped.length > 0) {
        return res.status(400).json({
          error: 'One or more selected members already belong to a group.',
          already_grouped_member_ids: membersAlreadyGrouped.map((m) => m.student_id),
        });
      }
    }

    // Prevent students who are already active group members from creating another request.
    // A deleted group should not leave a stale membership behind.
    const [existingMembership] = await dbPromise.query(
      `SELECT 1
       FROM project_group_members pm
       JOIN project_groups pg ON pg.id = pm.group_id
       WHERE pm.student_id = ?
         AND pg.id IS NOT NULL
       LIMIT 1`,
      [student_id]
    );
    if (existingMembership.length > 0) {
      return res.status(400).json({ error: 'You are already a member of a group' });
    }

    // Look for an existing request from this student at this level
    const [existingRequests] = await dbPromise.query(
      `SELECT request_id, status, is_group_created, created_group_id
       FROM group_requests
       WHERE student_id = ? AND project_level = ?
       ORDER BY created_at DESC LIMIT 1`,
      [student_id, project_level]
    );

    const conn = await dbPromise.getConnection();
    try {
      await conn.beginTransaction();
      let requestId;

      if (existingRequests.length > 0) {
        const previous = existingRequests[0];
        let hasLiveCreatedGroup = false;

        if (previous.created_group_id) {
          const [liveGroupRows] = await conn.query(
            `SELECT 1 FROM project_groups WHERE id = ? LIMIT 1`,
            [previous.created_group_id]
          );
          hasLiveCreatedGroup = liveGroupRows.length > 0;
        }

        // The UI sends ONE supervisor per "Request" button click (two
        // buttons total). A second call here — whether the first is still
        // 'pending' OR has already been 'approved' (single-supervisor
        // requests auto-approve, per approveRequestBySupervisor) — means
        // the student is requesting their SECOND supervisor slot, not
        // duplicating the first. As long as the request hasn't been
        // converted into a live group yet, append the new supervisor onto
        // the SAME request instead of falling through to the "stale
        // request" reuse path below, which would otherwise delete the
        // already-approved supervisor's row AND overwrite members_list with
        // whatever the client's (possibly stale/empty, e.g. after a page
        // reload) member selection currently holds.
        if (previous.status === 'pending' || (previous.status === 'approved' && !hasLiveCreatedGroup)) {
          const [existingSupRows] = await conn.query(
            `SELECT supervisor_id FROM group_request_supervisors WHERE request_id = ? FOR UPDATE`,
            [previous.request_id]
          );
          const alreadyTargeted = new Set(existingSupRows.map((r) => Number(r.supervisor_id)));
          const newSupervisorIds = [...new Set(supervisorIds.map(Number))].filter(
            (id) => !alreadyTargeted.has(id)
          );

          if (newSupervisorIds.length === 0) {
            await conn.rollback();
            conn.release();
            return res.status(400).json({ error: 'You have already sent a request to this supervisor.' });
          }
          if (alreadyTargeted.size + newSupervisorIds.length > 2) {
            await conn.rollback();
            conn.release();
            return res.status(400).json({ error: 'A maximum of 2 supervisors can be requested per group.' });
          }

          const newSupervisorRows = newSupervisorIds.map((id) => [previous.request_id, id, 'pending']);
          await conn.query(
            `INSERT INTO group_request_supervisors (request_id, supervisor_id, status) VALUES ?`,
            [newSupervisorRows]
          );

          // A newly-added, not-yet-approved supervisor means the request as
          // a whole is no longer fully approved until this one responds too
          // — demote it back to 'pending' (approveRequestBySupervisor will
          // re-promote to 'approved' once every targeted supervisor,
          // including this new one, has approved). Any earlier final-submit
          // is no longer valid either.
          if (previous.status === 'approved') {
            await conn.query(
              `UPDATE group_requests SET status = 'pending', is_final_submitted = FALSE WHERE request_id = ?`,
              [previous.request_id]
            );
          }

          await conn.commit();
          return res.status(201).json({
            message: 'Request Sent',
            groupId: previous.request_id,
            request_id: previous.request_id,
          });
        }

        const staleRequestState =
          previous.status === 'rejected' ||
          Number(previous.is_group_created || 0) === 0 ||
          !hasLiveCreatedGroup;

        if (!staleRequestState) {
          await conn.rollback();
          conn.release();
          return res.status(400).json({ error: `You already have a ${previous.status} request for this level.` });
        }

        // Reuse the stale request row after a rejection, a deleted group, or an old created flag.
        requestId = previous.request_id;
        await conn.query(
          `UPDATE group_requests
           SET group_name = ?, members_list = ?, request_message = ?, status = 'pending',
               rejection_reason = NULL, supervisor_id = NULL, is_final_submitted = FALSE,
               is_group_created = FALSE, created_group_id = NULL, processed_at = NOW()
           WHERE request_id = ?`,
          [group_name, members_list, request_message, requestId]
        );
        await conn.query(`DELETE FROM group_request_supervisors WHERE request_id = ?`, [requestId]);
      } else {
        const [result] = await conn.query(
          `INSERT INTO group_requests (group_name, members_list, request_message, student_id, supervisor_id, project_level, status, created_at)
           VALUES (?, ?, ?, ?, NULL, ?, 'pending', NOW())`,
          [group_name, members_list, request_message, student_id, project_level]
        );
        requestId = result.insertId;
      }

      if (supervisorIds.length > 2) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'A maximum of 2 supervisors can be requested per group.' });
      }

      const supervisorRows = [...new Set(supervisorIds.map(Number))].map((id) => [requestId, id, 'pending']);
      await conn.query(
        `INSERT INTO group_request_supervisors (request_id, supervisor_id, status) VALUES ?`,
        [supervisorRows]
      );

      await conn.commit();
      res.status(201).json({ message: 'Request Sent', groupId: requestId, request_id: requestId });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('❌ Error in createGroupRequest:', err);
    res.status(500).json({ error: err.message });
  }
};






/**
 * POST: Finalizes a supervisor-approved request for Coordinator review
 */
const finalSubmitRequest = async (req, res) => {
  const { request_id } = req.body;
  try {
    const sql = `UPDATE group_requests SET is_final_submitted = TRUE WHERE request_id = ? AND status = 'approved'`;
    const [result] = await dbPromise.query(sql, [request_id]);
    if (result.affectedRows === 0) {
      return res.status(400).json({ error: "Cannot finalize. Ensure supervisor has approved the request." });
    }
    res.json({ success: true, message: "Submitted to Coordinator" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};





/**
 * GET: Checks the status of group requests where the student is either the leader or a member
 */

const getStudentRequestStatus = async (req, res) => {
  const { studentId } = req.params;
  // Additive, opt-in only: by default this endpoint hides a request once it
  // has been converted into a real, live group (see the AND clause below) —
  // GroupRequest.tsx relies on that to stop treating a finished request as
  // "still pending". StudentAnnouncementsPage.tsx needs the opposite: it
  // reads this same endpoint just to find which supervisor(s) a student has
  // approved, and that's still true (and still needed) after the group is
  // created. `includeCreated=true` skips that exclusion; omitting it (as
  // GroupRequest.tsx does) leaves the existing behavior completely unchanged.
  const includeCreated = req.query.includeCreated === 'true';
  try {
    // 1. Get the student's university_id to check if they are a member (not just the leader)
    const [userRows] = await dbPromise.query(
      'SELECT university_id FROM users WHERE id = ?',
      [studentId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const universityId = userRows[0].university_id;

    // Resubmission after rejection reuses the same request_id (see
    // createGroupRequest), but historical rows created before that behavior
    // existed can still have multiple rows per (student, level). Dedupe to
    // the single latest row per project_level so the frontend never shows
    // stale duplicates alongside the current one.
    const whereClause = universityId
      ? `WHERE student_id = ? OR (members_list REGEXP CONCAT('\\\\(', ?, '\\\\)'))`
      : `WHERE student_id = ?`;
    const whereParams = universityId ? [studentId, universityId] : [studentId];

    await ensureRequestLifecycleColumns();

    const liveGroupExclusion = includeCreated
      ? ''
      : `AND (COALESCE(is_group_created, 0) = 0 OR created_group_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM project_groups pg WHERE pg.id = ranked.created_group_id
         ))`;

    const [results] = await dbPromise.query(
      `SELECT * FROM (
         SELECT gr.*, ROW_NUMBER() OVER (PARTITION BY gr.project_level ORDER BY gr.created_at DESC, gr.request_id DESC) AS rn
         FROM group_requests gr
         ${whereClause}
       ) ranked
       WHERE rn = 1
         ${liveGroupExclusion}
       ORDER BY created_at DESC`,
      whereParams
    );

    // Attach each request's per-supervisor responses so the UI can show
    // which supervisors are still pending vs. rejected, if it chooses to.
    const requestIds = results.map((r) => r.request_id);
    let supervisorsByRequest = {};
    if (requestIds.length > 0) {
      const [supRows] = await dbPromise.query(
        `SELECT grs.request_id, grs.supervisor_id, grs.status, grs.rejection_reason, u.name AS supervisor_name
         FROM group_request_supervisors grs
         LEFT JOIN users u ON u.id = grs.supervisor_id
         WHERE grs.request_id IN (?)
         ORDER BY grs.id ASC`,
        [requestIds]
      );
      supervisorsByRequest = supRows.reduce((acc, row) => {
        (acc[row.request_id] = acc[row.request_id] || []).push(row);
        return acc;
      }, {});
    }

    const data = results.map((r) => ({ ...r, supervisor_responses: supervisorsByRequest[r.request_id] || [] }));
    res.json(data);
  } catch (err) {
    console.error('❌ Error in getStudentRequestStatus:', err);
    res.status(500).json({ error: err.message });
  }
};


// Supervisor approves a request: create the actual group and members
const approveGroupRequest = async (req, res) => {
  const requestId = req.params.requestId;
  const userId = req.headers['x-user-id'];
  const userRole = req.headers['x-user-role'];

  try {
    const [rows] = await dbPromise.query('SELECT * FROM group_requests WHERE request_id = ?', [requestId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const request = rows[0];

    // Only the assigned supervisor (or admin) may approve
    if (userRole !== 'supervisor' && userRole !== 'admin') {
      return res.status(403).json({ error: 'Only supervisor or admin can approve requests' });
    }
    if (userRole === 'supervisor' && String(userId) !== String(request.supervisor_id)) {
      return res.status(403).json({ error: 'You are not the assigned supervisor for this request' });
    }

    // Prevent approving if already processed
    if (request.status === 'approved') return res.status(400).json({ error: 'Request already approved' });
    if (request.status === 'rejected') return res.status(400).json({ error: 'Request already rejected' });

    // Parse members list to find student university ids and resolve to user ids
    const indexes = extractMemberIndexes(request.members_list || '');
    const normalizedLevel = Number(request.project_level || 0);
    let resolvedMembers = [];
    if (indexes.length > 0 && normalizedLevel > 0) {
      const [memberRows] = await dbPromise.query(
        `SELECT id, name, university_id FROM users WHERE role = 'student' AND level = ? AND university_id IN (?)`,
        [normalizedLevel, indexes]
      );
      resolvedMembers = memberRows.map(r => r.id);
    }

    // Ensure leader is included (leader is the student who submitted the request)
    const leaderId = request.student_id;
    if (!resolvedMembers.includes(leaderId)) resolvedMembers.unshift(leaderId);

    if (resolvedMembers.length === 0) {
      return res.status(400).json({ error: 'No valid student members found to form the group' });
    }

    // Create group and members within a transaction
    const conn = await dbPromise.getConnection();
    try {
      await conn.beginTransaction();
      const [groupInsert] = await conn.query(
        `INSERT INTO project_groups (group_name, level, supervisor_id, created_by, created_at) VALUES (?, ?, ?, ?, NOW())`,
        [request.group_name, normalizedLevel, request.supervisor_id || null, request.student_id]
      );
      const groupId = groupInsert.insertId;

      const memberRows = resolvedMembers.map(id => [groupId, id, id === leaderId ? 1 : 0]);
      await conn.query(
        `INSERT INTO project_group_members (group_id, student_id, is_leader) VALUES ?`,
        [memberRows]
      );

      await conn.query(
        `UPDATE group_requests
         SET status = 'approved',
             is_group_created = TRUE,
             created_group_id = ?,
             processed_at = NOW()
         WHERE request_id = ?`,
        [groupId, requestId]
      );
      await conn.commit();
      return res.json({ success: true, message: 'Request approved and group created', groupId });
    } catch (err) {
      await conn.rollback();
      console.error('❌ Error creating group during approval:', err);
      return res.status(500).json({ error: 'Failed to create group' });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('❌ approveGroupRequest error:', err);
    return res.status(500).json({ error: err.message });
  }
};


// Supervisor rejects a request with a reason
const rejectGroupRequest = async (req, res) => {
  const requestId = req.params.requestId;
  const { reason } = req.body;
  const userId = req.headers['x-user-id'];
  const userRole = req.headers['x-user-role'];

  try {
    const [rows] = await dbPromise.query('SELECT * FROM group_requests WHERE request_id = ?', [requestId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const request = rows[0];

    if (userRole !== 'supervisor' && userRole !== 'admin') {
      return res.status(403).json({ error: 'Only supervisor or admin can reject requests' });
    }
    if (userRole === 'supervisor' && String(userId) !== String(request.supervisor_id)) {
      return res.status(403).json({ error: 'You are not the assigned supervisor for this request' });
    }

    if (request.status === 'approved') return res.status(400).json({ error: 'Request already approved' });
    if (request.status === 'rejected') return res.status(400).json({ error: 'Request already rejected' });

    await dbPromise.query(`UPDATE group_requests SET status = 'rejected', rejection_reason = ?, processed_at = NOW() WHERE request_id = ?`, [reason || null, requestId]);
    return res.json({ success: true, message: 'Request rejected' });
  } catch (err) {
    console.error('❌ rejectGroupRequest error:', err);
    return res.status(500).json({ error: err.message });
  }
};


// ---------------------------------------------------------------------------
// MULTI-SUPERVISOR APPROVAL WORKFLOW
// A request targets one or two supervisors (group_request_supervisors).
// group_requests.status is a derived overall status:
//   pending  — while any targeted supervisor is still pending
//   approved — only once EVERY targeted supervisor has approved (this is
//              what unlocks "Submit to Coordinator" on the student side)
//   rejected — as soon as ANY targeted supervisor rejects (their reason is
//              copied up; every other still-pending supervisor is
//              cancelled, since approval by all is no longer reachable)
// ---------------------------------------------------------------------------

/**
 * GET: Pending requests targeted at a specific supervisor, joined with
 * student/group info. Matches the shape SupervisorApprovalPage.tsx expects.
 */
const getPendingRequestsForSupervisor = async (req, res) => {
  const supervisorId = req.params.supervisorId;
  try {
    await ensureRequestLifecycleColumns();

    const [rows] = await dbPromise.query(
      `SELECT gr.request_id, gr.group_name, gr.members_list, gr.request_message,
              gr.project_level, gr.student_id, gr.created_at,
              grs.id AS grs_id, grs.status AS my_status,
              student.name AS student_name, student.university_id, student.academic_unit AS department,
              supervisor.name AS supervisor_name
       FROM group_request_supervisors grs
       JOIN group_requests gr ON gr.request_id = grs.request_id
       LEFT JOIN users student ON student.id = gr.student_id
       LEFT JOIN users supervisor ON supervisor.id = grs.supervisor_id
       WHERE grs.supervisor_id = ?
         AND grs.status = 'pending'
         AND (COALESCE(gr.is_group_created, 0) = 0 OR gr.created_group_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM project_groups pg WHERE pg.id = gr.created_group_id
         ))
       ORDER BY gr.created_at DESC`,
      [supervisorId]
    );

    const data = rows.map((row) => ({
      request_id: row.request_id,
      project_name: extractProjectName(row.request_message),
      group_name: row.group_name,
      group_leader: extractLeaderName(row.members_list) || row.student_name,
      members_list: row.members_list,
      request_message: row.request_message,
      student_name: row.student_name,
      department: row.department,
      project_level: row.project_level,
      supervisor_id: supervisorId,
      supervisor_name: row.supervisor_name,
      created_at: row.created_at,
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('❌ getPendingRequestsForSupervisor error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * PUT: A supervisor approves the request that was sent to them.
 * Only flips group_requests.status to 'approved' (unlocking "Submit to
 * Coordinator") once EVERY supervisor targeted on this request has
 * approved — previously the FIRST "yes" approved the whole request and
 * cancelled every other still-pending supervisor.
 */
const approveRequestBySupervisor = async (req, res) => {
  const requestId = req.body.request_id;
  const supervisorId = req.body.supervisor_id ?? req.body.approved_by;

  if (!requestId || !supervisorId) {
    return res.status(400).json({ error: 'request_id and supervisor_id are required.' });
  }

  const conn = await dbPromise.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM group_request_supervisors WHERE request_id = ? AND supervisor_id = ? FOR UPDATE`,
      [requestId, supervisorId]
    );
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'This request was not sent to you.' });
    }
    if (rows[0].status !== 'pending') {
      await conn.rollback();
      return res.status(400).json({ error: `This request is already ${rows[0].status} by you.` });
    }

    await conn.query(
      `UPDATE group_request_supervisors SET status = 'approved', responded_at = NOW() WHERE id = ?`,
      [rows[0].id]
    );

    // Check every supervisor targeted on this request, not just this one.
    const [allRows] = await conn.query(
      `SELECT status FROM group_request_supervisors WHERE request_id = ?`,
      [requestId]
    );
    const allApproved = allRows.length > 0 && allRows.every((r) => r.status === 'approved');

    if (allApproved) {
      await conn.query(
        `UPDATE group_requests SET status = 'approved', processed_at = NOW() WHERE request_id = ?`,
        [requestId]
      );
    }
    // else: leave group_requests.status as 'pending' — still waiting on the
    // other supervisor(s) targeted on this request.

    await conn.commit();
    res.json({
      success: true,
      message: allApproved
        ? 'Request approved.'
        : 'Approved. Waiting for the other supervisor to respond.',
    });
  } catch (err) {
    await conn.rollback();
    console.error('❌ approveRequestBySupervisor error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};

/**
 * PUT: A supervisor rejects the request that was sent to them.
 * The overall group_requests.status only flips to 'rejected' once every
 * targeted supervisor has rejected — otherwise it stays 'pending' while the
 * remaining supervisors decide.
 */
/**
 * PUT: A supervisor rejects the request that was sent to them.
 * Because every targeted supervisor must approve for the request to move
 * forward, a single rejection makes that outcome impossible — so the whole
 * request is failed immediately (any other still-pending supervisor row is
 * cancelled) instead of waiting for every supervisor to reject.
 */
const rejectRequestBySupervisor = async (req, res) => {
  const requestId = req.body.request_id;
  const supervisorId = req.body.supervisor_id ?? req.body.rejected_by;
  const reason = req.body.rejection_reason ?? req.body.reason ?? req.body.reject_reason ?? null;

  if (!requestId || !supervisorId) {
    return res.status(400).json({ error: 'request_id and supervisor_id are required.' });
  }

  const conn = await dbPromise.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM group_request_supervisors WHERE request_id = ? AND supervisor_id = ? FOR UPDATE`,
      [requestId, supervisorId]
    );
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'This request was not sent to you.' });
    }
    if (rows[0].status !== 'pending') {
      await conn.rollback();
      return res.status(400).json({ error: `This request is already ${rows[0].status} by you.` });
    }

    await conn.query(
      `UPDATE group_request_supervisors SET status = 'rejected', rejection_reason = ?, responded_at = NOW() WHERE id = ?`,
      [reason, rows[0].id]
    );

    await conn.query(
      `UPDATE group_requests SET status = 'rejected', rejection_reason = ?, processed_at = NOW() WHERE request_id = ?`,
      [reason, requestId]
    );
    await conn.query(
      `UPDATE group_request_supervisors SET status = 'cancelled', responded_at = NOW() WHERE request_id = ? AND status = 'pending'`,
      [requestId]
    );

    await conn.commit();
    res.json({ success: true, message: 'Request rejected.' });
  } catch (err) {
    await conn.rollback();
    console.error('❌ rejectRequestBySupervisor error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};

module.exports = {
  getGroupsByLevel,
  getStudentGroup,
  createGroup,
  getCoordinatorApprovedRequests,
  updateGroup,
  deleteGroup,
  getCoordinatorGroups,
  getGroupMembers,
  getSupervisors,
  getAvailableMembersForLevel,
  createGroupRequest,
  finalSubmitRequest,
  approveGroupRequest,
  rejectGroupRequest,
  getStudentRequestStatus,
  getPendingRequestsForSupervisor,
  approveRequestBySupervisor,
  rejectRequestBySupervisor,
};
