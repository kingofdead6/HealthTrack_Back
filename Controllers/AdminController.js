import Appointment from "../Models/appointmentModel.js";

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


