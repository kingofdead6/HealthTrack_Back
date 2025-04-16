// server/Routes/healthCareRoute.js
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


const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/gif"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, and GIF images are allowed"), false);
    }
  },
});

const router = express.Router();

router.get("/details", authMiddleware, getHealthCareDetails);
router.get("/approved-healthcare", authMiddleware, getAllApprovedHealthCare);
router.get("/appointments", authMiddleware, getHealthcareAppointments);
router.put("/appointments/:appointmentId", authMiddleware, updateAppointmentStatus);
router.get("/profile/:healthcareId", authMiddleware, getHealthcareProfile);
router.put("/profile", authMiddleware, upload.single("profile_image"), updateHealthcareProfile); 

router.post("/delete-request", authMiddleware, deleteHealthcareRequest);
router.post("/announcements", authMiddleware, createAnnouncement);
router.get("/announcements", authMiddleware, getAllAnnouncements);
router.delete("/announcements/:announcementId", authMiddleware, deleteAnnouncement);

export default router;