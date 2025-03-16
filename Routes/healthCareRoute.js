import express from "express";
import { getAllApprovedHealthCare, getHealthcareAppointments, getHealthCareDetails, getHealthcareProfile, updateAppointmentStatus } from "../Controllers/healthCareController.js";
import authMiddleware from "../Middleware/authMiddleware.js";

const router = express.Router();

router.get("/details", authMiddleware, getHealthCareDetails);
router.get("/approved-healthcare", authMiddleware, getAllApprovedHealthCare);
router.get("/appointments", authMiddleware, getHealthcareAppointments);
router.put("/appointments/:appointmentId", authMiddleware, updateAppointmentStatus);
router.get("/profile/:healthcareId", authMiddleware, getHealthcareProfile);
export default router;