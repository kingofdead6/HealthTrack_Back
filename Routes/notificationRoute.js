import express from "express";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  deleteAllNotifications,
} from "../Controllers/notificationController.js";
import authMiddleware from "../Middleware/authMiddleware.js";

const router = express.Router();

router.get("/", authMiddleware, getNotifications);
router.put("/:notificationId/read", authMiddleware, markNotificationRead);
router.put("/read-all", authMiddleware, markAllNotificationsRead);
router.delete("/delete-all", authMiddleware, deleteAllNotifications); 
router.delete("/:notificationId", authMiddleware, deleteNotification);

export default router;