import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, match: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/ },
    hashed_password: { type: String, required: true },
    phone_number: { type: String, required: true },
    user_type: { type: String, enum: ["patient", "healthcare", "admin", null], default: null },
    isApproved: { type: Boolean, default: false },
    profile_image: { type: String, default: null },
    isBanned: { type: Boolean, default: false },
    bannedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    resetToken: { type: String },
    resetTokenExpires: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model("User", UserSchema);