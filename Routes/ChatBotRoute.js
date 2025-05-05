import express from 'express';
const router = express.Router();
import handleChatMessage from '../Controllers/ChatBotController.js';

router.post('/', handleChatMessage);

export default router;