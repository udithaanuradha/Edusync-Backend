const db = require('../config/db');
const dbPromise = db.promise();

let ensureMembersTablePromise = null;


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

    // 1. Get the Groups - filter by coordinator if provided
    let groupQuery = `SELECT pg.id AS groupId, pg.group_name AS groupName, u.name AS supervisor,pg.mentor_id AS mentorId
                     FROM project_groups pg
                     LEFT JOIN users u ON u.id = pg.supervisor_id
                     WHERE pg.level = ?`;
    let params = [level];
    
    if (coordinatorId) {
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



    //Fetch detailed user info for all students in those groups
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
          is_leader: m.is_leader
        }));

      const leader = groupMembers.find(
        (m) => Number(m.is_leader) === 1
      );

      return {
        groupId: group.groupId,
        groupName: group.groupName,
        department: group.department,
        supervisor: group.supervisor || 'Not Assigned',
        mentorId: group.mentorId,
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
      `SELECT pg.id AS groupId, pg.group_name AS groupName, u.name AS supervisor, pg.level
       FROM project_groups pg
       JOIN project_group_members gm ON pg.id = gm.group_id
       LEFT JOIN users u ON u.id = pg.supervisor_id
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

  try {
    // Build the WHERE clause dynamically
    let whereCondition = `gr.status = 'approved'
         AND (? = 0 OR COALESCE(gr.is_final_submitted, 0) = 1)
         AND (? IS NULL OR COALESCE(gr.project_level, student.level) = ?)`;
    let params = [finalOnly, level, level];

    const [rows] = await dbPromise.query(
      `SELECT gr.*, student.name AS student_name, student.level AS student_level,
              student.academic_unit AS department, supervisor.name AS supervisor_name
       FROM group_requests gr
       LEFT JOIN users student ON student.id = gr.student_id
       LEFT JOIN users supervisor ON supervisor.id = gr.supervisor_id
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

      return {
        request_id: row.request_id,
        project_name: extractProjectName(row.request_message),
        group_name: row.group_name,
        group_leader: extractLeaderName(row.members_list),
        supervisor_name: row.supervisor_name || 'Not assigned',
        supervisor_id: row.supervisor_id,
        department: row.department,
        resolved_members: resolvedMembers,
        created_at: row.created_at
      };
    }));

    return res.json({ success: true, data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: 'Failed to load requests.' });
  }
};

const createGroup = async (req, res) => {
  const {
    groupName,
    level,
    supervisorId,
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
    connection = await dbPromise.getConnection();
    await connection.beginTransaction();

    // Department isn't always known by the caller — resolve it from the
    // group leader's own department (academic_unit) when not supplied.
    let resolvedDepartment = department || null;
    if (!resolvedDepartment && leaderId) {
      const [leaderRows] = await connection.query('SELECT academic_unit FROM users WHERE id = ?', [leaderId]);
      resolvedDepartment = leaderRows[0]?.academic_unit || null;
    }

    const [groupInsert] = await connection.query(
      `INSERT INTO project_groups (group_name, level, supervisor_id, created_by, department) VALUES (?, ?, ?, ?, ?)`,
      [groupName, level, supervisorId || null, coordinatorId, resolvedDepartment]
    );

    const groupId = groupInsert.insertId;
    const memberRows = memberIds.map((id) => [groupId, id, id === leaderId ? 1 : 0]);

    await connection.query(
      `INSERT INTO project_group_members (group_id, student_id, is_leader) VALUES ?`,
      [memberRows]
    );

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
  const { groupName, level, supervisorId, department } = req.body;
  try {
    if (department !== undefined) {
      await dbPromise.query(
        `UPDATE project_groups SET group_name = ?, level = ?, supervisor_id = ?, department = ? WHERE id = ?`,
        [groupName, level, supervisorId || null, department || null, groupId]
      );
    } else {
      await dbPromise.query(
        `UPDATE project_groups SET group_name = ?, level = ?, supervisor_id = ? WHERE id = ?`,
        [groupName, level, supervisorId || null, groupId]
      );
    }
    res.json({ success: true, message: 'Group updated.' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Update failed.' });
  }
};




//delete group details and members 
const deleteGroup = async (req, res) => {
  const groupId = req.params.id;
  try {
    await dbPromise.query(`DELETE FROM project_group_members WHERE group_id = ?`, [groupId]);
    await dbPromise.query(`DELETE FROM project_groups WHERE id = ?`, [groupId]);
    res.json({ success: true, message: 'Deleted.' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Delete failed.' });
  }
};



//Fetches all groups managed by a specific coordinator

const getCoordinatorGroups = async (req, res) => {
  const coordinatorId = req.params.coordinatorId;
  const level = Number(req.params.level);
  console.log(`🔍 Fetching groups created by Coordinator ${coordinatorId} for Level: ${level}`);
  
  try {
    await ensureGroupMembersTable();

    // 1. Get the Groups created by this coordinator at this level
    const [groups] = await dbPromise.query(
      `SELECT pg.id AS groupId, pg.group_name AS groupName, pg.department AS department, u.name AS supervisor
       FROM project_groups pg
       LEFT JOIN users u ON u.id = pg.supervisor_id
       WHERE pg.created_by = ? AND pg.level = ?
       ORDER BY pg.id DESC`,
      [coordinatorId, level]
    );

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

    res.status(200).json({ success: true, data: members });
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
    const [results] = await dbPromise.query(
      `SELECT id, name FROM users
       WHERE role = 'supervisor' OR (role = 'lecturer' AND designation = 'supervisor')
       ORDER BY name ASC`
    );
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    }

    // Prevent students who are already group members from creating another request
    const [existingMembership] = await dbPromise.query(
      'SELECT 1 FROM project_group_members WHERE student_id = ? LIMIT 1',
      [student_id]
    );
    if (existingMembership.length > 0) {
      return res.status(400).json({ error: 'You are already a member of a group' });
    }

    // Look for an existing request from this student at this level
    const [existingRequests] = await dbPromise.query(
      `SELECT request_id, status FROM group_requests WHERE student_id = ? AND project_level = ? ORDER BY created_at DESC LIMIT 1`,
      [student_id, project_level]
    );

    const conn = await dbPromise.getConnection();
    try {
      await conn.beginTransaction();
      let requestId;

      if (existingRequests.length > 0 && existingRequests[0].status !== 'rejected') {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: `You already have a ${existingRequests[0].status} request for this level.` });
      }

      if (existingRequests.length > 0) {
        // Reuse the rejected row: reset it and replace its supervisor targets.
        requestId = existingRequests[0].request_id;
        await conn.query(
          `UPDATE group_requests
           SET group_name = ?, members_list = ?, request_message = ?, status = 'pending',
               rejection_reason = NULL, supervisor_id = NULL, is_final_submitted = FALSE
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

    const [results] = await dbPromise.query(
      `SELECT * FROM (
         SELECT gr.*, ROW_NUMBER() OVER (PARTITION BY gr.project_level ORDER BY gr.created_at DESC, gr.request_id DESC) AS rn
         FROM group_requests gr
         ${whereClause}
       ) ranked
       WHERE rn = 1
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
         WHERE grs.request_id IN (?)`,
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

      await conn.query(`UPDATE group_requests SET status = 'approved', processed_at = NOW() WHERE request_id = ?`, [requestId]);
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
// A request now targets one-or-more supervisors (group_request_supervisors).
// group_requests.status is a derived overall status:
//   pending  — while any child row is pending and none is approved
//   approved — as soon as ONE supervisor approves (their id is recorded on
//              group_requests.supervisor_id; every other still-pending
//              child row is cancelled)
//   rejected — only once ALL targeted supervisors have rejected
// ---------------------------------------------------------------------------

/**
 * GET: Pending requests targeted at a specific supervisor, joined with
 * student/group info. Matches the shape SupervisorApprovalPage.tsx expects.
 */
const getPendingRequestsForSupervisor = async (req, res) => {
  const supervisorId = req.params.supervisorId;
  try {
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
       WHERE grs.supervisor_id = ? AND grs.status = 'pending'
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
 * Cascades: this supervisor's row -> 'approved'; group_requests -> 'approved'
 * with supervisor_id set to this supervisor; every other still-pending
 * targeted supervisor's row -> 'cancelled'.
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
    await conn.query(
      `UPDATE group_requests SET status = 'approved', supervisor_id = ?, processed_at = NOW() WHERE request_id = ?`,
      [supervisorId, requestId]
    );
    await conn.query(
      `UPDATE group_request_supervisors SET status = 'cancelled', responded_at = NOW() WHERE request_id = ? AND status = 'pending'`,
      [requestId]
    );

    await conn.commit();
    res.json({ success: true, message: 'Request approved.' });
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

    const [remaining] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM group_request_supervisors WHERE request_id = ? AND status = 'pending'`,
      [requestId]
    );

    if (Number(remaining[0].cnt) === 0) {
      // Every targeted supervisor has now rejected — surface this reason to the student.
      await conn.query(
        `UPDATE group_requests SET status = 'rejected', rejection_reason = ?, processed_at = NOW() WHERE request_id = ?`,
        [reason, requestId]
      );
    }

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
  createGroupRequest,
  finalSubmitRequest,
  approveGroupRequest,
  rejectGroupRequest,
  getStudentRequestStatus,
  getPendingRequestsForSupervisor,
  approveRequestBySupervisor,
  rejectRequestBySupervisor,
};
