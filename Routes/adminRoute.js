import express from "express";
import {
  getPendingHealthCare,
  approveHealthCare,
  rejectHealthCare,
} from "../Controllers/healthCareController.js";
import {
  getAllRates,
  deleteReview,
  banUser,
  unbanUser,
  deleteUser,
  getAllReports,
  deleteReport,
  getAllUsers,
  addAdmin,
} from "../Controllers/AdminController.js";
import adminMiddleware from "../Middleware/adminMiddleware.js";
import authMiddleware from "../Middleware/authMiddleware.js";

const router = express.Router();

router.get("/healthcare/pending", adminMiddleware, getPendingHealthCare);
router.post("/healthcare/approve", adminMiddleware, approveHealthCare);
router.post("/healthcare/reject", adminMiddleware, rejectHealthCare);
router.get("/reviews", adminMiddleware, getAllRates);
router.post("/reviews/delete", adminMiddleware, deleteReview);
router.patch("/ban/:userId", authMiddleware, banUser);
router.delete("/delete/:userId", authMiddleware, deleteUser);
router.patch("/unban/:userId", authMiddleware, unbanUser);
router.get("/reports", adminMiddleware, getAllReports);
router.post("/reports/delete", adminMiddleware, deleteReport);
router.patch("/reports/ban/:patientId", adminMiddleware, banUser);
router.patch("/reports/unban/:patientId", adminMiddleware, unbanUser);
router.delete("/reports/delete-user/:patientId", adminMiddleware, deleteUser);
router.get("/all", authMiddleware, getAllUsers);
router.post("/add-admin",authMiddleware, addAdmin);

export default router;