import { Server } from "socket.io";
import Message from "../Models/messageModel.js";
import Notification from "../Models/notificationModel.js";
import Chat from "../Models/chatModel.js";

// Initialize Socket.IO server and handle real-time events
const setupSocket = (server, app) => {
  // Create Socket.IO instance with CORS enabled
  const io = new Server(server, {
    cors: {},
  });

  // Store user ID to socket ID mappings
  const users = new Map();
  app.set("users", users);

  // Handle socket connection
  io.on("connection", (socket) => {
    // Register user with their socket ID
    socket.on("register", (userId) => {
      users.set(userId, socket.id);
    });

    // Join a chat room
    socket.on("join_chat", (chatId) => {
      socket.join(chatId);
    });

    // Handle sending a new message
    socket.on("send_message", async ({ chatId, senderId, content, tempId }) => {
        // Verify chat exists and sender is a participant
        const chat = await Chat.findById(chatId)
          .populate("patient_id", "name")
          .populate("healthcare_id", "name");
        if (!chat) {
          return;
        }
        if (
          chat.patient_id._id.toString() !== senderId &&
          chat.healthcare_id._id.toString() !== senderId
        ) {
          return;
        }

        // Create and save new message
        const message = new Message({
          chat_id: chatId,
          sender_id: senderId,
          content,
          file_url: null,
          file_type: null,
        });
        await message.save();

        // Populate sender details for the message
        const populatedMessage = await Message.findById(message._id).populate(
          "sender_id",
          "name profile_image"
        );

        // Broadcast message to chat room
        const messagePayload = {
          ...populatedMessage.toObject(),
          chat_id: chatId,
          tempId,
        };
        io.to(chatId).emit("receive_message", messagePayload);

        // Create and save notification for recipient
        const recipientId =
          chat.patient_id._id.toString() === senderId
            ? chat.healthcare_id._id
            : chat.patient_id._id;
        const senderName =
          chat.patient_id._id.toString() === senderId
            ? chat.patient_id.name
            : chat.healthcare_id.name;

        const notification = new Notification({
          user_id: recipientId,
          type: "new_message",
          message: `New message from ${senderName}`,
          related_id: chatId,
          read: false,
        });
        await notification.save();

        // Send notification to recipient if online
        const recipientSocket = users.get(recipientId.toString());
        if (recipientSocket) {
          io.to(recipientSocket).emit("receive_notification", notification);
        }
    });

    // Broadcast updated message to chat room
    socket.on("update_message", async ({ chatId, message }) => {
        io.to(chatId).emit("message_updated", message);
    });

    // Mark messages as seen by user
    socket.on("mark_messages_seen", async ({ chatId, userId }) => {
        const messages = await Message.find({
          chat_id: chatId,
          sender_id: { $ne: userId },
          seenBy: { $nin: [userId] },
        });

        await Message.updateMany(
          { _id: { $in: messages.map((m) => m._id) } },
          { $addToSet: { seenBy: userId } }
        );

        // Notify chat room of seen messages
        messages.forEach((message) => {
          io.to(chatId).emit("message_seen", { messageId: message._id, userId });
        });
    });

    // Mark messages as read
    socket.on("mark_messages_read", async ({ chatId, userId }) => {
        await Message.updateMany(
          { chat_id: chatId, sender_id: { $ne: userId }, read: false },
          { read: true }
        );
        io.to(chatId).emit("messages_read", { chatId });
    });

    // Mark notifications as read
    socket.on("mark_notifications_read", async ({ chatId, userId }) => {
        await Notification.updateMany(
          { related_id: chatId, user_id: userId, read: false },
          { read: true }
        );
        io.to(chatId).emit("notifications_read", { chatId });
    });

    // Remove user from map on disconnect
    socket.on("disconnect", () => {
      for (let [userId, socketId] of users.entries()) {
        if (socketId === socket.id) {
          users.delete(userId);
          break;
        }
      }
    });
  });

  return io;
};

export default setupSocket;