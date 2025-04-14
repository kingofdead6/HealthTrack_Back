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
import setupSocket from "./sockets/socket.js";
import { createServer } from "http";

dotenv.config();

const app = express();
const server = createServer(app);
const io = setupSocket(server, app);

app.set("io", io); 

app.use(cors({ origin: process.env.FRONTEND_URL , credentials: true }));
app.use(express.json());
app.use("/Uploads", express.static("Uploads"));

app.use("/api/users", userRoute);
app.use("/api/patients", patientRoute);
app.use("/api/healthcare", healthCareRoute);
app.use("/api/chats", chatRoute);
app.use("/api/notifications", notificationRoute);
app.use("/api/admin", adminRoute);

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});