import express from "express";
import {
  registerUser,
  loginUser,
  getCurrentUser,
  getAllUsers,
  banUser,
  deleteUser,
  unbanUser,
  requestPasswordReset,
  changePassword,
} from "../Controllers/userController.js";
import authMiddleware from "../Middleware/authMiddleware.js";
import multer from "multer";

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

router.post("/register", upload.fields([{ name: "certificate", maxCount: 1 }]), registerUser);
router.post("/login", loginUser);
router.get("/me", authMiddleware, getCurrentUser);
router.get("/all", authMiddleware, getAllUsers);
router.patch("/ban/:userId", authMiddleware, banUser);
router.delete("/delete/:userId", authMiddleware, deleteUser);
router.patch("/unban/:userId", authMiddleware, unbanUser);
router.post("/reset-password", requestPasswordReset);
router.post("/change-password", changePassword);

export default router;