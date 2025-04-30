import Chat from "../Models/chatModel.js";
import Message from "../Models/messageModel.js";
import Appointment from "../Models/appointmentModel.js";
import Notification from "../Models/notificationModel.js";
import multer from "multer";
import cloudinary from "../cloudinary.js";
import { PassThrough } from "stream";

// Configure multer for file uploads with restrictions
const upload = multer({
  storage: multer.memoryStorage(), // Store files in memory
  fileFilter: (req, file, cb) => {
    // Allow only specific file types
    const allowedTypes = ["image/jpeg", "image/png", "application/pdf"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, and PDF files are allowed"), false);
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // Limit file size to 50MB
});

// Creates a new chat for an appointment or updates an existing one
export const createChat = async (req, res) => {
  const { appointmentId } = req.body; // Extract appointment ID from request body
  try {
    // Fetch appointment and populate user details
    const appointment = await Appointment.findById(appointmentId)
      .populate("patient_id") // Populate patient details
      .populate("user_id"); // Populate healthcare provider details
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }
    // Ensure appointment is active
    if (appointment.status !== "active") {
      return res.status(400).json({ message: "Chat can only be created for active appointments" });
    }

    // Check if chat already exists between patient and healthcare provider
    const existingChat = await Chat.findOne({
      patient_id: appointment.patient_id._id,
      healthcare_id: appointment.user_id._id,
    });
    if (existingChat) {
      // Update existing chat with new appointment ID if not already included
      existingChat.appointment_ids = existingChat.appointment_ids || [];
      if (!existingChat.appointment_ids.includes(appointmentId)) {
        existingChat.appointment_ids.push(appointmentId);
        await existingChat.save();
      }
      return res.status(200).json({ message: "Chat already exists", chat: existingChat });
    }

    // Create new chat with initial empty deletedBy array
    const chat = new Chat({
      patient_id: appointment.patient_id._id,
      healthcare_id: appointment.user_id._id,
      appointment_ids: [appointmentId],
      deletedBy: [], // Initialize deletedBy array for tracking chat deletions
    });
    await chat.save(); // Save chat to database

    // Respond with created chat
    res.status(201).json({ message: "Chat created successfully", chat });
  } catch (error) {
    // Handle server errors
    res.status(500).json({ message: "Server error" });
  }
};

// Retrieves all chats for the authenticated user with last message and unread count
export const getUserChats = async (req, res) => {
  try {
    const userId = req.user._id; // Get authenticated user ID

    // Fetch chats where user is either patient or healthcare provider and not in deletedBy
    const chats = await Chat.find({
      $or: [{ patient_id: userId }, { healthcare_id: userId }],
      deletedBy: { $ne: userId }, // Exclude chats deleted by the user
    })
      .populate("patient_id", "name profile_image") // Populate patient details
      .populate("healthcare_id", "name profile_image") // Populate healthcare provider details
      .populate({
        path: "appointment_ids",
        select: "date time", // Populate appointment details with date and time
      })
      .lean(); // Convert to plain JavaScript object for performance

    // Process each chat to include last message and unread count
    const chatsWithDetails = await Promise.all(
      chats.map(async (chat) => {
        // Fetch the most recent message for the chat
        const lastMessage = await Message.findOne({ chat_id: chat._id })
          .sort({ createdAt: -1 }) // Sort by latest message
          .select("content file_url file_type createdAt")
          .lean();

        // Count unread messages from other users
        const unreadCount = await Message.countDocuments({
          chat_id: chat._id,
          sender_id: { $ne: userId },
          read: false,
        });

        // Check if users are deleted
        const isPatientDeleted = !chat.patient_id;
        const isHealthcareDeleted = !chat.healthcare_id;

        // Format chat details with last message and deleted user flags
        return {
          ...chat,
          lastMessage: lastMessage
            ? lastMessage.file_url
              ? `[${lastMessage.file_type === "pdf" ? "PDF" : "Image"}] ${lastMessage.content || ""}`
              : lastMessage.content || "No messages yet"
            : "No messages yet",
          lastMessageTime: lastMessage ? lastMessage.createdAt : null,
          unreadCount,
          patient_id: {
            ...chat.patient_id,
            name: isPatientDeleted ? "User deleted" : chat.patient_id.name,
            isDeleted: isPatientDeleted, // Flag for frontend to style deleted user in red
          },
          healthcare_id: {
            ...chat.healthcare_id,
            name: isHealthcareDeleted ? "User deleted" : chat.healthcare_id.name,
            isDeleted: isHealthcareDeleted, // Flag for frontend to style deleted user in red
          },
        };
      })
    );

    // Respond with formatted chats
    res.status(200).json(chatsWithDetails);
  } catch (error) {
    // Handle server errors
    res.status(500).json({ message: "Server error" });
  }
};

// Fetches all messages for a specific chat and marks them as read
export const getChatMessages = async (req, res) => {
  const { chatId } = req.params; // Extract chat ID from URL
  try {
    // Fetch chat and populate user details
    const chat = await Chat.findById(chatId)
      .populate("patient_id", "name profile_image")
      .populate("healthcare_id", "name profile_image");
    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }
    // Verify user is authorized to view chat
    if (
      chat.patient_id?._id.toString() !== req.user._id.toString() &&
      chat.healthcare_id?._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Fetch all messages for the chat
    const messages = await Message.find({ chat_id: chatId })
      .populate({
        path: "sender_id",
        select: "name profile_image", // Populate sender details
      })
      .populate({
        path: "replyTo",
        select: "content sender_id file_url file_type isDeleted",
        populate: {
          path: "sender_id",
          select: "name profile_image", // Populate reply sender details
        },
      }) // Fix: Populate replyTo with file details and isDeleted
      .sort({ createdAt: 1 }) // Sort messages chronologically
      .lean();

    // Add isDeleted flag for deleted users and handle replyTo
    const modifiedMessages = messages.map((message) => ({
      ...message,
      sender_id: {
        ...message.sender_id,
        name: message.sender_id?.name || "User deleted",
        isDeleted: !message.sender_id, // Flag for frontend to style deleted user in red
      },
      replyTo: message.replyTo
        ? {
            ...message.replyTo,
            sender_id: {
              ...message.replyTo.sender_id,
              name: message.replyTo.sender_id?.name || "User deleted",
              isDeleted: !message.replyTo.sender_id, // Flag for frontend to style deleted user in red
            },
            // Fix: Include isDeleted flag for replyTo message
            isDeleted: message.replyTo.isDeleted || false,
          }
        : null,
    }));

    // Mark all unread messages as read
    await Message.updateMany(
      { chat_id: chatId, sender_id: { $ne: req.user._id }, read: false },
      { read: true }
    );

    // Respond with formatted messages
    res.status(200).json(modifiedMessages);
  } catch (error) {
    // Handle server errors
    res.status(500).json({ message: "Server error" });
  }
};

// Sends a new message in a chat, optionally with a file, and notifies the recipient
export const sendMessage = [
  upload.single("file"),
  async (req, res) => {
    const { chatId } = req.params;
    const { content, tempId, replyTo } = req.body;
    const senderId = req.user._id.toString();
    const file = req.file;

    try {
      // Validate chat ID
      if (!chatId) {
        return res.status(400).json({ message: "Chat ID is required" });
      }

      // Fetch and validate chat
      const chat = await Chat.findById(chatId)
        .populate("patient_id", "name profile_image")
        .populate("healthcare_id", "name profile_image");
      if (!chat) {
        return res.status(404).json({ message: "Chat not found" });
      }
      if (
        chat.patient_id?._id.toString() !== senderId &&
        chat.healthcare_id?._id.toString() !== senderId
      ) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Validate replyTo message if provided
      let replyToMessage = null;
      if (replyTo) {
        replyToMessage = await Message.findOne({
          _id: replyTo,
          chat_id: chatId,
        }).populate("sender_id", "name profile_image");
        if (!replyToMessage || replyToMessage.isDeleted) {
          return res.status(400).json({ message: "Cannot reply to an invalid or deleted message" });
        }
      }

      // Handle file upload to Cloudinary
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
                resource_type: isPDF ? "raw" : "image",
                transformation: isPDF ? [] : [{ quality: "auto", fetch_format: "auto" }],
              },
              (error, result) => {
                if (error) return reject(error);
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
          return res.status(500).json({ message: "Failed to upload file", error: error.message });
        }
      }

      // Create new message
      const message = new Message({
        chat_id: chatId,
        sender_id: senderId,
        content: content?.trim() || null,
        file_url: fileUrl,
        thumbnail_url: thumbnailUrl,
        file_type: fileType,
        public_id: publicId,
        replyTo: replyToMessage ? replyToMessage._id : null,
        seenBy: [senderId],
      });
      await message.save();

      // Populate message with sender and reply details
      const populatedMessage = await Message.findById(message._id)
        .populate("sender_id", "name profile_image")
        .populate({
          path: "replyTo",
          select: "content sender_id file_url file_type isDeleted",
          populate: {
            path: "sender_id",
            select: "name profile_image",
          },
        });

      // Format message for response and socket emission
      const modifiedMessage = {
        ...populatedMessage.toObject(),
        sender_id: {
          _id: populatedMessage.sender_id?._id.toString() || senderId,
          name: populatedMessage.sender_id?.name || "User deleted",
          profile_image: populatedMessage.sender_id?.profile_image || null,
          isDeleted: !populatedMessage.sender_id,
        },
        replyTo: populatedMessage.replyTo
          ? {
              _id: populatedMessage.replyTo._id.toString(),
              content: populatedMessage.replyTo.content || null,
              file_url: populatedMessage.replyTo.file_url || null,
              file_type: populatedMessage.replyTo.file_type || null,
              isDeleted: populatedMessage.replyTo.isDeleted || false,
              sender_id: {
                _id: populatedMessage.replyTo.sender_id?._id.toString() || null,
                name: populatedMessage.replyTo.sender_id?.name || "User deleted",
                profile_image: populatedMessage.replyTo.sender_id?.profile_image || null,
                isDeleted: !populatedMessage.replyTo.sender_id,
              },
            }
          : null,
        tempId: tempId || null, // Include tempId for frontend optimistic updates
      };

      // Emit message to all clients in the chat room
      const io = req.app.get("io");
      io.to(chatId).emit("receive_message", modifiedMessage);

      // Create and save notification for recipient
      const recipientId =
        chat.patient_id._id.toString() === senderId
          ? chat.healthcare_id._id.toString()
          : chat.patient_id._id.toString();
      const senderName =
        chat.patient_id._id.toString() === senderId
          ? chat.patient_id?.name || "User deleted"
          : chat.healthcare_id?.name || "User deleted";
      const notification = new Notification({
        user_id: recipientId,
        type: "new_message",
        message: `New message from ${senderName}`,
        related_id: chatId,
        read: false,
      });
      await notification.save();

      // Emit notification to recipient
      const users = req.app.get("users");
      const recipientSocket = users.get(recipientId);
      if (recipientSocket) {
        io.to(recipientSocket).emit("receive_notification", notification);
      }

      // Respond with the sent message
      res.status(200).json({
        message: "Message sent successfully",
        message: modifiedMessage,
      });
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
];

// Edits an existing message's content and notifies the recipient
export const editMessage = async (req, res) => {
  const { chatId, messageId } = req.params;
  const { content } = req.body;
  const userId = req.user._id.toString();

  try {
    const chat = await Chat.findById(chatId)
      .populate("patient_id", "name")
      .populate("healthcare_id", "name");
    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }
    if (
      chat.patient_id?._id.toString() !== userId &&
      chat.healthcare_id?._id.toString() !== userId
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }
    if (message.sender_id.toString() !== userId) {
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
      .populate({
        path: "replyTo",
        select: "content sender_id file_url file_type isDeleted",
        populate: {
          path: "sender_id",
          select: "name profile_image",
        },
      });

    const modifiedMessage = {
      ...populatedMessage.toObject(),
      sender_id: {
        _id: populatedMessage.sender_id?._id.toString() || userId,
        name: populatedMessage.sender_id?.name || "User deleted",
        profile_image: populatedMessage.sender_id?.profile_image || null,
        isDeleted: !populatedMessage.sender_id,
      },
      replyTo: populatedMessage.replyTo
        ? {
            ...populatedMessage.replyTo,
            sender_id: {
              _id: populatedMessage.replyTo.sender_id?._id.toString(),
              name: populatedMessage.replyTo.sender_id?.name || "User deleted",
              isDeleted: !populatedMessage.replyTo.sender_id,
            },
            isDeleted: populatedMessage.replyTo.isDeleted || false,
          }
        : null,
    };

    // Emit to all clients in the chat room
    const io = req.app.get("io");
    io.to(chatId).emit("message_updated", modifiedMessage);

    res.status(200).json({ message: "Message updated successfully", message: modifiedMessage });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Deletes a message and notifies the recipient
export const deleteMessage = async (req, res) => {
  const { chatId, messageId } = req.params;
  const userId = req.user._id.toString();

  try {
    const chat = await Chat.findById(chatId)
      .populate("patient_id", "name")
      .populate("healthcare_id", "name");
    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }
    if (
      chat.patient_id?._id.toString() !== userId &&
      chat.healthcare_id?._id.toString() !== userId
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }
    if (message.sender_id.toString() !== userId) {
      return res.status(403).json({ message: "You can only delete your own messages" });
    }

    // Delete Cloudinary file if it exists
    if (message.public_id) {
      try {
        await cloudinary.uploader.destroy(message.public_id, {
          resource_type: message.file_type === "pdf" ? "raw" : "image",
        });
      } catch (error) {
        return res.status(500).json({ message: "Error deleting file", error: error.message });
      }
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
      .populate({
        path: "replyTo",
        select: "content sender_id file_url file_type isDeleted",
        populate: {
          path: "sender_id",
          select: "name profile_image",
        },
      });

    const modifiedDeletedMessage = {
      ...populatedDeletedMessage.toObject(),
      sender_id: {
        _id: populatedDeletedMessage.sender_id?._id.toString() || userId,
        name: populatedDeletedMessage.sender_id?.name || "User deleted",
        profile_image: populatedDeletedMessage.sender_id?.profile_image || null,
        isDeleted: !populatedDeletedMessage.sender_id,
      },
      replyTo: populatedDeletedMessage.replyTo
        ? {
            ...populatedDeletedMessage.replyTo,
            sender_id: {
              _id: populatedDeletedMessage.replyTo.sender_id?._id.toString(),
              name: populatedDeletedMessage.replyTo.sender_id?.name || "User deleted",
              isDeleted: !populatedDeletedMessage.replyTo.sender_id,
            },
            isDeleted: populatedDeletedMessage.replyTo.isDeleted || false,
          }
        : null,
    };

    // Emit to all clients in the chat room
    const io = req.app.get("io");
    io.to(chatId).emit("message_deleted", modifiedDeletedMessage);

    res.status(200).json({ message: "Message deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Marks specified messages as seen by the user
export const markMessageSeen = async (req, res) => {
  const { chatId } = req.params; // Extract chat ID from URL
  const { messageIds } = req.body; // Extract message IDs to mark as seen
  const userId = req.user._id; // Get authenticated user ID

  try {
    // Fetch chat and verify authorization
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

    // Update messages to include user in seenBy array
    await Message.updateMany(
      { _id: { $in: messageIds }, chat_id: chatId },
      { $addToSet: { seenBy: userId } }
    );

    // Notify via socket for each message
    const io = req.app.get("io");
    messageIds.forEach((messageId) => {
      io.to(chatId).emit("message_seen", { messageId, userId });
    });

    // Respond with success message
    res.status(200).json({ message: "Messages marked as seen" });
  } catch (error) {
    // Handle server errors
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Downloads a PDF file associated with a message
export const downloadFile = async (req, res) => {
  const { messageId } = req.params; // Extract message ID from URL
  const userId = req.user._id; // Get authenticated user ID

  try {
    // Fetch message and associated chat
    const message = await Message.findById(messageId).populate("chat_id");
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }
    const chat = message.chat_id;
    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }
    // Verify user authorization
    if (
      chat.patient_id.toString() !== userId.toString() &&
      chat.healthcare_id.toString() !== userId.toString()
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Validate that message contains a PDF file
    if (!message.file_url || message.file_type !== "pdf") {
      return res.status(400).json({ message: "No PDF file associated with this message" });
    }
    if (!message.public_id) {
      return res.status(400).json({ message: "No public ID associated with this message" });
    }

    // Generate signed URL for PDF download from Cloudinary
    const pdfUrl = cloudinary.url(message.public_id, {
      resource_type: "raw",
      sign_url: true,
      attachment: true,
      flags: "attachment",
    });

    // Fetch PDF file from Cloudinary
    const fileResponse = await fetch(pdfUrl, {
      method: "GET",
      headers: { Accept: "application/pdf" },
    });

    if (!fileResponse.ok) {
      throw new Error(`Failed to fetch file from Cloudinary: ${fileResponse.statusText}`);
    }

    // Verify content type is PDF
    const contentType = fileResponse.headers.get("content-type");
    if (!contentType || !contentType.includes("application/pdf")) {
      throw new Error("Received file is not a PDF");
    }

    // Set response headers for file download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="document-${messageId}.pdf"`);

    // Stream PDF to client
    const stream = new PassThrough();
    fileResponse.body.pipe(stream);
    stream.pipe(res);
  } catch (error) {
    // Handle server errors
    res.status(500).json({ message: "Failed to download file", error: error.message });
  }
};

// Deletes a chat for the user
export const deleteChat = async (req, res) => {
  const { chatId } = req.params; // Extract chat ID from URL
  const userId = req.user._id.toString(); // Get authenticated user ID

  try {
    // Fetch chat and verify authorization
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }
    if (
      chat.patient_id.toString() !== userId &&
      chat.healthcare_id.toString() !== userId
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Add user to deletedBy array to hide chat for them
    chat.deletedBy = [...new Set([...chat.deletedBy, userId])];
    await chat.save();

    // Notify user of chat deletion via socket
    const io = req.app.get("io");
    const users = req.app.get("users");
    const userSocket = users.get(userId);
    if (userSocket) {
      io.to(userSocket).emit("chat_deleted", { chatId });
    }

    // Respond with success message
    res.status(200).json({ message: "Chat deleted successfully" });
  } catch (error) {
    // Handle server errors
    res.status(500).json({ message: "Server error" });
  }
};