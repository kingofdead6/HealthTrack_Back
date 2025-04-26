import mongoose from "mongoose";

const NurseSchema = new mongoose.Schema({
  healthcare_id: { type: mongoose.Schema.Types.ObjectId, ref: "HealthCare", required: true },
  ward: { type: String },
  clinic_name: { type: String }, 
  price: { type: Number, min: 0, default: null },
});

export default mongoose.model("Nurse", NurseSchema);