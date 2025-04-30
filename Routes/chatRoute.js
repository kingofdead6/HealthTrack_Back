import express from "express";
import {
  createChat,
  getUserChats,
  getChatMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  markMessageSeen,
  downloadFile,
  deleteChat,
} from "../Controllers/chatController.js";
import authMiddleware from "../Middleware/authMiddleware.js";

const router = express.Router();

router.post("/", authMiddleware, createChat);
router.get("/", authMiddleware, getUserChats);
router.get("/:chatId/messages", authMiddleware, getChatMessages);
router.post("/:chatId/message", authMiddleware, sendMessage);
router.put("/:chatId/messages/:messageId", authMiddleware, editMessage);
router.delete("/:chatId/messages/:messageId", authMiddleware, deleteMessage);
router.delete("/:chatId", authMiddleware, deleteChat);
router.post("/:chatId/messages/seen", authMiddleware, markMessageSeen);
router.get("/messages/:messageId/download", authMiddleware, downloadFile);

export default router;