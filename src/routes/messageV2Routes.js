const express = require('express');
const router = express.Router();
const MessageV2Controller = require('../controllers/messageV2Controller');

router.get('/conversations', MessageV2Controller.getConversations);
router.get('/recipients', MessageV2Controller.getRecipients);
router.get('/', MessageV2Controller.getMessageHistory);
router.post('/', MessageV2Controller.sendMessage);
router.patch('/read', MessageV2Controller.markRead);

module.exports = router;
