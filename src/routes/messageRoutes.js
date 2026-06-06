const express = require("express");
const router = express.Router();
const {
  getMessages,
  postMessage,
  readMessages,
  getLeaders, 
} = require("../controllers/messageController");


router.get("/leaders", getLeaders);

// Get all messages between two users
router.get("/", getMessages);

// Send a new message
router.post("/", postMessage);

// Mark messages as read
router.post("/read", readMessages);

module.exports = router;
