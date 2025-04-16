import Chat from "../Models/chatModel.js";
import Message from "../Models/messageModel.js";
import Appointment from "../Models/appointmentModel.js";
import userModel from "../Models/userModel.js";
import Notification from "../Models/notificationModel.js";
import multer from "multer";
import cloudinary from "../cloudinary.js";

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "application/pdf"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, and PDF files are allowed"), false);
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

export const createChat = async (req, res) => {
  const { appointmentId } = req.body;
  try {
    const appointment = await Appointment.findById(appointmentId)
      .populate("patient_id")
      .populate("user_id");
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }
    if (appointment.status !== "active") {
      return res.status(400).json({ message: "Chat can only be created for active appointments" });
    }

    const existingChat = await Chat.findOne({
      patient_id: appointment.patient_id._id,
      healthcare_id: appointment.user_id._id,
    });
    if (existingChat) {
      existingChat.appointment_ids = existingChat.appointment_ids || [];
      if (!existingChat.appointment_ids.includes(appointmentId)) {
        existingChat.appointment_ids.push(appointmentId);
        await existingChat.save();
      }
      return res.status(200).json({ message: "Chat already exists", chat: existingChat });
    }

    const chat = new Chat({
      patient_id: appointment.patient_id._id,
      healthcare_id: appointment.user_id._id,
      appointment_ids: [appointmentId],
    });
    await chat.save();

    res.status(201).json({ message: "Chat created successfully", chat });
  } catch (error) {
    console.error("Error creating chat:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getUserChats = async (req, res) => {
  try {
    const userId = req.user._id;

    const chats = await Chat.find({
      $or: [{ patient_id: userId }, { healthcare_id: userId }],
    })
      .populate("patient_id", "name profile_image")
      .populate("healthcare_id", "name profile_image")
      .populate({
        path: "appointment_ids",
        select: "date time",
      })
      .lean();

    const chatsWithDetails = await Promise.all(
      chats.map(async (chat) => {
        const lastMessage = await Message.findOne({ chat_id: chat._id })
          .sort({ createdAt: -1 })
          .select("content file_url file_type createdAt")
          .lean();

        const unreadCount = await Message.countDocuments({
          chat_id: chat._id,
          sender_id: { $ne: userId },
          read: false,
        });

        return {
          ...chat,
          lastMessage: lastMessage
            ? lastMessage.file_url
              ? `[${lastMessage.file_type === "pdf" ? "PDF" : "Image"}] ${lastMessage.content || ""}`
              : lastMessage.content || "No messages yet"
            : "No messages yet",
          lastMessageTime: lastMessage ? lastMessage.createdAt : null,
          unreadCount,
        };
      })
    );

    res.status(200).json(chatsWithDetails);
  } catch (error) {
    console.error("Error fetching chats:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getChatMessages = async (req, res) => {
  const { chatId } = req.params;
  try {
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }
    if (
      chat.patient_id.toString() !== req.user._id.toString() &&
      chat.healthcare_id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const messages = await Message.find({ chat_id: chatId })
      .populate("sender_id", "name profile_image")
      .populate("replyTo", "content sender_id")
      .sort({ createdAt: 1 });

    await Message.updateMany(
      { chat_id: chatId, sender_id: { $ne: req.user._id }, read: false },
      { read: true }
    );

    res.status(200).json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const sendMessage = [
  upload.single("file"),
  async (req, res) => {
    const { chatId } = req.params;
    const { content, tempId, replyTo } = req.body;
    const senderId = req.user._id;
    const file = req.file;

    try {
      if (!chatId) {
        return res.status(400).json({ message: "Chat ID is required" });
      }

      const chat = await Chat.findById(chatId)
        .populate("patient_id", "name")
        .populate("healthcare_id", "name");
      if (!chat) {
        return res.status(404).json({ message: "Chat not found" });
      }

      if (
        chat.patient_id._id.toString() !== senderId.toString() &&
        chat.healthcare_id._id.toString() !== senderId.toString()
      ) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      let fileUrl = null;
      let fileType = null;
      if (file) {
        const resourceType = file.mimetype === "application/pdf" ? "raw" : "image";
        const allowedFormats = resourceType === "image" ? ["jpg", "png"] : ["pdf"];
        const publicId = `${senderId}_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9]/g, "_")}${
          resourceType === "raw" ? ".pdf" : ""
        }`;

        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: `messages/${chatId}`,
              public_id: publicId,
              resource_type: resourceType,
              allowed_formats: allowedFormats,
            },
            (error, result) => {
              if (error) {
                return reject(error);
              }
              resolve(result);
            }
          );
          stream.end(file.buffer);
        });

        fileUrl = uploadResult.secure_url;
        fileType = resourceType === "image" ? "image" : "pdf";
      }

      const message = new Message({
        chat_id: chatId,
        sender_id: senderId,
        content: content || null,
        file_url: fileUrl,
        file_type: fileType,
        replyTo: replyTo || null,
        seenBy: [senderId],
      });
      await message.save();

      const populatedMessage = await Message.findById(message._id)
        .populate("sender_id", "name profile_image")
        .populate("replyTo", "content sender_id");

      const io = req.app.get("io");
      const messagePayload = {
        ...populatedMessage.toObject(),
        chat_id: chatId,
        tempId,
      };
      io.to(chatId).emit("receive_message", messagePayload);

      const recipientId =
        chat.patient_id._id.toString() === senderId.toString()
          ? chat.healthcare_id._id
          : chat.patient_id._id;
      const senderName =
        chat.patient_id._id.toString() === senderId.toString()
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

      const users = req.app.get("users");
      const recipientSocket = users.get(recipientId.toString());
      if (recipientSocket) {
        io.to(recipientSocket).emit("receive_notification", notification);
      }

      res.status(201).json({
        message: "Message sent successfully",
        message: populatedMessage,
      });
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
];

export const deleteMessage = async (req, res) => {
  const { chatId, messageId } = req.params;
  const userId = req.user._id;

  try {
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    if (
      chat.patient_id.toString() !== userId.toString() &&
      chat.healthcare_id.toString() !== userId.toString()
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    if (message.sender_id.toString() !== userId.toString()) {
      return res.status(403).json({ message: "You can only delete your own messages" });
    }

    await Message.deleteOne({ _id: messageId });

    const io = req.app.get("io");
    io.to(chatId).emit("message_deleted", { messageId });

    res.status(200).json({ message: "Message deleted successfully" });
  } catch (error) {
    console.error("Error deleting message:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const markMessageSeen = async (req, res) => {
  const { chatId } = req.params;
  const { messageIds } = req.body;
  const userId = req.user._id;

  try {
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    if (
      chat.patient_id.toString() !== userId.toString() &&
      chat.healthcare_id.toString() !== userId.toString()
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    await Message.updateMany(
      { _id: { $in: messageIds }, chat_id: chatId },
      { $addToSet: { seenBy: userId } }
    );

    const io = req.app.get("io");
    messageIds.forEach((messageId) => {
      io.to(chatId).emit("message_seen", { messageId, userId });
    });

    res.status(200).json({ message: "Messages marked as seen" });
  } catch (error) {
    console.error("Error marking messages as seen:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};