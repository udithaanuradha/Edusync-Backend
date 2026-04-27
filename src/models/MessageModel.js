const db = require("../config/db");

// Get all messages between two users
const getConversation = (senderId, receiverId, callback) => {
  const query = `
        SELECT * FROM messages
        WHERE (sender_id = ? AND receiver_id = ?)
           OR (sender_id = ? AND receiver_id = ?)
        ORDER BY created_at ASC
    `;

  db.query(
    query,
    [senderId, receiverId, receiverId, senderId],
    (err, results) => {
      if (err) {
        console.error("Error fetching conversation:", err);
        return callback(err, null);
      }
      callback(null, results);
    },
  );
};

// Send a new message
const sendMessage = (messageData, callback) => {
  const {
    sender_id,
    sender_name,
    sender_role,
    receiver_id,
    receiver_name,
    receiver_role,
    message_text,
  } = messageData;

  const query = `
        INSERT INTO messages
        (sender_id, sender_name, sender_role, receiver_id, receiver_name, receiver_role, message_text, created_at, read_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), false)
    `;

  db.query(
    query,
    [
      sender_id,
      sender_name,
      sender_role,
      receiver_id,
      receiver_name,
      receiver_role,
      message_text,
    ],
    (err, results) => {
      if (err) {
        console.error("Error sending message:", err);
        return callback(err, null);
      }

      // Get the inserted message
      const selectQuery = `SELECT * FROM messages WHERE id = ?`;
      db.query(selectQuery, [results.insertId], (err, message) => {
        if (err) {
          console.error("Error retrieving message:", err);
          return callback(err, null);
        }
        callback(null, message[0]);
      });
    },
  );
};

// Mark messages as read
const markAsRead = (senderId, receiverId, callback) => {
  const query = `
        UPDATE messages
        SET read_status = true
        WHERE sender_id = ? AND receiver_id = ? AND read_status = false
    `;

  db.query(query, [senderId, receiverId], (err, results) => {
    if (err) {
      console.error("Error marking messages as read:", err);
      return callback(err, null);
    }
    callback(null, results);
  });
};

// NEW: Get group leaders based on your TiDB schema
const getGroupLeaders = (callback) => {
  const query = `
    SELECT u.id, u.name, u.email, 'group_leader' as role 
    FROM users u
    JOIN project_group_members pgm ON u.id = pgm.student_id
    WHERE pgm.is_leader = 1
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching group leaders:", err);
      return callback(err, null);
    }
    callback(null, results);
  });
};

module.exports = {
  getConversation,
  sendMessage,
  markAsRead,
  getGroupLeaders, // Exported here
};
