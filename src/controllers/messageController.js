const {
  getConversation,
  sendMessage,
  markAsRead,
} = require("../models/MessageModel");

// Get conversation history between two users
const getMessages = (req, res) => {
  const { sender_id, receiver_id } = req.query;

  if (!sender_id || !receiver_id) {
    return res
      .status(400)
      .json({ error: "sender_id and receiver_id are required" });
  }

  getConversation(sender_id, receiver_id, (err, messages) => {
    if (err) {
      console.error("Error fetching messages:", err);
      return res.status(500).json({ error: "Failed to fetch messages" });
    }

    res.status(200).json(messages);
  });
};

// Send a new message
const postMessage = (req, res) => {
  const {
    sender_id,
    sender_name,
    sender_role,
    receiver_id,
    receiver_name,
    receiver_role,
    message_text,
  } = req.body;

  // Validate required fields
  if (
    !sender_id ||
    !sender_name ||
    !sender_role ||
    !receiver_id ||
    !receiver_name ||
    !receiver_role ||
    !message_text
  ) {
    return res.status(400).json({ error: "All fields are required" });
  }

  const messageData = {
    sender_id,
    sender_name,
    sender_role,
    receiver_id,
    receiver_name,
    receiver_role,
    message_text,
  };

  sendMessage(messageData, (err, message) => {
    if (err) {
      console.error("Error sending message:", err);
      return res.status(500).json({ error: "Failed to send message" });
    }

    res.status(201).json(message);
  });
};

// Mark messages as read
const readMessages = (req, res) => {
  const { sender_id, receiver_id } = req.body;

  if (!sender_id || !receiver_id) {
    return res
      .status(400)
      .json({ error: "sender_id and receiver_id are required" });
  }

  markAsRead(sender_id, receiver_id, (err, result) => {
    if (err) {
      console.error("Error marking messages as read:", err);
      return res.status(500).json({ error: "Failed to mark messages as read" });
    }

    res.status(200).json({ success: true, message: "Messages marked as read" });
  });
};

module.exports = {
  getMessages,
  postMessage,
  readMessages,
};
