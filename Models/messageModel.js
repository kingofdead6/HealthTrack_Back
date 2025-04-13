import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  chat_id: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", required: true },
  sender_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  content: { type: String },
  file_url: { type: String },
  file_type: { type: String, enum: ["image", "video", "file", null] },
  createdAt: { type: Date, default: Date.now },
  read: { type: Boolean, default: false },
});

export default mongoose.model("Message", messageSchema);