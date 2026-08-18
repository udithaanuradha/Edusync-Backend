const db = require('../config/db');

/**
 * Fetches group details for a student member OR an assigned industry mentor.
 * Returns enriched fields (projectName, leader, members with full details).
 */
const getMentorAssignedGroup = async (req, res, next) => {
  const userId = req.params.studentId || req.params.mentorId || req.params.userId;
  const level = req.params.level ? Number(req.params.level) : null;

  try {
    const dbPromise = db.promise();

    // Check if this userId is a student member OR an assigned mentor
    const [matchedGroups] = await dbPromise.query(
      `SELECT DISTINCT pg.id AS groupId, pg.group_name AS groupName, pg.department AS department, u.name AS supervisor, pg.level,
                       m.name AS mentorName, pg.mentor_id AS mentorId
       FROM project_groups pg
       LEFT JOIN project_group_members gm ON pg.id = gm.group_id
       LEFT JOIN users u ON u.id = pg.supervisor_id
       LEFT JOIN users m ON m.id = pg.mentor_id
       WHERE (gm.student_id = ? OR pg.mentor_id = ?) ${level ? 'AND pg.level = ?' : ''}`,
      level ? [userId, userId, level] : [userId, userId]
    );

    if (!matchedGroups || matchedGroups.length === 0) {
      if (typeof next === 'function') {
        return next();
      }
      return res.json([]);
    }

    const groupIds = matchedGroups.map((g) => g.groupId);

    // Fetch detailed member info for matched groups
    const [members] = await dbPromise.query(
      `SELECT gm.group_id, u.id, u.name, u.email, u.university_id, u.phone, gm.is_leader
       FROM project_group_members gm
       LEFT JOIN users u ON u.id = gm.student_id
       WHERE gm.group_id IN (?)
       ORDER BY gm.is_leader DESC, u.name ASC`,
      [groupIds]
    );

    const formattedData = matchedGroups.map((group) => {
      const groupMembers = members
        .filter((m) => m.group_id === group.groupId)
        .map((m) => ({
          id: m.id,
          name: m.name || 'Unknown Student',
          email: m.email,
          university_id: m.university_id,
          universityId: m.university_id,
          phone: m.phone || null,
          is_leader: m.is_leader,
          isLeader: Boolean(m.is_leader),
        }));

      const leader = groupMembers.find(
        (m) => Number(m.is_leader) === 1 || m.isLeader
      );

      return {
        id: group.groupId,
        groupId: group.groupId,
        groupName: group.groupName,
        group_name: group.groupName,
        projectName: group.groupName,
        project_name: group.groupName,
        department: group.department || null,
        level: group.level,
        supervisor: group.supervisor || 'Not Assigned',
        supervisorName: group.supervisor || 'Not Assigned',
        supervisor_name: group.supervisor || 'Not Assigned',
        mentorId: group.mentorId,
        mentor: group.mentorName || 'Unassigned',
        mentorName: group.mentorName || 'Unassigned',
        assignedMentor: group.mentorName || 'Unassigned',
        leader: leader ? leader.name : (groupMembers[0]?.name || 'Not Assigned'),
        leaderName: leader ? leader.name : (groupMembers[0]?.name || 'Not Assigned'),
        leader_name: leader ? leader.name : (groupMembers[0]?.name || 'Not Assigned'),
        members: groupMembers,
        member_names: groupMembers.map((m) => m.name),
        status: 'Active',
      };
    });

    return res.json(formattedData);
  } catch (error) {
    console.error('❌ Mentor Group Controller Error:', error);
    if (typeof next === 'function') {
      return next();
    }
    return res.status(500).json({ error: 'Failed to fetch group' });
  }
};

/**
 * Returns groups for a given level with supervisor and assigned mentor details.
 */
const getMentorGroupsByLevel = async (req, res, next) => {
  const level = Number(req.params.level);

  try {
    const dbPromise = db.promise();

    let groupQuery = `SELECT pg.id AS groupId, pg.group_name AS groupName, pg.department AS department, u.name AS supervisor, pg.mentor_id AS mentorId,
                             m.name AS mentorName, m.email AS mentorEmail, pg.level
                      FROM project_groups pg
                      LEFT JOIN users u ON u.id = pg.supervisor_id
                      LEFT JOIN users m ON m.id = pg.mentor_id
                      WHERE pg.level = ?`;
    let params = [level];

    if (req.query.coordinatorId) {
      groupQuery += ` AND pg.created_by = ?`;
      params.push(req.query.coordinatorId);
    }

    groupQuery += ` ORDER BY pg.id DESC`;

    const [groups] = await dbPromise.query(groupQuery, params);

    if (!groups.length) {
      return res.json([]);
    }

    const groupIds = groups.map((g) => g.groupId);

    const [members] = await dbPromise.query(
      `SELECT gm.group_id, u.id, u.name, u.email, u.university_id, u.phone, gm.is_leader
       FROM project_group_members gm
       LEFT JOIN users u ON u.id = gm.student_id
       WHERE gm.group_id IN (?)
       ORDER BY gm.is_leader DESC, u.name ASC`,
      [groupIds]
    );

    const formattedData = groups.map((group) => {
      const groupMembers = members
        .filter((m) => m.group_id === group.groupId)
        .map((m) => ({
          id: m.id,
          name: m.name || 'Unknown Student',
          email: m.email,
          university_id: m.university_id,
          universityId: m.university_id,
          phone: m.phone || null,
          is_leader: m.is_leader,
          isLeader: Boolean(m.is_leader),
        }));

      const leader = groupMembers.find(
        (m) => Number(m.is_leader) === 1 || m.isLeader
      );

      return {
        id: group.groupId,
        groupId: group.groupId,
        groupName: group.groupName,
        group_name: group.groupName,
        projectName: group.groupName,
        project_name: group.groupName,
        department: group.department || null,
        level: group.level,
        supervisor: group.supervisor || 'Not Assigned',
        supervisorName: group.supervisor || 'Not Assigned',
        supervisor_name: group.supervisor || 'Not Assigned',
        mentorId: group.mentorId,
        mentor: group.mentorName || 'Unassigned',
        mentorName: group.mentorName || null,
        assignedMentor: group.mentorName || 'Unassigned',
        leader: leader ? leader.name : (groupMembers[0]?.name || 'Not Assigned'),
        leaderName: leader ? leader.name : (groupMembers[0]?.name || 'Not Assigned'),
        leader_name: leader ? leader.name : (groupMembers[0]?.name || 'Not Assigned'),
        members: groupMembers,
        member_names: groupMembers.map((m) => m.name),
        status: 'Active',
      };
    });

    return res.json(formattedData);
  } catch (error) {
    console.error('❌ Error in getMentorGroupsByLevel:', error);
    if (typeof next === 'function') {
      return next();
    }
    return res.status(500).json({ error: 'Failed to fetch groups' });
  }
};

module.exports = { getMentorAssignedGroup, getMentorGroupsByLevel };
