// userRoutes.js
import express from "express";
import {
  registerUser,
  loginUser,
  getCurrentUser,
  getAllUsers,
  banUser,
  deleteUser,
  unbanUser,
} from "../Controllers/userController.js";
import authMiddleware from "../Middleware/authMiddleware.js";
import multer from "multer";

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const uploading = multer({ storage });

router.post(
  "/register",
  uploading.fields([
    { name: "profile_image", maxCount: 1 },
    { name: "certificate", maxCount: 1 },
  ]),
  registerUser
);
router.post("/login", loginUser);
router.get("/me", authMiddleware, getCurrentUser);
router.get("/all", authMiddleware, getAllUsers);
router.patch("/ban/:userId", authMiddleware, banUser);
router.delete("/delete/:userId", authMiddleware, deleteUser);
router.patch("/unban/:userId", authMiddleware, unbanUser);
export default router;