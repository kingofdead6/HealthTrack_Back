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
} from "../Controllers/AdminController.js";
import adminMiddleware from "../Middleware/adminMiddleware.js";

const router = express.Router();

router.get("/healthcare/pending", adminMiddleware, getPendingHealthCare);
router.post("/healthcare/approve", adminMiddleware, approveHealthCare);
router.post("/healthcare/reject", adminMiddleware, rejectHealthCare);
router.get("/reviews", adminMiddleware, getAllRates);
router.post("/reviews/delete", adminMiddleware, deleteReview);
router.patch("/users/ban/:patientId", adminMiddleware, banUser);
router.patch("/users/unban/:patientId", adminMiddleware, unbanUser);
router.delete("/users/delete/:patientId", adminMiddleware, deleteUser);
router.get("/reports", adminMiddleware, getAllReports);
router.post("/reports/delete", adminMiddleware, deleteReport);
router.patch("/reports/ban/:patientId", adminMiddleware, banUser);
router.patch("/reports/unban/:patientId", adminMiddleware, unbanUser);
router.delete("/reports/delete-user/:patientId", adminMiddleware, deleteUser);

export default router;