import Chat from "../Models/chatModel.js";
import Message from "../Models/messageModel.js";
import Appointment from "../Models/appointmentModel.js";
import Notification from "../Models/notificationModel.js";
import multer from "multer";
import cloudinary from "../cloudinary.js";
import { PassThrough } from "stream";

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
  limits: { fileSize: 50 * 1024 * 1024 },
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
      let thumbnailUrl = null;
      let fileType = null;
      let publicId = null;

      if (file) {
        const isPDF = file.mimetype === "application/pdf";
        publicId = `${senderId}_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9]/g, "_")}`;

        try {
          const uploadResult = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              {
                folder: `messages/${chatId}`,
                public_id: publicId,
                resource_type: isPDF ? "raw" : "auto",
                transformation: isPDF ? [] : [{ quality: "auto" }],
              },
              (error, result) => {
                if (error) {
                  console.error("Cloudinary upload error:", error);
                  return reject(error);
                }
                resolve(result);
              }
            );
            stream.end(file.buffer);
          });

          fileUrl = uploadResult.secure_url;
          fileType = isPDF ? "pdf" : "image";
          thumbnailUrl = isPDF
            ? cloudinary.url(publicId, {
                resource_type: "image",
                format: "jpg",
                transformation: [{ page: 1 }, { quality: "auto" }],
              })
            : fileUrl;
        } catch (error) {
          console.error("File upload error:", error);
          return res.status(500).json({ message: "Failed to upload file", error: error.message });
        }
      }

      const message = new Message({
        chat_id: chatId,
        sender_id: senderId,
        content: content || null,
        file_url: fileUrl,
        thumbnail_url: thumbnailUrl,
        file_type: fileType,
        public_id: publicId,
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

      res.status(200).json({
        message: "Message sent successfully",
        message: populatedMessage,
      });
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
];

export const editMessage = async (req, res) => {
  const { chatId, messageId } = req.params;
  const { content } = req.body;
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
      return res.status(403).json({ message: "You can only edit your own messages" });
    }

    if (message.file_url) {
      return res.status(400).json({ message: "Cannot edit messages with files" });
    }

    message.content = content;
    message.isEdited = true;
    message.updatedAt = new Date();
    await message.save();

    const populatedMessage = await Message.findById(message._id)
      .populate("sender_id", "name profile_image")
      .populate("replyTo", "content sender_id");

    const io = req.app.get("io");
    io.to(chatId).emit("message_updated", populatedMessage);

    res.status(200).json({ message: "Message updated successfully", message: populatedMessage });
  } catch (error) {
    console.error("Error editing message:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

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

    message.content = "This message was deleted";
    message.isDeleted = true;
    message.file_url = null;
    message.thumbnail_url = null;
    message.file_type = null;
    message.public_id = null;
    await message.save();

    const populatedDeletedMessage = await Message.findById(message._id)
      .populate("sender_id", "name profile_image")
      .populate("replyTo", "content sender_id");

    const io = req.app.get("io");
    io.to(chatId).emit("message_deleted", populatedDeletedMessage);

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

export const downloadFile = async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user._id;

  try {
    const message = await Message.findById(messageId).populate("chat_id");
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    const chat = message.chat_id;
    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    if (
      chat.patient_id.toString() !== userId.toString() &&
      chat.healthcare_id.toString() !== userId.toString()
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    if (!message.file_url || message.file_type !== "pdf") {
      return res.status(400).json({ message: "No PDF file associated with this message" });
    }

    if (!message.public_id) {
      return res.status(400).json({ message: "No public ID associated with this message" });
    }

    const pdfUrl = cloudinary.url(message.public_id, {
      resource_type: "raw",
      sign_url: true,
      attachment: true,
      flags: "attachment",
    });

    const fileResponse = await fetch(pdfUrl, {
      method: "GET",
      headers: { Accept: "application/pdf" },
    });

    if (!fileResponse.ok) {
      throw new Error(`Failed to fetch file from Cloudinary: ${fileResponse.statusText}`);
    }

    const contentType = fileResponse.headers.get("content-type");
    if (!contentType || !contentType.includes("application/pdf")) {
      throw new Error("Received file is not a PDF");
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="document-${messageId}.pdf"`);

    const stream = new PassThrough();
    fileResponse.body.pipe(stream);
    stream.pipe(res);
  } catch (error) {
    console.error("Error downloading file:", error);
    res.status(500).json({ message: "Failed to download file", error: error.message });
  }
};