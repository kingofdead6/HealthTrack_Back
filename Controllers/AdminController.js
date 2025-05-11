import Appointment from "../Models/appointmentModel.js";
import userModel from "../Models/userModel.js";
import Report from "../Models/reportModel.js";
import HealthCare from "../Models/healthCareModel.js";
import Patient from "../Models/patientModel.js";
import bcrypt from "bcrypt";
import validator from "validator";

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

// Ban a user
export const banUser = async (req, res) => {
  try {
    // Restrict to admins
    if (req.user.user_type !== "admin") {
      return res.status(403).json({ message: "Access denied. Admins only." });
    }

    const userId = req.params.userId;
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update user ban status
    await userModel.findByIdAndUpdate(userId, { 
      isBanned: true,
      bannedAt: new Date() 
    });
    res.status(200).json({ message: "User banned successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error while banning user" });
  }
};

// Unban a user 
export const unbanUser = async (req, res) => {
  try {
    // Restrict to admins
    if (req.user.user_type !== "admin") {
      return res.status(403).json({ message: "Access denied. Admins only." });
    }

    const userId = req.params.userId;
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update user ban status
    await userModel.findByIdAndUpdate(userId, { 
      isBanned: false,
      bannedAt: null 
    });
    res.status(200).json({ message: "User unbanned successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error while unbanning user" });
  }
};

// Delete a user and related records 
export const deleteUser = async (req, res) => {
  try {
    // Restrict to admins
    if (req.user.user_type !== "admin") {
      return res.status(403).json({ message: "Access denied. Admins only." });
    }

    const userId = req.params.userId;
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Delete associated healthcare or patient records
    if (user.user_type === "healthcare") {
      const healthcare = await HealthCare.findOne({ user_id: userId });
      if (healthcare) {
        await HealthCare.findByIdAndDelete(healthcare._id);
      }
    } else if (user.user_type === "patient") {
      await Patient.findOneAndDelete({ user_id: userId });
    }

    await userModel.findByIdAndDelete(userId);
    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error while deleting user" });
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

// Get all users 
export const getAllUsers = async (req, res) => {
  try {
    // Restrict to admins
    if (req.user.user_type !== "admin") {
      return res.status(403).json({ message: "Access denied. Admins only." });
    }

    const users = await userModel.find().select(
      "_id name email user_type isBanned createdAt"
    );

    // Include healthcare type for healthcare users
    const usersWithDetails = await Promise.all(
      users.map(async (user) => {
        if (user.user_type === "healthcare" || user.user_type === "patient") {
          const healthcare = await HealthCare.findOne({ user_id: user._id });
          return {
            _id: user._id,
            name: user.name,
            email: user.email,
            user_type: user.user_type,
            isBanned: user.isBanned,
            healthcare_type: healthcare ? healthcare.healthcare_type : "N/A",
            createdAt: user.createdAt,
          };
        }
        return {
          _id: user._id,
          name: user.name,
          email: user.email,
          user_type: user.user_type,
          isBanned: user.isBanned,
          healthcare_type: "N/A",
        };
      })
    );

    res.status(200).json({ users: usersWithDetails });
  } catch (error) {
    res.status(500).json({ message: "Server error while fetching users" });
  }
};

// Add a new admin 
export const addAdmin = async (req, res) => {
  const { name, email, password, phone_number } = req.body;

  try {
    // Restrict to admins
    if (req.user.user_type !== "admin") {
      return res.status(403).json({ message: "Access denied. Admins only." });
    }

    // Validate input
    if (!name || !email || !password || !phone_number) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: "Invalid email" });
    }

    if (!validator.isStrongPassword(password, { minSymbols: 0 })) {
      return res.status(400).json({ message: "Password must be strong" });
    }

    // Check for existing user
    const existingUser = await userModel.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }

    // Create and save new admin
    const salt = await bcrypt.genSalt(10);
    const hashed_password = await bcrypt.hash(password, salt);
    const user = new userModel({
      name,
      email,
      hashed_password,
      phone_number,
      user_type: "admin",
      isApproved: true,
    });
    await user.save();

    res.status(201).json({ message: "Admin created successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};