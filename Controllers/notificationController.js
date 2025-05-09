import Notification from "../Models/notificationModel.js";

// Fetch the notifications for the authenticated user
export const getNotifications = async (req, res) => {
  try {
    // Retrieve and sort notifications by newest first
    const notifications = await Notification.find({ user_id: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json(notifications);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Mark a specific notification as read
export const markNotificationRead = async (req, res) => {
  const { notificationId } = req.params;

  try {
    // Find notification by ID
    const notification = await Notification.findById(notificationId);

    // If notification doesn't exist, return 404
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    // Check if the notification belongs to the requesting user
    if (notification.user_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Update the notification's read status
    notification.read = true;
    await notification.save();

    res.status(200).json({ message: "Notification marked as read" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Mark all unread notifications as read for the authenticated user
export const markAllNotificationsRead = async (req, res) => {
  try {
    // Bulk update: set read = true for all unread notifications of the user
    const result = await Notification.updateMany(
      { user_id: req.user._id, read: false },
      { read: true }
    );

    res.status(200).json({ message: "All notifications marked as read" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Delete a specific notification
export const deleteNotification = async (req, res) => {
  const { notificationId } = req.params;

  try {
    // Find the notification by ID
    const notification = await Notification.findById(notificationId);

    // If not found, return 404
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    // Ensure the user owns this notification
    if (notification.user_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Delete the notification
    await Notification.deleteOne({ _id: notificationId });

    res.status(200).json({ message: "Notification deleted" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Delete all notifications for the authenticated user
export const deleteAllNotifications = async (req, res) => {
  try {
    // Remove all notifications belonging to the user
    const result = await Notification.deleteMany({ user_id: req.user._id });

    res.status(200).json({ message: "All notifications deleted" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};
