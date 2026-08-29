const db = require('../config/db');
const dbPromise = db.promise();

// Single source of truth for "who is allowed to message whom" in the 1:1
// chat (messages_v2 / message:send). The separate group-chat feature
// (group_conversations) already enforces its own membership-based access
// and is untouched by this module.
//
// Permission table (one-directional "who can INITIATE to whom"):
//   mentor              -> their currently-assigned students only
//   student (regular)   -> their assigned supervisor, their assigned mentor, all students
//   student (leader)    -> coordinators, all supervisors, all students, their assigned mentor
//   supervisor          -> everyone except mentors; among students, their
//                          assigned students only
//   coordinator         -> everyone except mentors AND except regular students
//                          (among students: leaders only)
//   admin               -> everyone except students and mentors
//
// A message A->B is allowed if EITHER direction's rule grants it, so a
// legitimate outreach (e.g. supervisor -> a student who isn't specifically
// "theirs") isn't a dead end the other side can never reply to.

/**
 * Mirrors the exact normalization in index.js's normalizeUserForClient, so
 * this module classifies users the same way the rest of the app does.
 */
const getEffectiveRole = (rawRole, designation) => {
  const role = rawRole === 'industry mentor' ? 'mentor' : String(rawRole || '').toLowerCase();
  const desig = typeof designation === 'string' ? designation.trim().toLowerCase() : null;

  if (role === 'lecturer' && desig === 'coordinator') return 'coordinator';
  if (role === 'lecturer' && (desig === 'supervisor' || !desig)) return 'supervisor';
  return role;
};

const getUserRoleInfo = async (userId) => {
  const [rows] = await dbPromise.query(`SELECT role, designation FROM users WHERE id = ?`, [userId]);
  if (!rows.length) return null;

  const effectiveRole = getEffectiveRole(rows[0].role, rows[0].designation);
  let isGroupLeader = false;

  if (effectiveRole === 'student') {
    const [leaderRows] = await dbPromise.query(
      `SELECT 1 FROM project_group_members WHERE student_id = ? AND is_leader = 1 LIMIT 1`,
      [userId]
    );
    isGroupLeader = leaderRows.length > 0;
  }

  return { userId, effectiveRole, isGroupLeader };
};

/**
 * Distinct supervisor_id / mentor_id across every project group this
 * student belongs to. Same join used in GroupConversationV2Model's
 * getUserProjectGroups.
 */
const getAssignedSupervisorAndMentorIds = async (studentId) => {
  const [rows] = await dbPromise.query(
    `SELECT DISTINCT pg.supervisor_id, pg.mentor_id
     FROM project_groups pg
     JOIN project_group_members gm ON gm.group_id = pg.id
     WHERE gm.student_id = ?`,
    [studentId]
  );
  return {
    supervisorIds: rows.map((r) => r.supervisor_id).filter((id) => id != null),
    mentorIds: rows.map((r) => r.mentor_id).filter((id) => id != null),
  };
};

/** Inverse of the above — students in groups where supervisor_id/mentor_id = staffId. */
const getAssignedStudentIds = async (staffId, type) => {
  const column = type === 'mentor' ? 'mentor_id' : 'supervisor_id';
  const [rows] = await dbPromise.query(
    `SELECT DISTINCT gm.student_id
     FROM project_groups pg
     JOIN project_group_members gm ON gm.group_id = pg.id
     WHERE pg.${column} = ?`,
    [staffId]
  );
  return rows.map((r) => r.student_id);
};

/** One-directional check: can `from` initiate a message to `to`? */
const canInitiate = async (fromInfo, toInfo) => {
  const { effectiveRole: fromRole, userId: fromId, isGroupLeader } = fromInfo;
  const { effectiveRole: toRole, userId: toId } = toInfo;

  switch (fromRole) {
    case 'mentor': {
      const assignedStudentIds = await getAssignedStudentIds(fromId, 'mentor');
      return toRole === 'student' && assignedStudentIds.includes(toId);
    }

    case 'student': {
      if (toRole === 'student') return true; // any student <-> any student

      const { supervisorIds, mentorIds } = await getAssignedSupervisorAndMentorIds(fromId);
      if (toRole === 'supervisor') {
        return isGroupLeader || supervisorIds.includes(toId); // leaders reach all supervisors
      }
      if (toRole === 'mentor') {
        return mentorIds.includes(toId);
      }
      if (toRole === 'coordinator') {
        return isGroupLeader; // only group leaders can reach coordinators
      }
      return false; // admin, etc. — never
    }

    case 'supervisor': {
      if (toRole === 'mentor') return false;
      if (toRole === 'student') {
        const assignedStudentIds = await getAssignedStudentIds(fromId, 'supervisor');
        return assignedStudentIds.includes(toId);
      }
      return true; // other supervisors, coordinators, admins
    }

    case 'coordinator':
      if (toRole === 'mentor') return false;
      if (toRole === 'student') return Boolean(toInfo.isGroupLeader); // leaders only
      return true; // other supervisors/coordinators/admins

    case 'admin':
      return toRole !== 'student' && toRole !== 'mentor';

    default:
      return false;
  }
};

/** Full bidirectional check used at send time — either direction's rule is enough. */
const canMessage = async (senderId, receiverId) => {
  if (Number(senderId) === Number(receiverId)) return false;

  const [senderInfo, receiverInfo] = await Promise.all([
    getUserRoleInfo(senderId),
    getUserRoleInfo(receiverId),
  ]);
  if (!senderInfo || !receiverInfo) return false;

  const [forward, backward] = await Promise.all([
    canInitiate(senderInfo, receiverInfo),
    canInitiate(receiverInfo, senderInfo),
  ]);
  return forward || backward;
};

module.exports = {
  getEffectiveRole,
  getUserRoleInfo,
  getAssignedSupervisorAndMentorIds,
  getAssignedStudentIds,
  canInitiate,
  canMessage,
};
