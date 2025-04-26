import mongoose from "mongoose";

const RatingSchema = new mongoose.Schema({
  patient_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});

const ToolMedicamentSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  healthcare_type: { type: String, enum: ["pharmacy", "laboratory"], required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true, min: 0 },
  description: { type: String, default: "" },
  picture: { type: String, required: true }, // Cloudinary URL
  category: { type: String, default: "" }, 
  ratings: [RatingSchema],
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("ToolMedicament", ToolMedicamentSchema);