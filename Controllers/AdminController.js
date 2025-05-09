import Appointment from "../Models/appointmentModel.js";
import userModel from "../Models/userModel.js";
import Report from "../Models/reportModel.js";

// Get all reviews (ratings and comments) from appointments
export const getAllRates = async (req, res) => {
  try {
    // Fetch appointments that have both a rating and a comment
    const appointments = await Appointment.find({
      rating: { $exists: true, $ne: null },
      comment: { $exists: true, $ne: "" },
    })
      .populate("patient_id", "name email phone_number profile_image isBanned")
      .populate("user_id", "name");

    // If no appointments with reviews found, return a 404 error
    if (!appointments || appointments.length === 0) {
      return res.status(404).json({ message: "No reviews found" });
    }

    // Return the list of appointments with reviews
    res.status(200).json(appointments);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Delete a specific review from an appointment
export const deleteReview = async (req, res) => {
  const { appointmentId } = req.body;

  try {
    // Find the appointment by its ID
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    // If no rating or comment, return a 400 error
    if (!appointment.rating && !appointment.comment) {
      return res.status(400).json({ message: "No review to delete" });
    }

    // Remove the review details from the appointment
    appointment.rating = null;
    appointment.comment = null;
    await appointment.save();

    // Send success response
    res.status(200).json({ message: "Review deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Ban a user (patient) by setting their 'isBanned' status to true
export const banUser = async (req, res) => {
  const { patientId } = req.params;

  try {
    // Find the user by their ID
    const user = await userModel.findById(patientId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // If user is already banned, return a 400 error
    if (user.isBanned) {
      return res.status(400).json({ message: "User is already banned" });
    }

    // Ban the user
    user.isBanned = true;
    await user.save();

    // Send success response
    res.status(200).json({ message: "User banned successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Unban a user by setting their 'isBanned' status to false
export const unbanUser = async (req, res) => {
  const { patientId } = req.params;

  try {
    // Find the user by their ID
    const user = await userModel.findById(patientId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // If user is not banned, return a 400 error
    if (!user.isBanned) {
      return res.status(400).json({ message: "User is not banned" });
    }

    // Unban the user
    user.isBanned = false;
    await user.save();

    // Send success response
    res.status(200).json({ message: "User unbanned successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Delete a user and their associated data (appointments and reports)
export const deleteUser = async (req, res) => {
  const { patientId } = req.params;

  try {
    // Find the user by their ID
    const user = await userModel.findById(patientId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Delete associated appointments and reports
    await Appointment.deleteMany({ patient_id: patientId });
    await Report.deleteMany({
      $or: [{ reported_id: patientId }, { reporter_id: patientId }],
    });

    // Delete the user
    await userModel.deleteOne({ _id: patientId });

    // Send success response
    res.status(200).json({ message: "User and associated reports deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Get all pending reports from the database
export const getAllReports = async (req, res) => {
  try {
    // Fetch reports with a pending status and populate reporter and reported user data
    const reports = await Report.find({ status: "pending" })
      .populate("reporter_id", "name email user_type profile_image")
      .populate("reported_id", "name email user_type isBanned profile_image");

    // If no pending reports found, return a 404 error
    if (!reports || reports.length === 0) {
      return res.status(404).json({ message: "No pending reports found" });
    }

    // Return the list of pending reports
    res.status(200).json(reports);
  } catch (error) {
    res.status(500).json({ message: "Server error while fetching reports" });
  }
};

// Delete a specific report by its ID
export const deleteReport = async (req, res) => {
  const { reportId } = req.body;

  try {
    // Find the report by its ID
    const report = await Report.findById(reportId);
    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    // Delete the report from the database
    await Report.deleteOne({ _id: reportId });

    // Send success response
    res.status(200).json({ message: "Report deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error while deleting report" });
  }
};
