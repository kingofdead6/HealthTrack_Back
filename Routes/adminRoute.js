import express from "express";
import { getPendingHealthCare, approveHealthCare, rejectHealthCare } from "../Controllers/healthCareController.js";
import { getAllRates, deleteReview } from "../Controllers/AdminController.js";
import adminMiddleware from "../Middleware/adminMiddleware.js";

const router = express.Router();

router.get("/healthcare/pending", adminMiddleware, getPendingHealthCare);
router.post("/healthcare/approve", adminMiddleware, approveHealthCare);
router.post("/healthcare/reject", adminMiddleware, rejectHealthCare);
router.get("/reviews", adminMiddleware, getAllRates);
router.post("/reviews/delete", adminMiddleware, deleteReview);


export default router;