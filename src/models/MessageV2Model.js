const db = require('../config/db');
const { canMessage } = require('../utils/chatPermissionsV2');

class MessageV2Model {
  static async initTable() {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS messages_v2 (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          sender_id INT NOT NULL,
          receiver_id INT NOT NULL,
          message_text TEXT NOT NULL,
          read_status BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_sender_v2 FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
          CONSTRAINT fk_receiver_v2 FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_conversation_history_v2 (sender_id, receiver_id, created_at),
          INDEX idx_receiver_unread_v2 (receiver_id, read_status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    try {
      const connection = db.promise ? db.promise() : db;
      await connection.query(createTableQuery);
      console.log('[MessageV2Model] Table messages_v2 ready.');
    } catch (error) {
      console.error('[MessageV2Model] Error creating messages_v2 table:', error);
      throw error;
    }
  }

  static async saveMessage({ sender_id, receiver_id, message_text }) {
    const connection = db.promise ? db.promise() : db;
    const insertSql = `
      INSERT INTO messages_v2 (sender_id, receiver_id, message_text, read_status, created_at)
      VALUES (?, ?, ?, FALSE, CURRENT_TIMESTAMP);
    `;
    const [result] = await connection.query(insertSql, [sender_id, receiver_id, message_text]);
    return await this.getMessageById(result.insertId);
  }

  static async getMessageById(messageId) {
    const connection = db.promise ? db.promise() : db;
    const selectSql = `
      SELECT 
        m.id,
        m.sender_id,
        u_sender.name AS sender_name,
        u_sender.role AS sender_role,
        m.receiver_id,
        u_receiver.name AS receiver_name,
        u_receiver.role AS receiver_role,
        m.message_text,
        m.read_status,
        m.created_at
      FROM messages_v2 m
      JOIN users u_sender ON m.sender_id = u_sender.id
      JOIN users u_receiver ON m.receiver_id = u_receiver.id
      WHERE m.id = ?
      LIMIT 1;
    `;
    const [rows] = await connection.query(selectSql, [messageId]);
    return rows[0] || null;
  }

  static async getConversationHistory(userId1, userId2, limit = 50, offset = 0) {
    const connection = db.promise ? db.promise() : db;
    const selectSql = `
      SELECT 
        m.id,
        m.sender_id,
        u_sender.name AS sender_name,
        u_sender.role AS sender_role,
        m.receiver_id,
        u_receiver.name AS receiver_name,
        u_receiver.role AS receiver_role,
        m.message_text,
        m.read_status,
        m.created_at
      FROM messages_v2 m
      JOIN users u_sender ON m.sender_id = u_sender.id
      JOIN users u_receiver ON m.receiver_id = u_receiver.id
      WHERE (m.sender_id = ? AND m.receiver_id = ?)
         OR (m.sender_id = ? AND m.receiver_id = ?)
      ORDER BY m.created_at ASC
      LIMIT ? OFFSET ?;
    `;
    const [rows] = await connection.query(selectSql, [
      userId1,
      userId2,
      userId2,
      userId1,
      Number(limit),
      Number(offset),
    ]);
    return rows;
  }

  static async getActiveConversations(userId) {
    const connection = db.promise ? db.promise() : db;
    const query = `
      WITH RankedMessages AS (
        SELECT 
          m.id,
          m.sender_id,
          m.receiver_id,
          m.message_text,
          m.read_status,
          m.created_at,
          CASE 
            WHEN m.sender_id = ? THEN m.receiver_id 
            ELSE m.sender_id 
          END AS partner_id,
          ROW_NUMBER() OVER (
            PARTITION BY (CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END)
            ORDER BY m.created_at DESC, m.id DESC
          ) AS rn
        FROM messages_v2 m
        WHERE m.sender_id = ? OR m.receiver_id = ?
      ),
      UnreadCounts AS (
        SELECT 
          sender_id AS partner_id,
          COUNT(*) AS unread_count
        FROM messages_v2
        WHERE receiver_id = ? AND read_status = FALSE
        GROUP BY sender_id
      )
      SELECT 
        rm.partner_id,
        u.name AS partner_name,
        u.role AS partner_role,
        u.email AS partner_email,
        rm.id AS last_message_id,
        rm.message_text AS last_message_text,
        rm.created_at AS last_message_time,
        rm.sender_id AS last_sender_id,
        COALESCE(uc.unread_count, 0) AS unread_count
      FROM RankedMessages rm
      JOIN users u ON rm.partner_id = u.id
      LEFT JOIN UnreadCounts uc ON rm.partner_id = uc.partner_id
      WHERE rm.rn = 1
      ORDER BY rm.created_at DESC;
    `;
    const [rows] = await connection.query(query, [userId, userId, userId, userId, userId]);
    return rows;
  }

  static async markMessagesAsRead(sender_id, receiver_id) {
    const connection = db.promise ? db.promise() : db;
    const updateSql = `
      UPDATE messages_v2
      SET read_status = TRUE
      WHERE sender_id = ? AND receiver_id = ? AND read_status = FALSE;
    `;
    const [result] = await connection.query(updateSql, [sender_id, receiver_id]);
    return result.affectedRows;
  }

  /**
   * Fetches eligible recipients with proper role and designation mappings.
   * Supervisors and Coordinators are stored as role='lecturer' with designation='supervisor'/'coordinator'.
   */
  static async getRecipientsByRole(role, currentUserId) {
    const connection = db.promise ? db.promise() : db;
    let sql = `SELECT id, name, email, role FROM users WHERE id != ?`;
    const params = [currentUserId];

    if (role === 'supervisor') {
      sql += ` AND (role = 'supervisor' OR (role = 'lecturer' AND (designation = 'supervisor' OR designation IS NULL OR designation = '')))`;
    } else if (role === 'coordinator') {
      sql += ` AND (role = 'coordinator' OR (role = 'lecturer' AND designation = 'coordinator'))`;
    } else if (role === 'group_leader') {
      // Return student leaders or students
      sql = `SELECT id, name, email, 'group_leader' AS role FROM users WHERE id != ? AND role = 'student'`;
    } else if (role && role !== 'all') {
      sql += ` AND role = ?`;
      params.push(role);
    }

    sql += ` ORDER BY name ASC LIMIT 100`;

    const [rows] = await connection.query(sql, params);

    // Only surface people the current user is actually allowed to message —
    // see chatPermissionsV2.js for the role-based rules.
    const permitted = await Promise.all(rows.map((r) => canMessage(currentUserId, r.id)));
    return rows.filter((_, idx) => permitted[idx]);
  }
}

module.exports = MessageV2Model;
