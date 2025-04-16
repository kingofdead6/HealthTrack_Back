import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  type: {
    type: String,
    enum: ["appointment_request", "appointment_accepted", "new_message", "appointment_rejected"],
    required: true,
  },
  message: { type: String, required: true },
  related_id: { type: mongoose.Schema.Types.ObjectId, required: true }, 
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Notification", notificationSchema);