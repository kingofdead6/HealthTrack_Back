import { Server } from "socket.io";
import Message from "../Models/messageModel.js";
import Notification from "../Models/notificationModel.js";
import Chat from "../Models/chatModel.js";

const setupSocket = (server, app) => { // Add app parameter
  const io = new Server(server, {
    cors: {
      origin: "http://localhost:5173",
      methods: ["GET", "POST"],
    },
  });

  const users = new Map(); // Define users Map
  app.set("users", users); // Store users Map in app

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("register", (userId) => {
      users.set(userId, socket.id);
      console.log(`User ${userId} registered with socket ${socket.id}`);
    });

    socket.on("join_chat", (chatId) => {
      socket.join(chatId);
      console.log(`Socket ${socket.id} joined chat ${chatId}`);
    });

    socket.on("send_message", async ({ chatId, senderId, content, fileUrl, fileType }) => {
      try {
        const message = new Message({
          chat_id: chatId,
          sender_id: senderId,
          content,
          file_url: fileUrl,
          file_type: fileType || null,
        });
        await message.save();

        const populatedMessage = await Message.findById(message._id)
          .populate("sender_id", "name profile_image");

        io.to(chatId).emit("receive_message", populatedMessage);

        const chat = await Chat.findById(chatId)
          .populate("patient_id", "name")
          .populate("healthcare_id", "name");
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
        });
        await notification.save();

        const recipientSocket = users.get(recipientId.toString());
        if (recipientSocket) {
          io.to(recipientSocket).emit("receive_notification", notification);
        }
      } catch (error) {
        console.error("Error sending message:", error);
      }
    });

    socket.on("mark_messages_read", async ({ chatId, userId }) => {
      await Message.updateMany(
        { chat_id: chatId, sender_id: { $ne: userId }, read: false },
        { read: true }
      );
      io.to(chatId).emit("messages_read", { chatId });
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