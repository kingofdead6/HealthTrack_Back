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
  getHealthcareAvailability,
  uploadMedicalRegister,
  downloadMedicalRegister,
  deleteMedicalRegister,
  viewMedicalRegisterPDF,
} from "../Controllers/patientController.js";
import multer from "multer";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "application/pdf"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, GIF, and PDF files are allowed"), false);
    }
  },
});

router.get("/profile", authMiddleware, getPatientProfile);
router.put("/profile", authMiddleware, upload.single("profile_image"), updatePatientProfile);
router.post("/medical-register", authMiddleware, upload.single("medical_register"), uploadMedicalRegister);
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
router.get("/medical-register/:index/download", authMiddleware, downloadMedicalRegister);
router.get("/medical-register/:index/view", authMiddleware, viewMedicalRegisterPDF);
router.delete("/medical-register/:index", authMiddleware, deleteMedicalRegister);

export default router;