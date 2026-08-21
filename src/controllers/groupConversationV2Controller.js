const GroupConversationV2Model = require('../models/GroupConversationV2Model');

class GroupConversationV2Controller {
  static async getMine(req, res) {
    try {
      const userId = req.user?.id || req.query.user_id;
      if (!userId) {
        return res.status(400).json({ error: 'user_id is required' });
      }
      const conversations = await GroupConversationV2Model.getMyConversations(Number(userId));
      return res.status(200).json(conversations);
    } catch (error) {
      console.error('[GroupConversationV2Controller] getMine error:', error);
      return res.status(500).json({ error: 'Failed to fetch group conversations' });
    }
  }

  static async getMessages(req, res) {
    try {
      const conversationId = Number(req.params.id);
      const userId = req.user?.id || req.query.user_id;
      const limit = parseInt(req.query.limit || '50', 10);
      const offset = parseInt(req.query.offset || '0', 10);

      if (userId && !(await GroupConversationV2Model.isMember(conversationId, Number(userId)))) {
        return res.status(403).json({ error: 'Not a member of this conversation' });
      }

      const messages = await GroupConversationV2Model.getMessages(conversationId, limit, offset);
      return res.status(200).json(messages);
    } catch (error) {
      console.error('[GroupConversationV2Controller] getMessages error:', error);
      return res.status(500).json({ error: 'Failed to fetch group messages' });
    }
  }

  static async sendMessage(req, res) {
    try {
      const conversationId = Number(req.params.id);
      const senderId = req.user?.id || req.body.sender_id;
      const { message_text } = req.body;

      if (!senderId || !message_text?.trim()) {
        return res.status(400).json({ error: 'sender_id and message_text are required' });
      }
      if (!(await GroupConversationV2Model.isMember(conversationId, Number(senderId)))) {
        return res.status(403).json({ error: 'Not a member of this conversation' });
      }

      const savedMessage = await GroupConversationV2Model.saveMessage(
        conversationId,
        Number(senderId),
        message_text.trim()
      );
      return res.status(201).json(savedMessage);
    } catch (error) {
      console.error('[GroupConversationV2Controller] sendMessage error:', error);
      return res.status(500).json({ error: 'Failed to send group message' });
    }
  }

  static async markRead(req, res) {
    try {
      const conversationId = Number(req.params.id);
      const userId = req.user?.id || req.body.user_id;
      if (!userId) {
        return res.status(400).json({ error: 'user_id is required' });
      }
      await GroupConversationV2Model.markRead(conversationId, Number(userId));
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('[GroupConversationV2Controller] markRead error:', error);
      return res.status(500).json({ error: 'Failed to mark group conversation read' });
    }
  }
}

module.exports = GroupConversationV2Controller;
