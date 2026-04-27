const express = require("express");
const router = express.Router();
const {
  getMessages,
  postMessage,
  readMessages,
} = require("../controllers/messageController");

// Get all messages between two users
router.get("/", getMessages);

// Send a new message
router.post("/", postMessage);

// Mark messages as read
router.post("/read", readMessages);

module.exports = router;
