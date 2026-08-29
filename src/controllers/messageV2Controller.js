const MessageV2Model = require('../models/MessageV2Model');
const { canMessage } = require('../utils/chatPermissionsV2');

class MessageV2Controller {
  static async getConversations(req, res) {
    try {
      const userId = req.user?.id || req.query.user_id;
      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }
      const conversations = await MessageV2Model.getActiveConversations(userId);
      return res.status(200).json(conversations);
    } catch (error) {
      console.error('[MessageV2Controller] getConversations error:', error);
      return res.status(500).json({ error: 'Failed to fetch conversations' });
    }
  }

  static async getMessageHistory(req, res) {
    try {
      const userId = req.user?.id || req.query.user_id;
      const partnerId = req.query.partner_id;
      const limit = parseInt(req.query.limit || '50', 10);
      const offset = parseInt(req.query.offset || '0', 10);
      if (!userId || !partnerId) {
        return res.status(400).json({ error: 'user_id and partner_id are required' });
      }
      const messages = await MessageV2Model.getConversationHistory(userId, partnerId, limit, offset);
      return res.status(200).json(messages);
    } catch (error) {
      console.error('[MessageV2Controller] getMessageHistory error:', error);
      return res.status(500).json({ error: 'Failed to fetch message history' });
    }
  }

  static async sendMessage(req, res) {
    try {
      const sender_id = req.user?.id || req.body.sender_id;
      const { receiver_id, message_text } = req.body;
      if (!sender_id || !receiver_id || !message_text?.trim()) {
        return res.status(400).json({ error: 'sender_id, receiver_id, and message_text are required' });
      }

      if (!(await canMessage(sender_id, receiver_id))) {
        return res.status(403).json({ error: 'You are not allowed to message this user.' });
      }

      const savedMessage = await MessageV2Model.saveMessage({
        sender_id,
        receiver_id,
        message_text: message_text.trim(),
      });
      return res.status(201).json(savedMessage);
    } catch (error) {
      console.error('[MessageV2Controller] sendMessage error:', error);
      return res.status(500).json({ error: 'Failed to send message' });
    }
  }

  static async markRead(req, res) {
    try {
      const receiver_id = req.user?.id || req.body.receiver_id;
      const { sender_id } = req.body;
      if (!sender_id || !receiver_id) {
        return res.status(400).json({ error: 'sender_id and receiver_id are required' });
      }
      const affected = await MessageV2Model.markMessagesAsRead(sender_id, receiver_id);
      return res.status(200).json({ success: true, count: affected });
    } catch (error) {
      console.error('[MessageV2Controller] markRead error:', error);
      return res.status(500).json({ error: 'Failed to mark messages as read' });
    }
  }

  static async getRecipients(req, res) {
    try {
      const currentUserId = req.user?.id || req.query.user_id || 0;
      const role = req.query.role;
      const recipients = await MessageV2Model.getRecipientsByRole(role, currentUserId);
      return res.status(200).json(recipients);
    } catch (error) {
      console.error('[MessageV2Controller] getRecipients error:', error);
      return res.status(500).json({ error: 'Failed to fetch recipients' });
    }
  }
}

module.exports = MessageV2Controller;
