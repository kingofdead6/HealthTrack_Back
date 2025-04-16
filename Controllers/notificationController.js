import Notification from "../Models/notificationModel.js";

export const getNotifications = async (req, res) => {
  try {
    console.log("Fetching notifications for user:", req.user._id);
    const notifications = await Notification.find({ user_id: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    console.log("Found notifications:", notifications.length);
    res.status(200).json(notifications);
  } catch (error) {
    console.error("Error fetching notifications:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const markNotificationRead = async (req, res) => {
  const { notificationId } = req.params;
  try {
    console.log("Marking notification as read:", notificationId);
    const notification = await Notification.findById(notificationId);
    if (!notification) {
      console.log("Notification not found:", notificationId);
      return res.status(404).json({ message: "Notification not found" });
    }
    if (notification.user_id.toString() !== req.user._id.toString()) {
      console.log("Unauthorized access to notification:", { user_id: req.user._id, notification_user_id: notification.user_id });
      return res.status(403).json({ message: "Unauthorized" });
    }
    notification.read = true;
    await notification.save();
    res.status(200).json({ message: "Notification marked as read" });
  } catch (error) {
    console.error("Error marking notification read:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    console.log("Marking all notifications as read for user:", req.user._id);
    const result = await Notification.updateMany(
      { user_id: req.user._id, read: false },
      { read: true }
    );
    console.log("Notifications updated:", result.modifiedCount);
    res.status(200).json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error marking all notifications read:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteNotification = async (req, res) => {
  const { notificationId } = req.params;
  try {
    console.log("Deleting notification:", notificationId);
    const notification = await Notification.findById(notificationId);
    if (!notification) {
      console.log("Notification not found:", notificationId);
      return res.status(404).json({ message: "Notification not found" });
    }
    if (notification.user_id.toString() !== req.user._id.toString()) {
      console.log("Unauthorized deletion attempt:", { user_id: req.user._id, notification_user_id: notification.user_id });
      return res.status(403).json({ message: "Unauthorized" });
    }
    await Notification.deleteOne({ _id: notificationId });
    res.status(200).json({ message: "Notification deleted" });
  } catch (error) {
    console.error("Error deleting notification:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteAllNotifications = async (req, res) => {
  try {
    console.log("Deleting all notifications for user:", req.user._id);
    const result = await Notification.deleteMany({ user_id: req.user._id });
    console.log("Notifications deleted:", result.deletedCount);
    res.status(200).json({ message: "All notifications deleted" });
  } catch (error) {
    console.error("Error deleting all notifications:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};