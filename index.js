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

dotenv.config();

const app = express();
const server = createServer(app);
const io = setupSocket(server, app);

app.set("io", io);

app.use(cors({ origin: process.env.FRONTEND_URL })); 
app.use(express.json());

app.use("/api/users", userRoute);
app.use("/api/patients", patientRoute);
app.use("/api/healthcare", healthCareRoute);
app.use("/api/chats", chatRoute);
app.use("/api/notifications", notificationRoute);
app.use("/api/admin", adminRoute);
app.use("/api/chatbot", chatbotRoute);
app.use("/api/tools-medicaments", toolMedicamentRoutes);

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

app.get("/", (req, res) => {
  res.send("API is running perfectly and this is a fact ...");
});