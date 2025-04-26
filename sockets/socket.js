import { Server } from "socket.io";
import Message from "../Models/messageModel.js";
import Notification from "../Models/notificationModel.js";
import Chat from "../Models/chatModel.js";

const setupSocket = (server, app) => {
  const io = new Server(server, {
    cors: {
      origin: "http://localhost:5173",
      methods: ["GET", "POST"],
    },
  });

  const users = new Map();
  app.set("users", users);

  io.on("connection", (socket) => {
    socket.on("register", (userId) => {
      users.set(userId, socket.id);
    });

    socket.on("join_chat", (chatId) => {
      socket.join(chatId);
    });

    socket.on("send_message", async ({ chatId, senderId, content, tempId }) => {
      try {
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

        const message = new Message({
          chat_id: chatId,
          sender_id: senderId,
          content,
          file_url: null,
          file_type: null,
        });
        await message.save();

        const populatedMessage = await Message.findById(message._id).populate(
          "sender_id",
          "name profile_image"
        );

        const messagePayload = {
          ...populatedMessage.toObject(),
          chat_id: chatId,
          tempId,
        };
        io.to(chatId).emit("receive_message", messagePayload);

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

        const recipientSocket = users.get(recipientId.toString());
        if (recipientSocket) {
          io.to(recipientSocket).emit("receive_notification", notification);
        }
      } catch (error) {
        console.error("Error in send_message:", error);
      }
    });

    socket.on("update_message", async ({ chatId, message }) => {
      try {
        io.to(chatId).emit("message_updated", message);
      } catch (error) {
        console.error("Error in update_message:", error);
      }
    });

    socket.on("mark_messages_seen", async ({ chatId, userId }) => {
      try {
        const messages = await Message.find({
          chat_id: chatId,
          sender_id: { $ne: userId },
          seenBy: { $nin: [userId] },
        });

        await Message.updateMany(
          { _id: { $in: messages.map((m) => m._id) } },
          { $addToSet: { seenBy: userId } }
        );

        messages.forEach((message) => {
          io.to(chatId).emit("message_seen", { messageId: message._id, userId });
        });
      } catch (error) {
        console.error("Error in mark_messages_seen:", error);
      }
    });

    socket.on("mark_messages_read", async ({ chatId, userId }) => {
      try {
        await Message.updateMany(
          { chat_id: chatId, sender_id: { $ne: userId }, read: false },
          { read: true }
        );
        io.to(chatId).emit("messages_read", { chatId });
      } catch (error) {
        console.error("Error in mark_messages_read:", error);
      }
    });

    socket.on("mark_notifications_read", async ({ chatId, userId }) => {
      try {
        await Notification.updateMany(
          { related_id: chatId, user_id: userId, read: false },
          { read: true }
        );
        io.to(chatId).emit("notifications_read", { chatId });
      } catch (error) {
        console.error("Error in mark_notifications_read:", error);
      }
    });

    socket.on("disconnect", () => {
      for (let [userId, socketId] of users.entries()) {
        if (socketId === socket.id) {
          users.delete(userId);
          console.log(`User ${userId} disconnected`);
          break;
        }
      }
    });
  });

  return io;
};

export default setupSocket;