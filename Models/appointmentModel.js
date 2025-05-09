import mongoose from "mongoose";

   const AppointmentSchema = new mongoose.Schema({
     patient_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
     user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
     date: { type: Date, required: true },
     time: { type: String },
     message: { type: String, required: true },
     duration: { type: Number, min: 30, max: 60, default: 30 },
     status: { type: String, enum: ["pending", "active", "completed", "rejected"], default: "pending" },
     rating: { type: Number },
     comment: { type: String },
     qrCodeUrl: { type: String }, 
   });
// Pre-save hook to auto-generate time from date if not provided
   AppointmentSchema.pre("save", function (next) {
     if (!this.time && this.date) {
       const hours = String(this.date.getUTCHours()).padStart(2, "0");
       const minutes = String(this.date.getUTCMinutes()).padStart(2, "0");
       this.time = `${hours}:${minutes}`;
     }
     next();
   });

   export default mongoose.model("Appointment", AppointmentSchema);