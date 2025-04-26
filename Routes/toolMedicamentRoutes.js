import express from "express";
import fileUpload from "express-fileupload";
import {
  createToolMedicament,
  getMyToolsMedicaments,
  getAllToolsMedicaments,
  rateToolMedicament,
  deleteToolMedicament,
  deleteReview,
} from "../Controllers/toolMedicamentController.js";
import authMiddleware from "../Middleware/authMiddleware.js";

const router = express.Router();

router.use(fileUpload());

router.post("/", authMiddleware, createToolMedicament);
router.get("/my", authMiddleware, getMyToolsMedicaments);
router.get("/", getAllToolsMedicaments);
router.post("/rate", authMiddleware, rateToolMedicament);
router.delete("/:toolMedicamentId", authMiddleware, deleteToolMedicament);
router.delete("/:toolMedicamentId/reviews/:reviewId", authMiddleware, deleteReview);

export default router;