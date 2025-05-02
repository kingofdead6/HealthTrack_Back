import express from "express";
const router = express.Router();
import { handleChatMessage } from "../Controllers/ChatBotController.js";

// Route to handle chatbot messages
router.post("/", handleChatMessage);

export default router;