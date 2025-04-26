import Patient from "../Models/patientModel.js";
import cloudinary from "../cloudinary.js";
import { PassThrough } from "stream";
import { Readable } from "stream";
import fetch from "node-fetch";
import jwt from "jsonwebtoken";
import { sendDeletionEmail } from "../utils/email.js";
import bcrypt from "bcryptjs";
import HealthCare from "../Models/healthCareModel.js";
import Doctor from "../Models/doctorModel.js";
import Nurse from "../Models/nurseModel.js";
import Pharmacy from "../Models/pharmacyModel.js";
import Laboratory from "../Models/laboratoryModel.js";
import Notification from "../Models/notificationModel.js";
import userModel from "../Models/userModel.js";
import Announcement from "../Models/announcementModel.js";
import Appointment from "../Models/appointmentModel.js";
  import UnavailableSlot from "../Models/unavailableSlotModel.js";
import nodemailer from "nodemailer";

const sendEmail = async (toEmail, subject, html) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: toEmail,
    subject,
    html,
  };

  await transporter.sendMail(mailOptions);
};

// Request Account Deletion
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

// Confirm Account Deletion
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

// Update Patient Profile
export const updatePatientProfile = async (req, res) => {
  const { gender, height, weight, blood_type, medical_state, phone_number } = req.body;
  const profileImageFile = req.file;

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

    let profileImageUrl = user.profile_image;

    if (profileImageFile) {
      try {
        console.log("Uploading file to Cloudinary:", {
          originalname: profileImageFile.originalname,
          mimetype: profileImageFile.mimetype,
          size: profileImageFile.size,
        });
        if (user.profile_image) {
          const publicId = user.profile_image.split("/").pop().split(".")[0];
          await cloudinary.uploader.destroy(`profiles/patients/${publicId}`).catch((err) => {
            console.error("Error deleting old image:", err);
          });
        }

        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "profiles/patients",
              public_id: `${req.user._id}_${Date.now()}`,
              resource_type: "image",
              allowed_formats: ["jpg", "png", "gif"],
            },
            (error, result) => {
              if (error) {
                return reject(error);
              }
              resolve(result);
            }
          );
          stream.end(profileImageFile.buffer);
        });

        profileImageUrl = uploadResult.secure_url;
        console.log("File uploaded to Cloudinary:", {
          public_id: uploadResult.public_id,
          secure_url: uploadResult.secure_url,
        });
        user.profile_image = profileImageUrl;
      } catch (uploadError) {
        console.error("Cloudinary upload error:", {
          message: uploadError.message,
          http_code: uploadError.http_code,
        });
        return res.status(500).json({
          message: "Failed to upload image",
          error: uploadError.message,
        });
      }
    }

    if (phone_number) {
      user.phone_number = phone_number;
    }

    await user.save();

    const updatedUser = await userModel.findById(req.user._id).select(
      "name email phone_number profile_image isBanned"
    );
    res.status(200).json({
      message: "Profile updated successfully",
      patient,
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error updating patient profile:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Upload Medical Register with Custom Name
export const uploadMedicalRegister = async (req, res) => {
  const userId = req.user._id;
  const file = req.file;
  const customName = req.body.name;

  try {
    const patient = await Patient.findOne({ user_id: userId });
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    if (!file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    if (file.mimetype !== "application/pdf") {
      return res.status(400).json({ message: "Only PDF files are allowed" });
    }

    const publicId = `${userId}_${Date.now()}`;
    const fullPublicId = `medical_registers/${publicId}.pdf`;

    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "medical_registers",
          public_id: publicId,
          resource_type: "raw",
          format: "pdf",
        },
        (error, result) => {
          if (error) {
            console.error("Cloudinary upload error:", error);
            return reject(error);
          }
          console.log("Cloudinary upload result:", result);
          resolve(result);
        }
      );
      stream.end(file.buffer);
    });

    patient.medical_register = patient.medical_register || [];
    patient.medical_register.push({
      url: uploadResult.secure_url,
      public_id: publicId,
      name: customName || `medical-register-${patient.medical_register.length}`,
    });
    await patient.save();

    console.log("Medical register upload response:", {
      message: "Medical register uploaded successfully",
      medical_register: uploadResult.secure_url,
      public_id: publicId,
    });

    res.status(200).json({
      message: "Medical register uploaded successfully",
      medical_register: uploadResult.secure_url,
    });
  } catch (error) {
    console.error("Medical register upload error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Download Medical Register
function toNodeReadableStream(webStream) {
  if (webStream[Symbol.asyncIterator]) {
    return Readable.from(webStream);
  }
  return webStream;
}

export const downloadMedicalRegister = async (req, res) => {
  const { index } = req.params;
  const userId = req.user._id;

  try {
    const idx = parseInt(index);
    if (isNaN(idx) || idx < 0) {
      return res.status(400).json({ message: "Invalid index" });
    }

    const patient = await Patient.findOne({ user_id: userId });
    if (!patient) {
      return res.status(404).json({ message: "Patient profile not found" });
    }

    if (!Array.isArray(patient.medical_register) || idx >= patient.medical_register.length) {
      return res.status(404).json({ message: `Medical register at index ${idx} not found` });
    }

    const medicalRegister = patient.medical_register[idx];
    if (!medicalRegister?.public_id) {
      return res.status(404).json({ message: "Medical register entry is invalid" });
    }

    const fullPublicId = `medical_registers/${medicalRegister.public_id}`;
    console.log("Fetching PDF from Cloudinary with public_id:", fullPublicId);

    const pdfUrl = cloudinary.url(fullPublicId, {
      resource_type: "raw",
      sign_url: true,
      flags: "attachment",
    });

    console.log("Generated Cloudinary URL:", pdfUrl);

    const fileResponse = await fetch(pdfUrl);

    if (!fileResponse.ok) {
      throw new Error(`Failed to fetch file from Cloudinary: ${fileResponse.statusText}`);
    }

    const contentType = fileResponse.headers.get("content-type") || "";
    if (!["application/pdf", "application/octet-stream"].some(type => contentType.includes(type))) {
      console.warn("Unexpected content type:", contentType);
    }

    const fileName =
      medicalRegister.name?.endsWith(".pdf")
        ? medicalRegister.name
        : `${medicalRegister.name || `medical-register-${idx}`}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const stream = new PassThrough();
    const readableStream = toNodeReadableStream(fileResponse.body);
    readableStream.pipe(stream).pipe(res);

    stream.on("error", (streamError) => {
      console.error("Stream error:", streamError);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to stream file", error: streamError.message });
      }
    });
  } catch (error) {
    console.error("Error in downloadMedicalRegister:", {
      message: error.message,
      stack: error.stack,
      index,
      userId,
    });
    if (!res.headersSent) {
      res.status(500).json({ message: "Failed to download file", error: error.message });
    }
  }
};


export const viewMedicalRegisterPDF = async (req, res) => {
  const { index } = req.params;
  const userId = req.user._id;

  try {
    const idx = parseInt(index);
    if (isNaN(idx) || idx < 0) {
      return res.status(400).json({ message: "Invalid index" });
    }

    const patient = await Patient.findOne({ user_id: userId });
    if (!patient) {
      return res.status(404).json({ message: "Patient profile not found" });
    }

    if (!Array.isArray(patient.medical_register) || idx >= patient.medical_register.length) {
      return res.status(404).json({ message: `Medical register at index ${idx} not found` });
    }

    const medicalRegister = patient.medical_register[idx];
    if (!medicalRegister?.public_id) {
      return res.status(404).json({ message: "Medical register entry is invalid" });
    }

    const fullPublicId = `medical_registers/${medicalRegister.public_id}`;
    console.log("Fetching PDF from Cloudinary with public_id:", fullPublicId);

    const pdfUrl = cloudinary.url(fullPublicId, {
      resource_type: "raw",
      sign_url: true,
    });

    console.log("Generated Cloudinary URL:", pdfUrl);

    const fileResponse = await fetch(pdfUrl);

    if (!fileResponse.ok) {
      throw new Error(`Failed to fetch file from Cloudinary: ${fileResponse.statusText}`);
    }

    const contentType = fileResponse.headers.get("content-type") || "";
    if (!contentType.includes("pdf") && !contentType.includes("octet-stream")) {
      return res.status(415).json({ message: "Unsupported file type" });
    }

    const fileName =
      medicalRegister.name?.endsWith(".pdf")
        ? medicalRegister.name
        : `${medicalRegister.name || `medical-register-${idx}`}.pdf`;

    // Set headers for viewing in browser
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);

    const stream = new PassThrough();
    const readableStream = toNodeReadableStream(fileResponse.body);
    readableStream.pipe(stream).pipe(res);

    stream.on("error", (err) => {
      console.error("Stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ message: "Stream failed", error: err.message });
      }
    });
  } catch (error) {
    console.error("Error in viewMedicalRegisterPDF:", {
      message: error.message,
      stack: error.stack,
      index,
      userId,
    });
    if (!res.headersSent) {
      res.status(500).json({ message: "Failed to stream file", error: error.message });
    }
  }
};


// Delete Medical Register
export const deleteMedicalRegister = async (req, res) => {
  const { index } = req.params;
  const userId = req.user._id;

  try {
    const idx = parseInt(index);
    if (isNaN(idx) || idx < 0) {
      return res.status(400).json({ message: "Invalid index" });
    }

    const patient = await Patient.findOne({ user_id: userId });
    if (!patient) {
      return res.status(404).json({ message: "Patient profile not found" });
    }

    if (!patient.medical_register || !Array.isArray(patient.medical_register)) {
      return res.status(404).json({ message: "No medical registers found" });
    }

    if (idx >= patient.medical_register.length) {
      return res.status(404).json({ message: `Medical register at index ${idx} not found` });
    }

    const medicalRegister = patient.medical_register[idx];
    if (!medicalRegister || !medicalRegister.public_id) {
      console.error("Invalid medical register entry at index", idx, medicalRegister);
      return res.status(404).json({ message: "Medical register entry is invalid" });
    }

    const fullPublicId = `medical_registers/${medicalRegister.public_id}`;
    await cloudinary.uploader.destroy(fullPublicId, {
      resource_type: "raw",
    });

    patient.medical_register.splice(idx, 1);
    await patient.save();

    res.status(200).json({ message: "Medical register deleted successfully" });
  } catch (error) {
    console.error("Error in deleteMedicalRegister:", {
      message: error.message,
      stack: error.stack,
      index,
      userId,
    });
    res.status(500).json({ message: "Failed to delete medical register", error: error.message });
  }
};

// Get Patient Profile
export const getPatientProfile = async (req, res) => {
  try {
    const patient = await Patient.findOne({ user_id: req.user._id }).populate(
      "user_id",
      "name email phone_number profile_image isBanned"
    );
    if (!patient) {
      return res.status(404).json({ message: "Patient profile not found" });
    }
    res.status(200).json({ patient });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Get Announcements
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

// Get Patient Appointments
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

// Add Favorite Healthcare
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

// Remove Favorite Healthcare
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

// Get Favorite Healthcare
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
              .select("speciality clinic_name price");
            break;
          case "nurse":
            typeSpecificData = await Nurse.findOne({ healthcare_id: healthcare._id })
              .select("ward clinic_name price");
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
          working_hours: healthcare.working_hours || "Mon-Fri 9 AM - 5 PM",
          can_deliver: healthcare.can_deliver,
          ...typeSpecificData?._doc,
        };
      })
    );

    const validFavorites = favorites.filter((fav) => fav !== null);
    res.status(200).json(validFavorites || []);
  } catch (error) {
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

// Rate Appointment
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

// Get Patient Profile by ID
export const getPatientProfileById = async (req, res) => {
  const { patientId } = req.params;

  try {
    const requester = await userModel.findById(req.user._id);
    if (!requester || requester.user_type !== "healthcare") {
      return res.status(403).json({ message: "Unauthorized: Only healthcare providers can access patient profiles" });
    }

    const patient = await Patient.findOne({ user_id: patientId }).populate(
      "user_id",
      "name email phone_number profile_image isBanned"
    );
    if (!patient) {
      return res.status(404).json({ message: "Patient profile not found" });
    }

    res.status(200).json({ patient });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Parse Working Hours
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
    const patient = await userModel.findById(req.user._id);
    if (patient.isBanned) {
      return res.status(403).json({ message: "Banned users cannot create appointments" });
    }

    const healthcare = await userModel.findById(user_id);
    if (!healthcare || healthcare.user_type !== "healthcare" || !healthcare.isApproved || healthcare.isBanned) {
      return res.status(404).json({ message: "Healthcare provider not found, not approved, or banned" });
    }

    const healthcareDetails = await HealthCare.findOne({ user_id });
    const { startHour, endHour } = parseWorkingHours(healthcareDetails?.working_hours);

    // Parse the appointment date and time
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

    // Check for overlapping appointments
    const existingAppointments = await Appointment.find({
      user_id,
      status: { $in: ["pending", "active"] },
      date: {
        $gte: new Date(apptDate.getTime() - apptDuration * 60000),
        $lte: apptEnd,
      },
    });

    for (const existingAppt of existingAppointments) {
      const existingStart = new Date(existingAppt.date);
      const [existingHours, existingMinutes] = existingAppt.time.split(":").map(Number);
      existingStart.setUTCHours(existingHours, existingMinutes);
      const existingEnd = new Date(existingStart);
      existingEnd.setMinutes(existingEnd.getMinutes() + (existingAppt.duration || 30));

      if (apptDate < existingEnd && apptEnd > existingStart) {
        return res.status(400).json({ message: "Time slot is already booked" });
      }
    }

    // Check for overlapping unavailable slots
    const unavailableSlots = await UnavailableSlot.find({
      healthcare_id: user_id,
      date: { $eq: new Date(date) },
    });

    for (const slot of unavailableSlots) {
      const [startHours, startMinutes] = slot.startTime.split(":").map(Number);
      const [endHours, endMinutes] = slot.endTime.split(":").map(Number);
      const slotStart = new Date(slot.date);
      slotStart.setUTCHours(startHours, startMinutes);
      const slotEnd = new Date(slot.date);
      slotEnd.setUTCHours(endHours, endMinutes);

      const apptTime = new Date(apptDate);
      const apptEndTime = new Date(apptEnd);

      if (apptTime < slotEnd && apptEndTime > slotStart) {
        return res.status(400).json({ message: "This time slot is marked as unavailable by the healthcare provider" });
      }
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

    const notification = new Notification({
      user_id: user_id,
      type: "appointment_request",
      message: `New appointment request from ${patient.name} on ${new Date(date).toLocaleDateString()} at ${time}`,
      related_id: appointment._id,
    });
    await notification.save();

    const io = req.app.get("io");
    const users = req.app.get("users");
    const recipientSocket = users.get(user_id.toString());
    if (recipientSocket) {
      io.to(recipientSocket).emit("receive_notification", notification);
    }

    await sendEmail(
      healthcare.email,
      "New Appointment Request",
      `
        <p>Dear ${healthcare.name},</p>
        <p>You have a new appointment request from <strong>${patient.name}</strong> on <strong>${new Date(
          date
        ).toLocaleDateString()} at ${time}</strong>.</p>
        <p>Please review and accept or reject the appointment through the platform.</p>
        <p>Best regards,<br>The MedTrack Team</p>
      `
    );

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
    maxDate.setDate(now.getDate() + 30);

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

    const unavailableSlots = await UnavailableSlot.find({
      healthcare_id: healthcareId,
      date: { $gte: now, $lte: maxDate },
    });

    const unavailableSlotTimes = unavailableSlots.map((slot) => {
      const slotDate = new Date(slot.date);
      const [startHours, startMinutes] = slot.startTime.split(":").map(Number);
      const [endHours, endMinutes] = slot.endTime.split(":").map(Number);

      const startDateTime = new Date(slotDate);
      startDateTime.setUTCHours(startHours, startMinutes);
      const endDateTime = new Date(slotDate);
      endDateTime.setUTCHours(endHours, endMinutes);

      return {
        start: startDateTime.toISOString(),
        end: endDateTime.toISOString(),
        time: slot.startTime,
        duration: (endDateTime - startDateTime) / 60000,
        isFullDay: slot.startTime === "00:00" && slot.endTime === "23:59", 
      };
    });

    const healthcare = await HealthCare.findOne({ user_id: healthcareId });
    const { startHour, endHour } = parseWorkingHours(healthcare?.working_hours);

    const fullDayUnavailableDates = unavailableSlotTimes
      .filter((slot) => slot.isFullDay)
      .map((slot) => new Date(slot.start).toISOString().split("T")[0]);

    res.status(200).json({
      slots: [...bookedSlots, ...unavailableSlotTimes],
      workingHours: { startHour, endHour },
      fullDayUnavailableDates, 
    });
  } catch (error) {
    console.error("Error in getHealthcareAvailability:", error.message, error.stack);
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};