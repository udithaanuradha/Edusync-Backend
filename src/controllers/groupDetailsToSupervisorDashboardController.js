const db = require('../config/db');
const dbPromise = db.promise();
const { extractProjectName } = require('../utils/extractProjectName');

// A group's project title isn't a column on project_groups — it only exists
// as free text inside the group_requests row that created it
// (group_requests.created_group_id -> project_groups.id, set once at
// creation time). Returns a Map<groupId, projectName | null> for the given
// group ids so each caller below can merge it in alongside members.
const loadProjectNamesByGroupId = async (groupIds) => {
  if (!groupIds.length) return new Map();

  const [requests] = await dbPromise.query(
    `SELECT created_group_id, request_message
     FROM group_requests
     WHERE created_group_id IN (?)`,
    [groupIds]
  );

  const map = new Map();
  requests.forEach((row) => {
    const name = extractProjectName(row.request_message);
    if (name) map.set(row.created_group_id, name);
  });
  return map;
};

const getSupervisorGroups = async (req, res) => {
  const level = Number(req.params.level);
  const supervisorId = req.params.supervisorId;
  
  try {
    const [groups] = await dbPromise.query(
      `SELECT pg.id AS groupId, pg.group_name AS groupName, u.name AS supervisorName, pg.level, pg.supervisor_id AS supervisorId
       FROM project_groups pg
       LEFT JOIN users u ON u.id = pg.supervisor_id
       WHERE pg.level = ? AND (pg.supervisor_id = ? OR pg.supervisor_id_2 = ?)
       ORDER BY pg.id ASC`,
      [level, supervisorId, supervisorId]
    );

    if (!groups.length) {
      return res.json([]);
    }

    const groupIds = groups.map(g => g.groupId);

    const [members] = await dbPromise.query(
      `SELECT gm.group_id, u.id, u.name, u.university_id, gm.is_leader
       FROM project_group_members gm
       LEFT JOIN users u ON u.id = gm.student_id
       WHERE gm.group_id IN (?)
       ORDER BY gm.is_leader DESC, u.name ASC`,
      [groupIds]
    );

    const projectNamesByGroupId = await loadProjectNamesByGroupId(groupIds);

    const formattedData = groups.map(group => {
      const groupMembers = members
        .filter(m => m.group_id === group.groupId)
        .map(m => ({
          id: m.id,
          name: m.name || "Unknown Student",
          university_id: m.university_id,
          is_leader: m.is_leader
        }));

      const leader = groupMembers.find(m => Number(m.is_leader) === 1);

      return {
        groupId: group.groupId,
        groupName: group.groupName,
        level: group.level,
        supervisorId: group.supervisorId,
        supervisorName: group.supervisorName || 'Not Assigned',
        leader: leader ? leader.name : (groupMembers[0]?.name || 'Not Assigned'),
        memberCount: groupMembers.length,
        members: groupMembers.map(m => m.name).join(', '),
        projectName: projectNamesByGroupId.get(group.groupId) || null,
      };
    });

    return res.json(formattedData);
  } catch (error) {
    console.error('Error fetching supervisor groups:', error);
    return res.status(500).json({ error: 'Failed to fetch supervisor groups' });
  }
};

const getAllSupervisorGroups = async (req, res) => {
  const supervisorId = req.params.supervisorId;
  
  try {
    const [groups] = await dbPromise.query(
      `SELECT pg.id AS groupId, pg.group_name AS groupName, u.name AS supervisorName, pg.level, pg.supervisor_id AS supervisorId
       FROM project_groups pg
       LEFT JOIN users u ON u.id = pg.supervisor_id
       WHERE pg.supervisor_id = ? OR pg.supervisor_id_2 = ?
       ORDER BY pg.id ASC`,
      [supervisorId, supervisorId]
    );

    if (!groups.length) {
      return res.json([]);
    }

    const groupIds = groups.map(g => g.groupId);

    const [members] = await dbPromise.query(
      `SELECT gm.group_id, u.id, u.name, u.university_id, gm.is_leader
       FROM project_group_members gm
       LEFT JOIN users u ON u.id = gm.student_id
       WHERE gm.group_id IN (?)
       ORDER BY gm.is_leader DESC, u.name ASC`,
      [groupIds]
    );

    const projectNamesByGroupId = await loadProjectNamesByGroupId(groupIds);

    const formattedData = groups.map(group => {
      const groupMembers = members
        .filter(m => m.group_id === group.groupId)
        .map(m => ({
          id: m.id,
          name: m.name || "Unknown Student",
          university_id: m.university_id,
          is_leader: m.is_leader
        }));

      const leader = groupMembers.find(m => Number(m.is_leader) === 1);

      return {
        groupId: group.groupId,
        groupName: group.groupName,
        level: group.level,
        supervisorId: group.supervisorId,
        supervisorName: group.supervisorName || 'Not Assigned',
        leader: leader ? leader.name : (groupMembers[0]?.name || 'Not Assigned'),
        memberCount: groupMembers.length,
        members: groupMembers.map(m => m.name).join(', '),
        projectName: projectNamesByGroupId.get(group.groupId) || null,
      };
    });

    return res.json(formattedData);
  } catch (error) {
    console.error('Error fetching all supervisor groups:', error);
    return res.status(500).json({ error: 'Failed to fetch supervisor groups' });
  }
};

module.exports = {
  getSupervisorGroups,
  getAllSupervisorGroups
};
