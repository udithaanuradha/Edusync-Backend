 const db = require('../config/db');
const dbPromise = db.promise();

let ensureMembersTablePromise = null;

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

// --- HELPER FUNCTIONS (PRESERVED) ---
const extractProjectName = (requestMessage) => {
  const text = String(requestMessage || '');
  const match = text.match(/Project:\s*([^\n.]+)/i);
  return match ? match[1].trim() : 'Untitled Project';
};

const extractLeaderName = (membersList) => {
  const text = String(membersList || '');
  const match = text.match(/Leader:\s*([^,\n]+)/i);
  return match ? match[1].trim() : 'Not provided';
};

const extractMemberIndexes = (membersList) => {
  const text = String(membersList || '');
  const matches = text.match(/\b\d{5,8}[A-Za-z]?\b/g) || [];
  return [...new Set(matches.map((item) => item.toUpperCase()))].slice(0, 5);
};

const extractMemberNames = (membersList) => {
  const text = String(membersList || '');
  const normalized = text.replace(/\bLeader:\s*/gi, '').replace(/\bMembers?:\s*/gi, '');
  const tokens = normalized.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)
    .map((item) => item.split('-')[0].trim())
    .filter((item) => /[A-Za-z]/.test(item) && item.length >= 3);
  return [...new Set(tokens)].slice(0, 5);
};

// --- CONTROLLER FUNCTIONS ---

const getGroupsByLevel = async (req, res) => {
  const level = Number(req.params.level);
  console.log(`🔍 Fetching ALL groups for Level: ${level}`);
  
  try {
    await ensureGroupMembersTable();

    // 1. Get the Groups
    const [groups] = await dbPromise.query(
      `SELECT pg.id AS groupId, pg.group_name AS groupName, u.name AS supervisor
       FROM project_groups pg
       LEFT JOIN users u ON u.id = pg.supervisor_id
       WHERE pg.level = ?
       ORDER BY pg.id DESC`,
      [level]
    );

    console.log(`📊 Found ${groups.length} groups for Level ${level}.`);

    if (!groups.length) {
      return res.json([]); // Return empty array if no groups
    }

    const groupIds = groups.map((g) => g.groupId);

    // 2. Get all members for these groups with more details
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
        supervisor: group.supervisor || 'Not Assigned',
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

const getStudentGroup = async (req, res) => {
  const studentId = req.params.studentId;
  const level = req.params.level ? Number(req.params.level) : null;
  
  console.log(`🔍 Fetching group for Student ID: ${studentId}, Level: ${level}`);

  try {
    await ensureGroupMembersTable();

    // 1. Find the group(s) this student belongs to at the specified level
    // We use a more flexible query to handle potential column casing (e.g. student_Id vs student_id)
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

const getCoordinatorApprovedRequests = async (req, res) => {
  const rawLevel = req.query.level;
  const level = rawLevel === undefined ? null : Number(rawLevel);
  const finalOnly = String(req.query.finalOnly || '0') === '1' ? 1 : 0;

  try {
    const [rows] = await dbPromise.query(
      `SELECT gr.*, student.name AS student_name, student.level AS student_level, supervisor.name AS supervisor_name
       FROM group_requests gr
       LEFT JOIN users student ON student.id = gr.student_id
       LEFT JOIN users supervisor ON supervisor.id = gr.supervisor_id
       WHERE gr.status = 'approved'
         AND (? = 0 OR COALESCE(gr.is_final_submitted, 0) = 1)
         AND (? IS NULL OR COALESCE(gr.project_level, student.level) = ?)
       ORDER BY gr.created_at DESC`,
      [finalOnly, level, level]
    );

    const data = await Promise.all(rows.map(async (row) => {
      const normalizedLevel = Number(row.project_level ?? row.student_level ?? 0);
      const indexes = extractMemberIndexes(row.members_list);
      let resolvedMembers = [];

      if (indexes.length > 0 && normalizedLevel > 0) {
        const [memberRows] = await dbPromise.query(
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
  const { groupName, level, supervisorId, leaderId, memberIds, createdBy } = req.body;
  let connection;
  try {
    await ensureGroupMembersTable();
    connection = await dbPromise.getConnection();
    await connection.beginTransaction();

    const [groupInsert] = await connection.query(
      `INSERT INTO project_groups (group_name, level, supervisor_id, created_by) VALUES (?, ?, ?, ?)`,
      [groupName, level, supervisorId || null, createdBy]
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
  }
};

const updateGroup = async (req, res) => {
  const groupId = req.params.id;
  const { groupName, level, supervisorId } = req.body;
  try {
    await dbPromise.query(
      `UPDATE project_groups SET group_name = ?, level = ?, supervisor_id = ? WHERE id = ?`,
      [groupName, level, supervisorId || null, groupId]
    );
    res.json({ success: true, message: 'Group updated.' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Update failed.' });
  }
};

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

const getCoordinatorGroups = async (req, res) => {
  const coordinatorId = req.params.coordinatorId;
  const level = Number(req.params.level);
  console.log(`🔍 Fetching groups created by Coordinator ${coordinatorId} for Level: ${level}`);
  
  try {
    await ensureGroupMembersTable();

    // 1. Get the Groups created by this coordinator at this level
    const [groups] = await dbPromise.query(
      `SELECT pg.id AS groupId, pg.group_name AS groupName, u.name AS supervisor
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

    // 2. Get all members for these groups
    const [members] = await dbPromise.query(
      `SELECT gm.group_id, u.name, gm.is_leader
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
        .map((m) => m.name || "Unknown Student");

      const leader = members.find(
        (m) => m.group_id === group.groupId && Number(m.is_leader) === 1
      );

      return {
        groupId: group.groupId,
        groupName: group.groupName,
        supervisor: group.supervisor || 'Not Assigned',
        leader: leader ? leader.name : (groupMembers[0] || 'Not Assigned'),
        members: groupMembers // This is the array for .join(', ')
      };
    });

    // CRITICAL: Send only the array so frontend can use .map()
    return res.json(formattedData);

  } catch (error) {
    console.error('❌ Get Coordinator Groups Backend Error:', error);
    return res.status(500).json({ error: 'Failed to fetch coordinator groups' });
  }
};

const getGroupMembers = async (req, res) => {
  const groupId = req.params.groupId;
  const userId = req.headers['x-user-id'];
  const userRole = req.headers['x-user-role'];

  console.log(`🔍 Fetching members for Group ID: ${groupId}`);
  
  try {
    await ensureGroupMembersTable();

    // Access Control
    if (userId && userRole === 'student') {
      const [membership] = await dbPromise.query(
        'SELECT 1 FROM project_group_members WHERE student_id = ? AND group_id = ?',
        [userId, groupId]
      );
      if (membership.length === 0) {
        return res.status(403).json({ success: false, error: 'Access denied. You are not a member of this group.' });
      }
    }

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

const getSupervisors = async (req, res) => {
  try {
    const [results] = await dbPromise.query("SELECT id, name FROM users WHERE role = 'supervisor' ORDER BY name ASC");
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const createGroupRequest = async (req, res) => {
  const { group_name, members_list, request_message, student_id, supervisor_id, project_level } = req.body;
  try {
    const sql = `INSERT INTO group_requests (group_name, members_list, request_message, student_id, supervisor_id, project_level) 
                 VALUES (?, ?, ?, ?, ?, ?)`;
    const [result] = await dbPromise.query(sql, [group_name, members_list, request_message, student_id, supervisor_id, project_level]);
    res.status(201).json({ message: "Request Sent", groupId: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

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

const getStudentRequestStatus = async (req, res) => {
  const { studentId } = req.params;
  try {
    const [results] = await dbPromise.query(
      `SELECT * FROM group_requests WHERE student_id = ? ORDER BY created_at DESC`,
      [studentId]
    );
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  getStudentRequestStatus
};