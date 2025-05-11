import express from "express";
import {
  registerUser,
  loginUser,
  getCurrentUser,
  requestPasswordReset,
  changePassword,
  reportUser,
} from "../Controllers/userController.js";
import authMiddleware from "../Middleware/authMiddleware.js";
import multer from "multer";

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

router.post("/register", upload.fields([{ name: "certificate", maxCount: 1 }]), registerUser);
router.post("/login", loginUser);
router.get("/me", authMiddleware, getCurrentUser);
router.post("/reset-password", requestPasswordReset);
router.post("/change-password", changePassword);
router.post("/report", authMiddleware, reportUser);

export default router;