import express from "express";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../Controllers/notificationController.js";
import authMiddleware from "../Middleware/authMiddleware.js";

const router = express.Router();

router.get("/", authMiddleware, getNotifications);
router.put("/:notificationId/read", authMiddleware, markNotificationRead);
router.put("/read-all", authMiddleware, markAllNotificationsRead);

export default router;