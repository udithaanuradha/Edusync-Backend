const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const jwt = require('jsonwebtoken');
const redisConfig = require('../config/redis');
const MessageV2Model = require('../models/MessageV2Model');
const GroupConversationV2Model = require('../models/GroupConversationV2Model');
const { canMessage } = require('../utils/chatPermissionsV2');

const groupConversationRoom = (conversationId) => `room:conversation_${conversationId}`;

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';
const memoryOnlineUsers = new Set();
const userSocketsMap = new Map(); // userId -> Set of socket IDs

function setupSocketV2(httpServer, corsOptions = {}) {
  const io = new Server(httpServer, {
    cors: corsOptions.cors || {
      origin: '*',
      methods: ['GET', 'POST', 'PATCH'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Attach Redis adapter if Redis is online
  setTimeout(() => {
    if (redisConfig.isRedisAvailable && redisConfig.pubClient && redisConfig.subClient) {
      try {
        io.adapter(createAdapter(redisConfig.pubClient, redisConfig.subClient));
        console.log('⚡ Redis Adapter attached to Socket.IO.');
      } catch (err) {
        console.warn('⚠️ Redis adapter attach warning:', err.message);
      }
    }
  }, 1000);

  // Authentication Middleware
  io.use(async (socket, next) => {
    try {
      const authHeader = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
      const userIdFallback = socket.handshake.auth?.userId;

      let user = null;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
          user = jwt.verify(token, JWT_SECRET);
        } catch (e) {
          if (userIdFallback) {
            user = {
              id: Number(userIdFallback),
              role: socket.handshake.auth?.userRole,
              name: socket.handshake.auth?.userName,
            };
          }
        }
      } else if (userIdFallback) {
        user = {
          id: Number(userIdFallback),
          role: socket.handshake.auth?.userRole,
          name: socket.handshake.auth?.userName,
        };
      }

      if (!user || !user.id) {
        return next(new Error('Authentication failed'));
      }

      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Internal Auth Error'));
    }
  });

  // Socket Connection Handlers
  io.on('connection', async (socket) => {
    const userId = socket.user.id;
    const userRoom = `room:user_${userId}`;

    socket.join(userRoom);
    console.log(`🟢 [SocketV2] User ${userId} (${socket.user.name || 'User'}) connected on socket ${socket.id}`);

    // Track online user
    memoryOnlineUsers.add(userId);
    if (!userSocketsMap.has(userId)) {
      userSocketsMap.set(userId, new Set());
    }
    userSocketsMap.get(userId).add(socket.id);

    // Broadcast online event
    socket.broadcast.emit('user:online', { userId });

    // Send active online users list to connected user
    socket.emit('presence:sync', Array.from(memoryOnlineUsers));

    // Join every group conversation (supervisor<->group, mentor<->group)
    // this user currently belongs to, so group sends can reach them with a
    // single room emit instead of a per-recipient fan-out.
    try {
      const groupConversations = await GroupConversationV2Model.getMyConversations(userId);
      groupConversations.forEach((c) => socket.join(groupConversationRoom(c.conversation_id)));
    } catch (err) {
      console.warn('⚠️ [SocketV2] Failed joining group conversation rooms:', err.message);
    }

    // Send Message
    socket.on('message:send', async (payload, callback) => {
      try {
        const { receiver_id, message_text } = payload;
        if (!receiver_id || !message_text?.trim()) {
          if (typeof callback === 'function') callback({ success: false, error: 'Invalid payload' });
          return;
        }

        if (!(await canMessage(userId, parseInt(receiver_id, 10)))) {
          if (typeof callback === 'function') callback({ success: false, error: 'You are not allowed to message this user.' });
          return;
        }

        console.log(`💬 [SocketV2] Saving message from ${userId} to ${receiver_id}: "${message_text.substring(0, 30)}..."`);

        const savedMessage = await MessageV2Model.saveMessage({
          sender_id: userId,
          receiver_id: parseInt(receiver_id, 10),
          message_text: message_text.trim(),
        });

        console.log(`✅ [SocketV2] Message saved to messages_v2 (ID: ${savedMessage.id})`);

        // Deliver in real-time to receiver
        io.to(`room:user_${receiver_id}`).emit('message:received', savedMessage);

        if (typeof callback === 'function') {
          callback({ success: true, data: savedMessage });
        }
      } catch (error) {
        console.error('❌ [SocketV2] Error saving message:', error);
        if (typeof callback === 'function') callback({ success: false, error: error.message });
      }
    });

    // Send Group Message (supervisor<->group, mentor<->group) — a separate
    // event name from message:send so the existing 1:1 handler above is
    // never touched by this.
    socket.on('group:send', async (payload, callback) => {
      try {
        const conversationId = Number(payload?.conversation_id);
        const messageText = payload?.message_text;
        if (!conversationId || !messageText?.trim()) {
          if (typeof callback === 'function') callback({ success: false, error: 'Invalid payload' });
          return;
        }

        if (!(await GroupConversationV2Model.isMember(conversationId, userId))) {
          if (typeof callback === 'function') callback({ success: false, error: 'Not a member of this conversation' });
          return;
        }

        const savedMessage = await GroupConversationV2Model.saveMessage(
          conversationId,
          userId,
          messageText.trim()
        );

        io.to(groupConversationRoom(conversationId)).emit('group:message:received', savedMessage);

        if (typeof callback === 'function') {
          callback({ success: true, data: savedMessage });
        }
      } catch (error) {
        console.error('❌ [SocketV2] Error saving group message:', error);
        if (typeof callback === 'function') callback({ success: false, error: error.message });
      }
    });

    // Mark as Read
    socket.on('message:read', async ({ sender_id }) => {
      if (!sender_id) return;
      try {
        await MessageV2Model.markMessagesAsRead(sender_id, userId);
        io.to(`room:user_${sender_id}`).emit('message:read_receipt', {
          sender_id: parseInt(sender_id, 10),
          reader_id: userId,
        });
      } catch (e) {
        console.error('❌ [SocketV2] Error marking read:', e);
      }
    });

    // Typing Indicators
    socket.on('typing:start', ({ receiver_id }) => {
      if (receiver_id) {
        socket.to(`room:user_${receiver_id}`).emit('typing:update', { sender_id: userId, is_typing: true });
      }
    });

    socket.on('typing:stop', ({ receiver_id }) => {
      if (receiver_id) {
        socket.to(`room:user_${receiver_id}`).emit('typing:update', { sender_id: userId, is_typing: false });
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`🔴 [SocketV2] User ${userId} disconnected on socket ${socket.id}`);
      if (userSocketsMap.has(userId)) {
        userSocketsMap.get(userId).delete(socket.id);
        if (userSocketsMap.get(userId).size === 0) {
          userSocketsMap.delete(userId);
          memoryOnlineUsers.delete(userId);
          socket.broadcast.emit('user:offline', { userId });
        }
      }
    });
  });

  return io;
}

module.exports = { setupSocketV2 };
