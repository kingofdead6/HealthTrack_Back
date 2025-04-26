import mongoose from "mongoose";

   const UnavailableSlotSchema = new mongoose.Schema({
     healthcare_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
     date: { type: Date, required: true }, // Specific date of unavailability
     startTime: { type: String, required: true }, // Format: "HH:MM"
     endTime: { type: String, required: true }, // Format: "HH:MM"
     reason: { type: String }, // Optional reason for unavailability
   });

   export default mongoose.model("UnavailableSlot", UnavailableSlotSchema);