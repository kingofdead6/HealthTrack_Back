import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

// Import routes
import userRoute from "./Routes/userRoute.js";
import healthCareRoute from "./Routes/healthCareRoute.js";
import adminRoute from "./Routes/adminRoute.js";
import chatbotRoute from "./Routes/ChatBotRoute.js"; 

dotenv.config();
mongoose.set("strictQuery", true);

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

app.use((req, res, next) => {
    console.log(`Received ${req.method} request to ${req.url}`);
    next();
});

// Mount routes
app.use("/api/users", userRoute);
app.use("/api/healthcare", healthCareRoute);
app.use("/api/admin", adminRoute);
app.use("/chatbot", chatbotRoute); 

app.use("/uploads", express.static(path.join(path.resolve(), "uploads")));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});