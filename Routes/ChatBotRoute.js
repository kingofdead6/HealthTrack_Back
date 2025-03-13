import express from 'express';
import { handleChatbotRequest } from '../Controllers/ChatBotController.js';

const router = express.Router();

router.post('/', handleChatbotRequest);

export default router;