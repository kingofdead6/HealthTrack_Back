import express from "express";
import {
  getAllApprovedHealthCare,
  getHealthcareAppointments,
  getHealthCareDetails,
  getHealthcareProfile,
  updateAppointmentStatus,
  updateHealthcareProfile, 
  deleteHealthcareRequest,
  createAnnouncement,
  getAllAnnouncements,
  deleteAnnouncement, 
} from "../Controllers/healthCareController.js";
import authMiddleware from "../Middleware/authMiddleware.js";
import multer from "multer";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); 
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

const router = express.Router();

router.get("/details", authMiddleware, getHealthCareDetails);
router.get("/approved-healthcare", authMiddleware, getAllApprovedHealthCare);
router.get("/appointments", authMiddleware, getHealthcareAppointments);
router.put("/appointments/:appointmentId", authMiddleware, updateAppointmentStatus);
router.get("/profile/:healthcareId", authMiddleware, getHealthcareProfile);
router.put("/profile",authMiddleware,upload.fields([{ name: "profile_image", maxCount: 1 }]),updateHealthcareProfile);
router.post("/delete-request", authMiddleware, deleteHealthcareRequest);
router.post("/announcements", authMiddleware, createAnnouncement); 
router.get("/announcements", authMiddleware, getAllAnnouncements); 
router.delete("/announcements/:announcementId", authMiddleware, deleteAnnouncement);


export default router;