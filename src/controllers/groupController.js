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
  const normalized = text
    .replace(/\bLeader:\s*/gi, '')
    .replace(/\bMembers?:\s*/gi, '');

  const tokens = normalized
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.split('-')[0].trim())
    .filter((item) => /[A-Za-z]/.test(item) && item.length >= 3);

  return [...new Set(tokens)].slice(0, 5);
};

const getCoordinatorApprovedRequests = async (req, res) => {
  const rawLevel = req.query.level;
  const level = rawLevel === undefined ? null : Number(rawLevel);
  const finalOnly = String(req.query.finalOnly || '0') === '1' ? 1 : 0;

  if (rawLevel !== undefined && (!Number.isInteger(level) || level < 1 || level > 4)) {
    return res.status(400).json({ success: false, error: 'level must be between 1 and 4.' });
  }

  try {
    const [rows] = await dbPromise.query(
      `SELECT
        gr.request_id,
        gr.group_name,
        gr.members_list,
        gr.request_message,
        gr.project_level,
        gr.student_id,
        gr.supervisor_id,
        gr.status,
        gr.is_final_submitted,
        gr.created_at,
        student.name AS student_name,
        student.level AS student_level,
        supervisor.name AS supervisor_name
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
      if (indexes.length > 0 && Number.isInteger(normalizedLevel) && normalizedLevel > 0) {
        const [memberRows] = await dbPromise.query(
          `SELECT id, name, university_id, email, level
           FROM users
           WHERE role = 'student' AND level = ? AND university_id IN (?)
           ORDER BY name ASC`,
          [normalizedLevel, indexes]
        );
        resolvedMembers = memberRows;
      }

      if (resolvedMembers.length === 0 && Number.isInteger(normalizedLevel) && normalizedLevel > 0) {
        const names = extractMemberNames(row.members_list);
        if (names.length > 0) {
          const [memberRowsByName] = await dbPromise.query(
            `SELECT id, name, university_id, email, level
             FROM users
             WHERE role = 'student' AND level = ? AND name IN (?)
             ORDER BY name ASC`,
            [normalizedLevel, names]
          );
          resolvedMembers = memberRowsByName;
        }
      }

      if (Number.isInteger(normalizedLevel) && normalizedLevel > 0 && Number(row.student_id) > 0) {
        const [requesterRows] = await dbPromise.query(
          `SELECT id, name, university_id, email, level
           FROM users
           WHERE id = ? AND role = 'student' AND level = ?
           LIMIT 1`,
          [row.student_id, normalizedLevel]
        );

        if (requesterRows.length > 0) {
          const requester = requesterRows[0];
          if (!resolvedMembers.some((member) => member.id === requester.id)) {
            resolvedMembers = [requester, ...resolvedMembers].slice(0, 5);
          }
        }
      }

      return {
        request_id: row.request_id,
        project_name: extractProjectName(row.request_message),
        group_name: row.group_name,
        group_leader: extractLeaderName(row.members_list),
        members_list: row.members_list,
        request_message: row.request_message,
        project_level: row.project_level ?? row.student_level,
        supervisor_name: row.supervisor_name || 'Not assigned',
        supervisor_id: row.supervisor_id,
        student_name: row.student_name || 'Student',
        student_id: row.student_id,
        created_at: row.created_at,
        resolved_members: resolvedMembers,
      };
    }));

    return res.json({ success: true, data });
  } catch (error) {
    console.error('Coordinator Approved Requests Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load approved requests.' });
  }
};

const getGroupsByLevel = async (req, res) => {
  const level = Number(req.params.level);
  if (!Number.isInteger(level) || level < 1) {
    return res.status(400).json({ success: false, error: 'Invalid level.' });
  }

  try {
    await ensureGroupMembersTable();

    const [groups] = await dbPromise.query(
      `SELECT
        pg.id AS group_id,
        pg.group_name,
        pg.level,
        pg.supervisor_id,
        u.name AS supervisor_name
      FROM project_groups pg
      LEFT JOIN users u ON u.id = pg.supervisor_id
      WHERE pg.level = ?
      ORDER BY pg.id DESC`,
      [level]
    );

    if (!groups.length) {
      return res.json({ success: true, data: [] });
    }

    const groupIds = groups.map((g) => g.group_id);
    const [members] = await dbPromise.query(
      `SELECT
        gm.group_id,
        gm.student_id,
        gm.is_leader,
        u.name,
        u.university_id
      FROM project_group_members gm
      INNER JOIN users u ON u.id = gm.student_id
      WHERE gm.group_id IN (?)
      ORDER BY gm.group_id, gm.is_leader DESC, u.name ASC`,
      [groupIds]
    );

    const data = groups.map((group) => {
      const groupedMembers = members
        .filter((member) => member.group_id === group.group_id)
        .map((member) => ({
          id: member.student_id,
          name: member.name,
          university_id: member.university_id,
        }));

      const leader = members.find(
        (member) => member.group_id === group.group_id && Number(member.is_leader) === 1
      );

      return {
        group_id: group.group_id,
        group_name: group.group_name,
        level: group.level,
        supervisor_id: group.supervisor_id,
        supervisor_name: group.supervisor_name || 'Not assigned',
        leader_name: leader?.name || groupedMembers[0]?.name || 'Not set',
        member_count: groupedMembers.length,
        members: groupedMembers,
      };
    });

    return res.json({ success: true, data });
  } catch (error) {
    console.error('Get Groups Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch groups.' });
  }
};

const createGroup = async (req, res) => {
  const { groupName, level, supervisorId, leaderId, memberIds } = req.body;

  const numericLevel = Number(level);
  const numericLeaderId = Number(leaderId);
  const memberIdList = Array.isArray(memberIds)
    ? [...new Set(memberIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
    : [];

  if (!groupName || !String(groupName).trim()) {
    return res.status(400).json({ success: false, error: 'groupName is required.' });
  }

  if (!Number.isInteger(numericLevel) || numericLevel < 1 || numericLevel > 4) {
    return res.status(400).json({ success: false, error: 'level must be between 1 and 4.' });
  }

  if (memberIdList.length !== 5) {
    return res.status(400).json({ success: false, error: 'Exactly 5 members are required.' });
  }

  if (!Number.isInteger(numericLeaderId) || !memberIdList.includes(numericLeaderId)) {
    return res.status(400).json({ success: false, error: 'leaderId must be one of the memberIds.' });
  }

  const numericSupervisorId =
    supervisorId === null || supervisorId === undefined || supervisorId === ''
      ? null
      : Number(supervisorId);

  if (numericSupervisorId !== null && (!Number.isInteger(numericSupervisorId) || numericSupervisorId <= 0)) {
    return res.status(400).json({ success: false, error: 'supervisorId is invalid.' });
  }

  let connection;
  try {
    await ensureGroupMembersTable();

    connection = await dbPromise.getConnection();
    await connection.beginTransaction();

    const [students] = await connection.query(
      `SELECT id FROM users WHERE role = 'student' AND level = ? AND id IN (?)`,
      [numericLevel, memberIdList]
    );

    if (students.length !== memberIdList.length) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: 'All members must be student accounts in the selected level.',
      });
    }

    if (numericSupervisorId !== null) {
      const [supervisors] = await connection.query(
        `SELECT id FROM users WHERE id = ? AND role = 'supervisor' LIMIT 1`,
        [numericSupervisorId]
      );

      if (!supervisors.length) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'Selected supervisor is invalid.' });
      }
    }

    const [groupInsert] = await connection.query(
      `INSERT INTO project_groups (group_name, level, supervisor_id) VALUES (?, ?, ?)`,
      [String(groupName).trim(), numericLevel, numericSupervisorId]
    );

    const groupId = groupInsert.insertId;

    const memberRows = memberIdList.map((studentId) => [
      groupId,
      studentId,
      studentId === numericLeaderId ? 1 : 0,
    ]);

    await connection.query(
      `INSERT INTO project_group_members (group_id, student_id, is_leader) VALUES ?`,
      [memberRows]
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: 'Group created successfully.',
      data: { groupId },
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Create Group Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create group.' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

const updateGroup = async (req, res) => {
  const groupId = Number(req.params.id);
  const { groupName, level, supervisorId, leaderId, memberIds } = req.body;

  if (!Number.isInteger(groupId) || groupId <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid group id.' });
  }

  const trimmedGroupName = String(groupName || '').trim();
  if (!trimmedGroupName) {
    return res.status(400).json({ success: false, error: 'groupName is required.' });
  }

  const numericLevel = Number(level);
  if (!Number.isInteger(numericLevel) || numericLevel < 1 || numericLevel > 4) {
    return res.status(400).json({ success: false, error: 'level must be between 1 and 4.' });
  }

  const numericSupervisorId =
    supervisorId === null || supervisorId === undefined || supervisorId === ''
      ? null
      : Number(supervisorId);

  if (numericSupervisorId !== null && (!Number.isInteger(numericSupervisorId) || numericSupervisorId <= 0)) {
    return res.status(400).json({ success: false, error: 'supervisorId is invalid.' });
  }

  const memberIdList = Array.isArray(memberIds)
    ? [...new Set(memberIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
    : [];
  const numericLeaderId = Number(leaderId);

  let connection;
  try {
    await ensureGroupMembersTable();
    connection = await dbPromise.getConnection();
    await connection.beginTransaction();

    const [existingRows] = await connection.query(
      `SELECT id FROM project_groups WHERE id = ? LIMIT 1`,
      [groupId]
    );

    if (!existingRows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Group not found.' });
    }

    const [duplicateRows] = await connection.query(
      `SELECT id
       FROM project_groups
       WHERE level = ? AND LOWER(TRIM(group_name)) = LOWER(TRIM(?)) AND id <> ?
       LIMIT 1`,
      [numericLevel, trimmedGroupName, groupId]
    );

    if (duplicateRows.length) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'A group with this name already exists for this level.' });
    }

    if (numericSupervisorId !== null) {
      const [supervisors] = await connection.query(
        `SELECT id FROM users WHERE id = ? AND role = 'supervisor' LIMIT 1`,
        [numericSupervisorId]
      );

      if (!supervisors.length) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'Selected supervisor is invalid.' });
      }
    }

    await connection.query(
      `UPDATE project_groups
       SET group_name = ?, level = ?, supervisor_id = ?
       WHERE id = ?`,
      [trimmedGroupName, numericLevel, numericSupervisorId, groupId]
    );

    // If members are supplied, replace membership and leader assignment atomically.
    if (memberIdList.length > 0 || Number.isInteger(numericLeaderId)) {
      if (memberIdList.length !== 5) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'Exactly 5 members are required.' });
      }

      if (!Number.isInteger(numericLeaderId) || !memberIdList.includes(numericLeaderId)) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'leaderId must be one of the memberIds.' });
      }

      const [students] = await connection.query(
        `SELECT id FROM users WHERE role = 'student' AND level = ? AND id IN (?)`,
        [numericLevel, memberIdList]
      );

      if (students.length !== memberIdList.length) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          error: 'All members must be student accounts in the selected level.',
        });
      }

      await connection.query(`DELETE FROM project_group_members WHERE group_id = ?`, [groupId]);

      const memberRows = memberIdList.map((studentId) => [
        groupId,
        studentId,
        studentId === numericLeaderId ? 1 : 0,
      ]);

      await connection.query(
        `INSERT INTO project_group_members (group_id, student_id, is_leader) VALUES ?`,
        [memberRows]
      );
    }

    await connection.commit();
    return res.json({ success: true, message: 'Group updated successfully.' });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Update Group Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update group.' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

const deleteGroup = async (req, res) => {
  const groupId = Number(req.params.id);

  if (!Number.isInteger(groupId) || groupId <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid group id.' });
  }

  let connection;
  try {
    await ensureGroupMembersTable();
    connection = await dbPromise.getConnection();
    await connection.beginTransaction();

    const [existsRows] = await connection.query(
      `SELECT id FROM project_groups WHERE id = ? LIMIT 1`,
      [groupId]
    );

    if (!existsRows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Group not found.' });
    }

    await connection.query(`DELETE FROM project_group_members WHERE group_id = ?`, [groupId]);
    await connection.query(`DELETE FROM project_groups WHERE id = ?`, [groupId]);

    await connection.commit();
    return res.json({ success: true, message: 'Group deleted successfully.' });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Delete Group Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete group.' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

module.exports = {
  getGroupsByLevel,
  createGroup,
  getCoordinatorApprovedRequests,
  updateGroup,
  deleteGroup,
};
