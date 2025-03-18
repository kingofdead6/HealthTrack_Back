import Appointment from "../Models/appointmentModel.js";
import userModel from "../Models/userModel.js";
import HealthCare from "../Models/healthCareModel.js";
import Doctor from "../Models/doctorModel.js";
import Nurse from "../Models/nurseModel.js";
import Pharmacy from "../Models/pharmacyModel.js";
import Laboratory from "../Models/laboratoryModel.js";
import Patient from "../Models/patientModel.js";
import Announcement from "../Models/announcementModel.js";
import fs from "fs/promises";
import path from "path";

export const getAllRates = async (req, res) => {
  try {
    const appointments = await Appointment.find({
      rating: { $exists: true, $ne: null },
      comment: { $exists: true, $ne: "" },
    })
      .populate("patient_id", "name email phone_number profile_image isBanned") 
      .populate("user_id", "name");

    if (!appointments || appointments.length === 0) {
      return res.status(404).json({ message: "No reviews found" });
    }

    res.status(200).json(appointments);
  } catch (error) {
    console.error("Error fetching reviews:", error.message, error.stack);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteReview = async (req, res) => {
  const { appointmentId } = req.body;

  try {
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    if (!appointment.rating && !appointment.comment) {
      return res.status(400).json({ message: "No review to delete" });
    }

    appointment.rating = null;
    appointment.comment = null;
    await appointment.save();

    res.status(200).json({ message: "Review deleted successfully" });
  } catch (error) {
    console.error("Error deleting review:", error.message, error.stack);
    res.status(500).json({ message: "Server error" });
  }
};

export const banUser = async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.user_type === "admin") {
      return res.status(403).json({ message: "Cannot ban an admin" });
    }

    user.isBanned = true;
    await user.save();

    await Appointment.updateMany(
      { patient_id: userId, status: { $in: ["pending", "active"] } },
      { status: "rejected" }
    );

    res.status(200).json({ message: "User banned successfully" });
  } catch (error) {
    console.error("Error banning user:", error.message, error.stack);
    res.status(500).json({ message: "Server error" });
  }
};

export const unbanUser = async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.user_type === "admin") {
      return res.status(403).json({ message: "Cannot unban an admin" });
    }

    if (!user.isBanned) {
      return res.status(400).json({ message: "User is not banned" });
    }

    user.isBanned = false;
    await user.save();

    res.status(200).json({ message: "User unbanned successfully" });
  } catch (error) {
    console.error("Error unbanning user:", error.message, error.stack);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteUser = async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.user_type === "admin") {
      return res.status(403).json({ message: "Cannot delete an admin" });
    }

    if (user.user_type === "patient") {
      await Patient.deleteOne({ user_id: userId });
      await Appointment.deleteMany({ patient_id: userId });
    } else if (user.user_type === "healthcare") {
      const healthcare = await HealthCare.findOne({ user_id: userId });
      if (healthcare) {
        switch (healthcare.healthcare_type) {
          case "doctor":
            await Doctor.deleteOne({ healthcare_id: healthcare._id });
            break;
          case "nurse":
            await Nurse.deleteOne({ healthcare_id: healthcare._id });
            break;
          case "pharmacy":
            await Pharmacy.deleteOne({ healthcare_id: healthcare._id });
            break;
          case "laboratory":
            await Laboratory.deleteOne({ healthcare_id: healthcare._id });
            break;
        }
        await HealthCare.deleteOne({ user_id: userId });
        await Appointment.deleteMany({ user_id: userId });
        await Announcement.deleteMany({ healthcare_id: userId });
      }
    }

    if (user.profile_image) {
      const imagePath = path.join(path.resolve(), user.profile_image);
      try {
        await fs.unlink(imagePath);
        console.log(`Deleted profile image: ${imagePath}`);
      } catch (err) {
        console.error(`Error deleting profile image: ${err.message}`);
      }
    }

    await userModel.deleteOne({ _id: userId });

    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error.message, error.stack);
    res.status(500).json({ message: "Server error" });
  }
};