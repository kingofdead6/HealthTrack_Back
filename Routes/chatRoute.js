import express from "express";
import {
  createChat,
  getUserChats,
  getChatMessages,
  sendMessage,
} from "../Controllers/chatController.js";
import authMiddleware from "../Middleware/authMiddleware.js";

const router = express.Router();

router.post("/", authMiddleware, createChat);
router.get("/", authMiddleware, getUserChats);
router.get("/:chatId/messages", authMiddleware, getChatMessages);
router.post("/:chatId/message", authMiddleware, sendMessage);

export default router;