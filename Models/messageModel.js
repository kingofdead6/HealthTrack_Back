import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    chat_id: {  type: mongoose.Schema.Types.ObjectId, ref:"Chat",required: true,},
    sender_id: { type: mongoose.Schema.Types.ObjectId, ref:"User",required: true,},
    content: { type: String, trim: true,},file_url: {type: String,},
    file_type: { type: String, enum: ["image", "pdf"],},
    public_id: { type: String,},
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    seenBy: [ { type: mongoose.Schema.Types.ObjectId,ref: "User"}],
    read: {  type: Boolean,  default: false,},
    isEdited: { type: Boolean, default: false }, 
  },
  { timestamps: true }
);

export default mongoose.model("Message", messageSchema);