const db = require('../config/db');

/**
 * Fetches group details for a student member OR an assigned industry mentor.
 * Returns enriched fields (projectName, leader, members, mentors with full details).
 */
const getMentorAssignedGroup = async (req, res, next) => {
  const userId = req.params.studentId || req.params.mentorId || req.params.userId;
  const level = req.params.level ? Number(req.params.level) : null;

  try {
    const dbPromise = db.promise();

    // Check if this userId is a student member OR an assigned mentor (in project_groups or project_group_mentors)
    const [matchedGroups] = await dbPromise.query(
      `SELECT DISTINCT pg.id AS groupId, pg.group_name AS groupName, pg.department AS department, u.name AS supervisor, pg.level,
                       pg.mentor_id AS mentorId
       FROM project_groups pg
       LEFT JOIN project_group_members gm ON pg.id = gm.group_id
       LEFT JOIN project_group_mentors pgm ON pg.id = pgm.group_id
       LEFT JOIN users u ON u.id = pg.supervisor_id
       WHERE (gm.student_id = ? OR pg.mentor_id = ? OR pgm.mentor_id = ?) ${level ? 'AND pg.level = ?' : ''}`,
      level ? [userId, userId, userId, level] : [userId, userId, userId]
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

    // Fetch all assigned mentors for matched groups from project_group_mentors and fallback users
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
      console.warn('project_group_mentors query fallback:', mErr.message);
    }

    // Fallback: check legacy project_groups.mentor_id if not present in project_group_mentors
    const [legacyMentors] = await dbPromise.query(
      `SELECT pg.id AS group_id, u.id, u.name, u.email, u.phone
       FROM project_groups pg
       JOIN users u ON u.id = pg.mentor_id
       WHERE pg.id IN (?) AND pg.mentor_id IS NOT NULL`,
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
        mentorId: groupMentorsList[0]?.id || group.mentorId || null,
        mentor: mentorDisplayName,
        mentorName: mentorDisplayName,
        assignedMentor: mentorDisplayName,
        mentors: groupMentorsList,
        mentorNames: mentorDisplayNames,
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
                             pg.level
                      FROM project_groups pg
                      LEFT JOIN users u ON u.id = pg.supervisor_id
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

    // Fetch all mentors from project_group_mentors
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
      console.warn('project_group_mentors query fallback:', mErr.message);
    }

    // Fallback: fetch legacy mentors
    const [legacyMentors] = await dbPromise.query(
      `SELECT pg.id AS group_id, u.id, u.name, u.email, u.phone
       FROM project_groups pg
       JOIN users u ON u.id = pg.mentor_id
       WHERE pg.id IN (?) AND pg.mentor_id IS NOT NULL`,
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
        mentorId: groupMentorsList[0]?.id || group.mentorId || null,
        mentor: mentorDisplayName,
        mentorName: mentorDisplayName,
        assignedMentor: mentorDisplayName,
        mentors: groupMentorsList,
        mentorNames: mentorDisplayNames,
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
