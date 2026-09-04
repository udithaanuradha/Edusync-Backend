const db = require('../config/db');
const dbPromise = db.promise();

// Lives entirely alongside the messages_v2 / socket_v2 chat subsystem —
// deliberately does not touch groupController.js or mentorOnboardingRoutes.js
// (both change frequently under active development). Provisioning is lazy:
// ensureGroupConversation() re-derives membership from project_groups /
// project_group_members (read-only against those tables) every time it's
// called, so a group chat "auto-appears" the next time an affected user
// opens their conversation list rather than reacting to the assignment
// write itself.

let ensureTablesPromise = null;

const ensureTables = async () => {
  if (!ensureTablesPromise) {
    ensureTablesPromise = (async () => {
      await dbPromise.query(`
        CREATE TABLE IF NOT EXISTS group_conversations (
            id INT PRIMARY KEY AUTO_INCREMENT,
            project_group_id INT NOT NULL,
            type ENUM('supervisor', 'mentor') NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_group_conv (project_group_id, type),
            CONSTRAINT fk_gc_group FOREIGN KEY (project_group_id) REFERENCES project_groups(id) ON DELETE CASCADE
        )
      `);

      await dbPromise.query(`
        CREATE TABLE IF NOT EXISTS group_conversation_members (
            group_conversation_id INT NOT NULL,
            user_id INT NOT NULL,
            PRIMARY KEY (group_conversation_id, user_id),
            INDEX idx_gcm_user (user_id),
            CONSTRAINT fk_gcm_conv FOREIGN KEY (group_conversation_id) REFERENCES group_conversations(id) ON DELETE CASCADE,
            CONSTRAINT fk_gcm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      await dbPromise.query(`
        CREATE TABLE IF NOT EXISTS message_reads (
            message_id BIGINT NOT NULL,
            user_id INT NOT NULL,
            read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (message_id, user_id),
            CONSTRAINT fk_mr_message FOREIGN KEY (message_id) REFERENCES messages_v2(id) ON DELETE CASCADE,
            CONSTRAINT fk_mr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Additive to messages_v2 — existing 1:1 sender_id/receiver_id rows
      // and behavior are untouched. receiver_id becomes nullable since a
      // group message has many recipients, not one.
      await dbPromise.query(`ALTER TABLE messages_v2 ADD COLUMN IF NOT EXISTS group_conversation_id INT NULL`);
      await dbPromise.query(`ALTER TABLE messages_v2 MODIFY COLUMN receiver_id INT NULL`);
      try {
        await dbPromise.query(`ALTER TABLE messages_v2 ADD INDEX idx_group_conv_history (group_conversation_id, created_at)`);
      } catch (e) {
        if (e.code !== 'ER_DUP_KEYNAME') throw e; // index already added on a previous boot
      }
    })();
  }
  await ensureTablesPromise;
};

/**
 * Every project group this user has any stake in — as a student member, an
 * assigned supervisor (primary or second), or the assigned mentor. Source of
 * truth for both "which conversations should exist" and "who should be in
 * them".
 */
const getUserProjectGroups = async (userId) => {
  const [rows] = await dbPromise.query(
    `SELECT DISTINCT pg.id, pg.group_name, pg.level, pg.supervisor_id, pg.supervisor_id_2, pg.mentor_id
     FROM project_groups pg
     LEFT JOIN project_group_members gm ON gm.group_id = pg.id
     WHERE gm.student_id = ? OR pg.supervisor_id = ? OR pg.supervisor_id_2 = ? OR pg.mentor_id = ?`,
    [userId, userId, userId, userId]
  );
  return rows;
};

/**
 * Idempotent get-or-create + membership sync for one project group's
 * supervisor-chat or mentor-chat. No-ops if that role isn't assigned yet.
 * The supervisor-chat seats both supervisor_id and supervisor_id_2 (when a
 * group has a second supervisor) in the same conversation alongside the
 * students — one chat per group per role, not a separate chat per supervisor.
 */
const ensureGroupConversation = async (projectGroupId, type) => {
  await ensureTables();

  const [groupRows] = await dbPromise.query(
    `SELECT supervisor_id, supervisor_id_2, mentor_id FROM project_groups WHERE id = ?`,
    [projectGroupId]
  );
  if (!groupRows.length) return null;

  const staffIds = type === 'mentor'
    ? [groupRows[0].mentor_id]
    : [groupRows[0].supervisor_id, groupRows[0].supervisor_id_2];
  const assignedStaffIds = staffIds.filter(Boolean);
  if (!assignedStaffIds.length) return null; // nothing assigned yet — no chat to provision

  const [memberRows] = await dbPromise.query(
    `SELECT student_id FROM project_group_members WHERE group_id = ?`,
    [projectGroupId]
  );
  const targetUserIds = [...assignedStaffIds, ...memberRows.map((m) => m.student_id)];

  await dbPromise.query(
    `INSERT INTO group_conversations (project_group_id, type) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [projectGroupId, type]
  );
  const [convRows] = await dbPromise.query(
    `SELECT id FROM group_conversations WHERE project_group_id = ? AND type = ?`,
    [projectGroupId, type]
  );
  const conversationId = convRows[0].id;

  await dbPromise.query(
    `INSERT IGNORE INTO group_conversation_members (group_conversation_id, user_id) VALUES ?`,
    [targetUserIds.map((uid) => [conversationId, uid])]
  );
  await dbPromise.query(
    `DELETE FROM group_conversation_members WHERE group_conversation_id = ? AND user_id NOT IN (?)`,
    [conversationId, targetUserIds]
  );

  return conversationId;
};

/**
 * Ensures + returns every group conversation this user currently belongs
 * to, with display info for the conversation list.
 */
const getMyConversations = async (userId) => {
  await ensureTables();

  const groups = await getUserProjectGroups(userId);
  await Promise.all(
    groups.flatMap((g) => [
      ensureGroupConversation(g.id, 'supervisor'),
      ensureGroupConversation(g.id, 'mentor'),
    ])
  );

  const [rows] = await dbPromise.query(
    `SELECT gc.id AS conversation_id, gc.type, pg.id AS project_group_id,
            pg.group_name, pg.level,
            (SELECT COUNT(*) FROM group_conversation_members WHERE group_conversation_id = gc.id) AS member_count,
            (SELECT m.message_text FROM messages_v2 m WHERE m.group_conversation_id = gc.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message_text,
            (SELECT m.created_at FROM messages_v2 m WHERE m.group_conversation_id = gc.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message_time,
            (SELECT m.sender_id FROM messages_v2 m WHERE m.group_conversation_id = gc.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_sender_id,
            (SELECT COUNT(*) FROM messages_v2 m
              WHERE m.group_conversation_id = gc.id AND m.sender_id != ?
                AND NOT EXISTS (SELECT 1 FROM message_reads r WHERE r.message_id = m.id AND r.user_id = ?)
            ) AS unread_count
     FROM group_conversation_members gcm
     JOIN group_conversations gc ON gc.id = gcm.group_conversation_id
     JOIN project_groups pg ON pg.id = gc.project_group_id
     WHERE gcm.user_id = ?
     ORDER BY last_message_time IS NULL, last_message_time DESC`,
    [userId, userId, userId]
  );
  return rows;
};

const isMember = async (conversationId, userId) => {
  const [rows] = await dbPromise.query(
    `SELECT 1 FROM group_conversation_members WHERE group_conversation_id = ? AND user_id = ?`,
    [conversationId, userId]
  );
  return rows.length > 0;
};

const getMembers = async (conversationId) => {
  const [rows] = await dbPromise.query(
    `SELECT user_id FROM group_conversation_members WHERE group_conversation_id = ?`,
    [conversationId]
  );
  return rows.map((r) => r.user_id);
};

const getMessages = async (conversationId, limit = 50, offset = 0) => {
  const [rows] = await dbPromise.query(
    `SELECT m.id, m.sender_id, u.name AS sender_name, u.role AS sender_role,
            m.group_conversation_id, m.message_text, m.created_at
     FROM messages_v2 m
     JOIN users u ON u.id = m.sender_id
     WHERE m.group_conversation_id = ?
     ORDER BY m.created_at ASC, m.id ASC
     LIMIT ? OFFSET ?`,
    [conversationId, Number(limit), Number(offset)]
  );
  return rows;
};

const saveMessage = async (conversationId, senderId, messageText) => {
  const [result] = await dbPromise.query(
    `INSERT INTO messages_v2 (sender_id, group_conversation_id, message_text, read_status, created_at)
     VALUES (?, ?, ?, FALSE, CURRENT_TIMESTAMP)`,
    [senderId, conversationId, messageText]
  );
  const [rows] = await dbPromise.query(
    `SELECT m.id, m.sender_id, u.name AS sender_name, u.role AS sender_role,
            m.group_conversation_id, m.message_text, m.created_at
     FROM messages_v2 m JOIN users u ON u.id = m.sender_id
     WHERE m.id = ?`,
    [result.insertId]
  );
  return rows[0];
};

const markRead = async (conversationId, userId) => {
  await dbPromise.query(
    `INSERT IGNORE INTO message_reads (message_id, user_id)
     SELECT m.id, ? FROM messages_v2 m
     WHERE m.group_conversation_id = ? AND m.sender_id != ?`,
    [userId, conversationId, userId]
  );
};

module.exports = {
  ensureTables,
  getUserProjectGroups,
  ensureGroupConversation,
  getMyConversations,
  isMember,
  getMembers,
  getMessages,
  saveMessage,
  markRead,
};
