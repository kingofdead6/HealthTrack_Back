import mongoose from "mongoose";

const chatSchema = new mongoose.Schema({
  patient_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  healthcare_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  appointment_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "Appointment" }],
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Chat", chatSchema);