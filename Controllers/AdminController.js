import Appointment from "../Models/appointmentModel.js";
import userModel from "../Models/userModel.js";
import Report from "../Models/reportModel.js";

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
    if (user.isBanned) {
      return res.status(400).json({ message: "User is already banned" });
    }

    user.isBanned = true;
    await user.save();

    res.status(200).json({ message: "User banned successfully" });
  } catch (error) {
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
 
    if (!user.isBanned) {
      return res.status(400).json({ message: "User is not banned" });
    }

    user.isBanned = false;
    await user.save();

    res.status(200).json({ message: "User unbanned successfully" });
  } catch (error) {
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
    await Appointment.deleteMany({ patient_id: patientId });
    await Report.deleteMany({
      $or: [{ reported_id: patientId }, { reporter_id: patientId }],
    });
    await userModel.deleteOne({ _id: patientId });

    res.status(200).json({ message: "User and associated reports deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const getAllReports = async (req, res) => {
  try {
    const reports = await Report.find({ status: "pending" })
      .populate("reporter_id", "name email user_type profile_image")
      .populate("reported_id", "name email user_type isBanned profile_image");

    if (!reports || reports.length === 0) {
      return res.status(404).json({ message: "No pending reports found" });
    }

    res.status(200).json(reports);
  } catch (error) {
    res.status(500).json({ message: "Server error while fetching reports" });
  }
};

export const deleteReport = async (req, res) => {
  const { reportId } = req.body;

  try {
    const report = await Report.findById(reportId);
    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    await Report.deleteOne({ _id: reportId });

    res.status(200).json({ message: "Report deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error while deleting report" });
  }
};