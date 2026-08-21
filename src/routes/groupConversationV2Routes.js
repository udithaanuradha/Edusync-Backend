const express = require('express');
const router = express.Router();
const GroupConversationV2Controller = require('../controllers/groupConversationV2Controller');

router.get('/mine', GroupConversationV2Controller.getMine);
router.get('/:id/messages', GroupConversationV2Controller.getMessages);
router.post('/:id/messages', GroupConversationV2Controller.sendMessage);
router.post('/:id/read', GroupConversationV2Controller.markRead);

module.exports = router;
