import Appointment from "../Models/appointmentModel.js";
import userModel from "../Models/userModel.js";

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
  const { patientId } = req.params;

  try {
    const user = await userModel.findById(patientId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (user.user_type !== "patient") {
      return res.status(400).json({ message: "Only patients can be banned" });
    }
    if (user.isBanned) {
      return res.status(400).json({ message: "User is already banned" });
    }

    user.isBanned = true;
    await user.save();

    res.status(200).json({ message: "User banned successfully" });
  } catch (error) {
    console.error("Error banning user:", error.message, error.stack);
    res.status(500).json({ message: "Server error" });
  }
};

export const unbanUser = async (req, res) => {
  const { patientId } = req.params;

  try {
    const user = await userModel.findById(patientId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (user.user_type !== "patient") {
      return res.status(400).json({ message: "Only patients can be unbanned" });
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
  const { patientId } = req.params;

  try {
    const user = await userModel.findById(patientId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (user.user_type !== "patient") {
      return res.status(400).json({ message: "Only patients can be deleted" });
    }

    // Delete related data (optional, adjust based on your requirements)
    await Appointment.deleteMany({ patient_id: patientId });
    await userModel.deleteOne({ _id: patientId });

    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error.message, error.stack);
    res.status(500).json({ message: "Server error" });
  }
};