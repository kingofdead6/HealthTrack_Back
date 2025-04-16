import express from "express";
import authMiddleware from "../Middleware/authMiddleware.js";
import { 
  updatePatientProfile, 
  getPatientAppointments, 
  createAppointment, 
  getAnnouncements, 
  getPatientProfile, 
  requestAccountDeletion, 
  confirmAccountDeletion,
  addFavoriteHealthcare,
  removeFavoriteHealthcare,
  getFavoriteHealthcare, 
  rateAppointment,
  getPatientProfileById,
  getHealthcareAvailability
} from "../Controllers/patientController.js";
import multer from "multer"; 

const router = express.Router();

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


router.get("/profile", authMiddleware, getPatientProfile);
router.put("/profile", authMiddleware, upload.single("profile_image"), updatePatientProfile); 
router.get("/appointments", authMiddleware, getPatientAppointments);
router.post("/appointments", authMiddleware, createAppointment);
router.get("/announcements", authMiddleware, getAnnouncements);
router.post("/delete-request", authMiddleware, requestAccountDeletion);
router.post("/delete-confirm", confirmAccountDeletion);
router.post("/favorites", authMiddleware, addFavoriteHealthcare);
router.delete("/favorites", authMiddleware, removeFavoriteHealthcare);
router.get("/favorites", authMiddleware, getFavoriteHealthcare);
router.post("/appointments/rate", authMiddleware, rateAppointment);
router.get("/profile/:patientId", authMiddleware, getPatientProfileById);
router.get("/appointments/availability/:healthcareId", authMiddleware, getHealthcareAvailability);


export default router;