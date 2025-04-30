import mongoose from "mongoose";

const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  healthcare_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true,},
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Announcement", announcementSchema);