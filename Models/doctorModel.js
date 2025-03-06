import mongoose from "mongoose";

const DoctorSchema = new mongoose.Schema({
  healthcare_id: { type: mongoose.Schema.Types.ObjectId, ref: "HealthCare", required: true },
  speciality: {
    type: String,
    enum: ["General Practitioner", "Dentist", "Surgeon", "Radiologist", "Pediatrician"],
    required: true,
  },
});

export default mongoose.model("Doctor", DoctorSchema);