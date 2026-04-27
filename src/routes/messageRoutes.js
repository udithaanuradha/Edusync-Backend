const express = require("express");
const router = express.Router();
const {
  getMessages,
  postMessage,
  readMessages,
  getLeaders, // Imported here
} = require("../controllers/messageController");

// NEW: Get all group leaders
// (Note: Since this is in messageRoutes, the actual path is /api/messages/leaders)
router.get("/leaders", getLeaders);

// Get all messages between two users
router.get("/", getMessages);

// Send a new message
router.post("/", postMessage);

// Mark messages as read
router.post("/read", readMessages);

module.exports = router;
