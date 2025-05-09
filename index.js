import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import userRoute from "./Routes/userRoute.js";
import patientRoute from "./Routes/patientRoute.js";
import healthCareRoute from "./Routes/healthCareRoute.js";
import chatRoute from "./Routes/chatRoute.js";
import adminRoute from "./Routes/adminRoute.js";
import notificationRoute from "./Routes/notificationRoute.js";
import chatbotRoute from "./Routes/ChatBotRoute.js";
import toolMedicamentRoutes from "./Routes/toolMedicamentRoutes.js";
import setupSocket from "./sockets/socket.js";
import { createServer } from "http";

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

// Create HTTP server for Express and Socket.IO
const server = createServer(app);

// Set up Socket.IO for real-time features
const io = setupSocket(server, app);
app.set("io", io);

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Define API routes
app.use("/api/users", userRoute);
app.use("/api/patients", patientRoute);
app.use("/api/healthcare", healthCareRoute);
app.use("/api/chats", chatRoute);
app.use("/api/notifications", notificationRoute);
app.use("/api/admin", adminRoute);
app.use("/api/chatbot", chatbotRoute);
app.use("/api/tools-medicaments", toolMedicamentRoutes);

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Root endpoint for API status
app.get("/", (req, res) => {
  res.send("API is running perfectly and this is a fact that you cannot deny gg and i m cool ...");
});