import mongoose from "mongoose";

const reportSchema = new mongoose.Schema({
  reporter_id: {type: mongoose.Schema.Types.ObjectId,ref: "User",required: true },
  reported_id: {type: mongoose.Schema.Types.ObjectId,ref: "User",required: true },
  reason: {type: String,required: true,trim: true },
  status: {type: String,enum: ["pending", "resolved"],default: "pending" },
  createdAt: {type: Date,default: Date.now },
});

export default mongoose.model("Report", reportSchema);