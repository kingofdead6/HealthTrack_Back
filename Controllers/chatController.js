import Chat from "../Models/chatModel.js";
import Message from "../Models/messageModel.js";
import Appointment from "../Models/appointmentModel.js";
import userModel from "../Models/userModel.js";
import multer from "multer";
import path from "path";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "Uploads/messages/");
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "video/mp4",
      "video/mpeg",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type"), false);
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
          .select("content createdAt")
          .lean();

        const unreadCount = await Message.countDocuments({
          chat_id: chat._id,
          sender_id: { $ne: userId },
          read: false,
        });

        return {
          ...chat,
          lastMessage: lastMessage ? lastMessage.content : "No messages yet",
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
      const { chatId } = req.params; // Use params for chatId
      const { content } = req.body;
      const senderId = req.user._id;
      const file = req.file;
  
      // Debugging: Log the incoming request
      console.log("sendMessage called with:", { chatId, content, senderId, file });
  
      try {
        // Validate chatId
        if (!chatId) {
          console.error("Missing chatId");
          return res.status(400).json({ message: "Chat ID is required" });
        }
  
        const chat = await Chat.findById(chatId)
          .populate("patient_id", "name")
          .populate("healthcare_id", "name");
        if (!chat) {
          console.error("Chat not found for ID:", chatId);
          return res.status(404).json({ message: "Chat not found" });
        }
  
        if (
          chat.patient_id._id.toString() !== senderId.toString() &&
          chat.healthcare_id._id.toString() !== senderId.toString()
        ) {
          console.error("Unauthorized access attempt by:", senderId);
          return res.status(403).json({ message: "Unauthorized" });
        }
  
        let fileUrl = null;
        let fileType = null;
        if (file) {
          fileUrl = `/Uploads/messages/${file.filename}`;
          if (file.mimetype.startsWith("image/")) fileType = "image";
          else if (file.mimetype.startsWith("video/")) fileType = "video";
          else if (file.mimetype === "application/pdf") fileType = "pdf";
          else fileType = "file";
        }
  
        const message = new Message({
          chat_id: chatId,
          sender_id: senderId,
          content: content || null,
          file_url: fileUrl,
          file_type: fileType,
        });
        await message.save();
  
        const populatedMessage = await Message.findById(message._id)
          .populate("sender_id", "name profile_image");
  
        const io = req.app.get("io");
        io.to(chatId).emit("receive_message", populatedMessage);
  
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
        });
        await notification.save();
  
        const users = req.app.get("users");
        const recipientSocket = users.get(recipientId.toString());
        if (recipientSocket) {
          io.to(recipientSocket).emit("receive_notification", notification);
        }
  
        res.status(201).json({ message: "Message sent successfully", message: populatedMessage });
      } catch (error) {
        console.error("Error sending message:", error);
        res.status(500).json({ message: "Server error", error: error.message });
      }
    },
  ];