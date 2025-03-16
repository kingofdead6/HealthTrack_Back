import express from "express";
import { getPendingHealthCare, approveHealthCare } from "../Controllers/healthCareController.js";
import adminMiddleware from "../Middleware/adminMiddleware.js";

const router = express.Router();

router.get("/healthcare/pending", adminMiddleware, getPendingHealthCare);
router.post("/healthcare/approve", adminMiddleware, approveHealthCare);

export default router;