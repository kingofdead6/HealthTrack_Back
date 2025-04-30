import mongoose from "mongoose";

const PatientSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  gender: { type: String, enum: ["male", "female"] },
  height: { type: Number }, // in cm
  weight: { type: Number }, // in kg
  blood_type: { type: String, enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] },
  medical_state: { type: String },
  medical_register: [{
    name: { type: String },
    data: { type: Buffer }, // Store PDF as binary data
    contentType: { type: String, default: "application/pdf" },
    size: { type: Number },
    uploadedAt: { type: Date, default: Date.now }
  }],
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
}, { timestamps: true });

export default mongoose.model("Patient", PatientSchema);