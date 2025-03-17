import jwt from "jsonwebtoken";
import { sendDeletionEmail } from "../utils/email.js";
import bcrypt from "bcryptjs";
import HealthCare from "../Models/healthCareModel.js";
import Doctor from "../Models/doctorModel.js";
import Nurse from "../Models/nurseModel.js";
import Pharmacy from "../Models/pharmacyModel.js"; 
import Laboratory from "../Models/laboratoryModel.js";
import Patient from "../Models/patientModel.js";
import userModel from "../Models/userModel.js";
import Announcement from "../Models/announcementModel.js";
import Appointment from "../Models/appointmentModel.js";
import fs from "fs/promises"; 
import path from "path";

export const requestAccountDeletion = async (req, res) => {
  try {
    const user = await userModel.findById(req.user._id);
    if (!user || user.user_type !== "patient") {
      return res.status(404).json({ message: "Patient not found" });
    }

    const { frontendUrl } = req.body;
    if (!frontendUrl) {
      return res.status(400).json({ message: "Frontend URL is required" });
    }

    const deletionToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    console.log("Attempting to send deletion email to:", user.email);
    await sendDeletionEmail(user.email, deletionToken, frontendUrl);

    res.status(200).json({ message: "Deletion request sent. Please check your email." });
  } catch (error) {
    console.error("Error in requestAccountDeletion:", error.message, error.stack);
    res.status(500).json({ message: `Failed to send deletion email: ${error.message}` });
  }
};

export const confirmAccountDeletion = async (req, res) => {
  const { token, password } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await userModel.findById(decoded.userId);
    if (!user || user.user_type !== "patient") {
      return res.status(404).json({ message: "Invalid or expired token" });
    }

    const isMatch = await bcrypt.compare(password, user.hashed_password);
    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect password" });
    }

    await Patient.deleteOne({ user_id: user._id });
    await userModel.deleteOne({ _id: user._id });

    res.status(200).json({ message: "Account deleted successfully" });
  } catch (error) {
    console.error("Error in confirmAccountDeletion:", error);
    if (error.name === "TokenExpiredError") {
      return res.status(400).json({ message: "Deletion token has expired" });
    }
    res.status(500).json({ message: "Server error" });
  }
};

export const updatePatientProfile = async (req, res) => {
  const { gender, height, weight, blood_type, medical_state, phone_number } = req.body;
  try {
    const patient = await Patient.findOne({ user_id: req.user._id });
    if (!patient) {
      return res.status(404).json({ message: "Patient profile not found" });
    }

    patient.gender = gender || patient.gender;
    patient.height = height || patient.height;
    patient.weight = weight || patient.weight;
    patient.blood_type = blood_type || patient.blood_type;
    patient.medical_state = medical_state || patient.medical_state;
    await patient.save();

    const user = await userModel.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (req.file) {
      if (user.profile_image) {
        const oldImagePath = path.join(path.resolve(), user.profile_image);
        try {
          await fs.unlink(oldImagePath);
          console.log(`Deleted old profile image: ${oldImagePath}`);
        } catch (err) {
          console.error(`Error deleting old profile image: ${err.message}`);
        }
      }
      user.profile_image = `uploads/${req.file.filename}`;
    }

    if (phone_number) {
      user.phone_number = phone_number;
    }

    await user.save();

    const updatedUser = await userModel.findById(req.user._id).select("name email phone_number profile_image");
    res.status(200).json({
      message: "Profile updated successfully",
      patient,
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error updating patient profile:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const getPatientProfile = async (req, res) => {
    try {
      const patient = await Patient.findOne({ user_id: req.user._id }).populate("user_id", "name email phone_number profile_image");
      if (!patient) {
        return res.status(404).json({ message: "Patient profile not found" });
      }
      res.status(200).json({ patient });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
};

export const getAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.find()
      .populate({
        path: "healthcare_id",
        select: "name",
        model: userModel, 
      })
      .sort({ createdAt: -1 });

    if (!announcements) {
      return res.status(404).json({ message: "No announcements found" });
    }

    console.log("Fetched announcements:", announcements); 
    res.status(200).json(announcements);
  } catch (error) {
    console.error("Error fetching announcements:", error.message, error.stack);
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

export const getPatientAppointments = async (req, res) => {
  try {
    const appointments = await Appointment.find({ patient_id: req.user._id })
      .populate({
        path: "user_id", 
        select: "name", 
        model: userModel,
      })
      .sort({ date: -1 });

    const enrichedAppointments = await Promise.all(
      appointments.map(async (appointment) => {
        let healthcareType = "Unknown";
        if (appointment.user_id && appointment.user_id._id) {
          const healthcare = await HealthCare.findOne({ user_id: appointment.user_id._id });
          healthcareType = healthcare ? healthcare.healthcare_type : "Unknown";
        } else {
          console.warn("Appointment missing valid user_id:", appointment._id, appointment.user_id);
        }

        return {
          ...appointment._doc, 
          healthcare_type: healthcareType, 
        };
      })
    );

    console.log("Fetched appointments for patient:", req.user._id, enrichedAppointments.map(appt => ({
      _id: appt._id,
      healthcareName: appt.user_id?.name || "Not populated",
      healthcareType: appt.healthcare_type,
      status: appt.status,
      date: appt.date,
    })));
    res.status(200).json(enrichedAppointments);
  } catch (error) {
    console.error("Error fetching appointments:", error.message, error.stack);
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

export const addFavoriteHealthcare = async (req, res) => {
  const { healthcare_id } = req.body;

  try {
    const patient = await Patient.findOne({ user_id: req.user._id });
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    const healthcare = await userModel.findById(healthcare_id);
    if (!healthcare || healthcare.user_type !== "healthcare") {
      return res.status(404).json({ message: "Healthcare provider not found" });
    }

    if (!patient.favorites) patient.favorites = [];
    if (!patient.favorites.includes(healthcare_id)) {
      patient.favorites.push(healthcare_id);
      await patient.save();
    }

    res.status(200).json({ message: "Added to favorites successfully" });
  } catch (error) {
    console.error("Error adding favorite:", error.message);
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

export const removeFavoriteHealthcare = async (req, res) => {
  const { healthcare_id } = req.body;

  try {
    const patient = await Patient.findOne({ user_id: req.user._id });
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    if (patient.favorites && patient.favorites.includes(healthcare_id)) {
      patient.favorites = patient.favorites.filter(id => id.toString() !== healthcare_id.toString());
      await patient.save();
    }

    res.status(200).json({ message: "Removed from favorites successfully" });
  } catch (error) {
    console.error("Error removing favorite:", error.message);
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

export const getFavoriteHealthcare = async (req, res) => {
  try {
    const patient = await Patient.findOne({ user_id: req.user._id });
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    const favorites = await Promise.all(
      patient.favorites.map(async (userId) => {
        const user = await userModel.findById(userId).select("name email phone_number profile_image");
        const healthcare = await HealthCare.findOne({ user_id: userId });
        if (!user || !healthcare) return null;

        let typeSpecificData = {};
        switch (healthcare.healthcare_type) {
          case "doctor":
            typeSpecificData = await Doctor.findOne({ healthcare_id: healthcare._id })
              .select("speciality clinic_name");
            break;
          case "nurse":
            typeSpecificData = await Nurse.findOne({ healthcare_id: healthcare._id })
              .select("ward clinic_name");
            break;
          case "pharmacy":
            typeSpecificData = await Pharmacy.findOne({ healthcare_id: healthcare._id })
              .select("pharmacy_name");
            break;
          case "laboratory":
            typeSpecificData = await Laboratory.findOne({ healthcare_id: healthcare._id })
              .select("lab_name equipment clinic_name");
            break;
          default:
            break;
        }

        return {
          user_id: user._id,
          name: user.name,
          email: user.email,
          phone_number: user.phone_number,
          profile_image: user.profile_image || "",
          healthcare_type: healthcare.healthcare_type,
          location_link: healthcare.location_link,
          working_hours: healthcare.working_hours || "Mon-Fri 9 AM - 5 PM" ,
          can_deliver: healthcare.can_deliver,
          ...typeSpecificData?._doc,
        };
      })
    );

    const validFavorites = favorites.filter(fav => fav !== null);
    res.status(200).json(validFavorites || []);
  } catch (error) {
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

export const rateAppointment = async (req, res) => {
  const { appointmentId, rating, comment } = req.body;

  if (!appointmentId || rating === undefined || !comment) {
    return res.status(400).json({ message: "Appointment ID, rating, and comment are required" });
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({ message: "Rating must be between 1 and 5" });
  }

  try {
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    if (appointment.patient_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized to rate this appointment" });
    }

    if (appointment.status !== "completed") {
      return res.status(400).json({ message: "Can only rate completed appointments" });
    }

    if (appointment.rating) {
      return res.status(400).json({ message: "Appointment already rated" });
    }

    appointment.rating = rating;
    appointment.comment = comment;
    await appointment.save();

    res.status(200).json({ message: "Rating submitted successfully", appointment });
  } catch (error) {
    console.error("Error submitting rating:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const getPatientProfileById = async (req, res) => {
  const { patientId } = req.params;

  try {
    const requester = await userModel.findById(req.user._id);
    if (!requester || requester.user_type !== "healthcare") {
      return res.status(403).json({ message: "Unauthorized: Only healthcare providers can access patient profiles" });
    }

    const patient = await Patient.findOne({ user_id: patientId }).populate(
      "user_id",
      "name email phone_number profile_image"
    );
    if (!patient) {
      return res.status(404).json({ message: "Patient profile not found" });
    }

    res.status(200).json({ patient });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

const parseWorkingHours = (workingHours) => {
  const hoursString = workingHours && typeof workingHours === "string" && workingHours.includes(" - ")
    ? workingHours
    : "9 AM - 5 PM";
  try {
    if (hoursString === "24/7") return { startHour: 0, endHour: 24 };
    const [start, end] = hoursString.split(" - ");
    const startHour = parseInt(start.split(" ")[0]) + (start.includes("PM") && start !== "12 PM" ? 12 : 0);
    const endHour = parseInt(end.split(" ")[0]) + (end.includes("PM") && end !== "12 PM" ? 12 : 0);
    return { startHour, endHour };
  } catch (error) {
    console.error("Error parsing working hours:", error.message);
    return { startHour: 9, endHour: 17 };
  }
};

export const createAppointment = async (req, res) => {
  const { user_id, date, time, message, duration } = req.body;

  try {
    const healthcare = await userModel.findById(user_id);
    if (!healthcare || healthcare.user_type !== "healthcare" || !healthcare.isApproved) {
      return res.status(404).json({ message: "Healthcare provider not found or not approved" });
    }

    const healthcareDetails = await HealthCare.findOne({ user_id });
    const { startHour, endHour } = parseWorkingHours(healthcareDetails?.working_hours);

    const apptDate = new Date(date);
    const [hours, minutes] = time.split(":");
    apptDate.setUTCHours(parseInt(hours), parseInt(minutes), 0, 0);
    const apptDuration = parseInt(duration) || 30;
    const apptEnd = new Date(apptDate);
    apptEnd.setMinutes(apptEnd.getMinutes() + apptDuration);

    const apptHour = apptDate.getUTCHours() + apptDate.getUTCMinutes() / 60;
    const apptEndHour = apptHour + apptDuration / 60;

    if (apptHour < startHour || apptEndHour > endHour) {
      return res.status(400).json({ message: `Appointment outside working hours (${startHour}:00 - ${endHour}:00)` });
    }

    const now = new Date();
    const maxDate = new Date(now);
    maxDate.setDate(now.getDate() + 7);
    if (apptDate < now || apptDate > maxDate) {
      return res.status(400).json({ message: "Appointments must be within today and 7 days ahead" });
    }

    const existingAppointments = await Appointment.find({
      user_id,
      status: { $in: ["pending", "active"] }, 
      date: { $lt: apptEnd },
      $or: [
        { date: { $gte: apptDate } },
        {
          $expr: {
            $gt: [
              { $add: ["$date", { $multiply: [{ $ifNull: ["$duration", 30] }, 60000] }] },
              apptDate,
            ],
          },
        },
      ],
    });

    if (existingAppointments.length > 0) {
      return res.status(400).json({ message: "Time slot is already booked" });
    }

    const appointment = new Appointment({
      patient_id: req.user._id,
      user_id,
      date: apptDate,
      time,
      message,
      duration: apptDuration,
      status: "pending",
    });

    await appointment.save();
    res.status(201).json({ message: "Appointment request sent successfully", appointment });
  } catch (error) {
    console.error("Error creating appointment:", error.message, error.stack);
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

export const getHealthcareAvailability = async (req, res) => {
  const { healthcareId } = req.params;
  try {
    const now = new Date();
    const maxDate = new Date(now);
    maxDate.setDate(now.getDate() + 7);

    const appointments = await Appointment.find({
      user_id: healthcareId,
      date: { $gte: now, $lte: maxDate },
      status: { $in: ["pending", "active"] }, 
    });

    const bookedSlots = appointments.map((appt) => ({
      start: new Date(appt.date).toISOString(),
      time: appt.time,
      duration: appt.duration || 30,
      end: new Date(new Date(appt.date).getTime() + (appt.duration || 30) * 60000).toISOString(),
    }));

    const healthcare = await HealthCare.findOne({ user_id: healthcareId });
    const { startHour, endHour } = parseWorkingHours(healthcare?.working_hours);

    res.status(200).json({ slots: bookedSlots, workingHours: { startHour, endHour } });
  } catch (error) {
    console.error("Error in getHealthcareAvailability:", error.message, error.stack);
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};