import HealthCare from "../Models/healthCareModel.js";
import Doctor from "../Models/doctorModel.js";
import Nurse from "../Models/nurseModel.js";
import Pharmacy from "../Models/pharmacyModel.js";
import Laboratory from "../Models/laboratoryModel.js";
import userModel from "../Models/userModel.js";
import Appointment from "../Models/appointmentModel.js";
import Announcement from "../Models/announcementModel.js";
import UnavailableSlot from "../Models/unavailableSlotModel.js";
import OneTimeToken from "../Models/oneTimeTokenModel.js";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import Chat from "../Models/chatModel.js";
import Notification from "../Models/notificationModel.js";
import cloudinary from "../cloudinary.js";
import QRCode from "qrcode";
import { jsPDF } from "jspdf"
const sendEmail = async (toEmail, subject, html, attachments = []) => {
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
    attachments,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Email sent successfully to ${toEmail}`);
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
};

const checkApproval = async (req, res, next) => {
  try {
    const user = await userModel.findById(req.user._id);
    if (!user || user.user_type !== "healthcare") {
      return res.status(403).json({ message: "Unauthorized: Not a healthcare provider" });
    }
    if (!user.isApproved) {
      return res.status(403).json({ message: "Account not approved yet. Please wait for admin approval." });
    }
    next();
  } catch (error) {
    console.error("Approval check error:", error);
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
    let startHour = parseInt(start.split(" ")[0]);
    let endHour = parseInt(end.split(" ")[0]);
    if (start.includes("PM") && start !== "12 PM") startHour += 12;
    if (end.includes("PM") && end !== "12 PM") endHour += 12;
    if (start.includes("AM") && start === "12 AM") startHour = 0;
    if (end.includes("AM") && end === "12 AM") endHour = 0;
    return { startHour, endHour };
  } catch (error) {
    console.error("Error parsing working hours:", error.message);
    return { startHour: 9, endHour: 17 };
  }
};

// Get Healthcare Availability
export const getHealthcareAvailability = async (req, res) => {
  const { healthcareId } = req.params;
  try {
    const now = new Date();
    const maxDate = new Date(now);
    maxDate.setDate(now.getDate() + 7);

    // Fetch booked appointments
    const appointments = await Appointment.find({
      user_id: healthcareId,
      date: { $gte: now, $lte: maxDate },
      status: { $in: ["pending", "active"] },
    });

    const bookedSlots = appointments.map((appt) => {
      const start = new Date(appt.date);
      const [hours, minutes] = appt.time.split(":").map(Number);
      start.setUTCHours(hours, minutes, 0, 0);
      const duration = appt.duration || 30;
      const end = new Date(start.getTime() + duration * 60000);
      return {
        start: start.toISOString(),
        time: appt.time,
        duration: duration,
        end: end.toISOString(),
      };
    });

    // Fetch unavailable slots
    const unavailableSlots = await UnavailableSlot.find({
      healthcare_id: healthcareId,
      date: { $gte: now, $lte: maxDate },
    });

    const unavailableSlotTimes = unavailableSlots.map((slot) => {
      const slotDate = new Date(slot.date);
      const [startHours, startMinutes] = slot.startTime.split(":").map(Number);
      const [endHours, endMinutes] = slot.endTime.split(":").map(Number);

      const startDateTime = new Date(slotDate);
      startDateTime.setUTCHours(startHours, startMinutes, 0, 0);
      const endDateTime = new Date(slotDate);
      endDateTime.setUTCHours(endHours, endMinutes, 0, 0);

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

    // Identify fully unavailable days
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

// New Endpoint: Validate QR Code and Generate PDF
export const validateQRCodeAndGeneratePDF = async (req, res) => {
  let qrData, qrToken, appointmentId;

  if (req.method === "GET") {
    const { data, token } = req.query;
    qrData = data;
    qrToken = token;
    console.log("GET request received:", { qrData, qrToken });
  } else if (req.method === "POST") {
    const { qrData: bodyQrData } = req.body;
    qrData = bodyQrData;
    console.log("POST request received:", { qrData });
  } else {
    console.error("Unsupported method:", req.method);
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    if (!qrData) {
      console.error("Missing QR code data");
      return res.status(400).json({ message: "Missing QR code data" });
    }

    let qrContent;
    try {
      qrContent = JSON.parse(req.method === "GET" ? decodeURIComponent(qrData) : qrData);
      console.log("Parsed QR code content:", qrContent);
    } catch (parseError) {
      console.error("Invalid QR code data format:", parseError.message);
      return res.status(400).json({ message: "Invalid QR code data format" });
    }

    appointmentId = qrContent.appointmentId;
    if (!appointmentId) {
      console.error("QR code missing appointment ID");
      return res.status(400).json({ message: "QR code missing appointment ID" });
    }

    if (req.method === "GET") {
      if (!qrToken) {
        console.error("Missing QR code token");
        return res.status(400).json({ message: "Missing QR code token" });
      }

      let decodedToken;
      try {
        decodedToken = jwt.verify(qrToken, process.env.JWT_SECRET);
      } catch (jwtError) {
        console.error("JWT verification failed:", jwtError.message);
        return res.status(401).json({ message: "Invalid or expired token" });
      }

      const tokenRecord = await OneTimeToken.findOne({
        token: qrToken,
        appointmentId: decodedToken.appointmentId,
        userId: decodedToken.userId,
      });

      if (!tokenRecord) {
        console.error("Token not found in database");
        return res.status(401).json({ message: "Invalid or expired token" });
      }
    } else if (req.method === "POST") {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        console.error("Missing or invalid Authorization header");
        return res.status(401).json({ message: "Unauthorized: Missing or invalid token" });
      }

      const token = authHeader.split(" ")[1];
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (jwtError) {
        console.error("Bearer token verification failed:", jwtError.message);
        return res.status(401).json({ message: "Unauthorized: Invalid token" });
      }

      const user = await userModel.findById(decoded._id);
      if (!user) {
        console.error("User not found for Bearer token");
        return res.status(401).json({ message: "Unauthorized: User not found" });
      }
    }

    // Fetch appointment and patient data
    const appointment = await Appointment.findById(appointmentId)
      .populate("patient_id", "name email phone_number")
      .populate("user_id", "name");
    if (!appointment) {
      console.error("Appointment not found:", appointmentId);
      return res.status(404).json({ message: "Appointment not found" });
    }

    const patient = await userModel.findById(appointment.patient_id._id).lean();
    const healthcare = await HealthCare.findOne({ user_id: appointment.user_id._id }).lean();

    if (!patient || !healthcare) {
      console.error("Patient or healthcare provider not found");
      return res.status(404).json({ message: "Patient or healthcare provider not found" });
    }

    console.log("Generating PDF for appointment:", appointmentId);

    // Generate PDF
    const doc = new jsPDF();
    doc.setFontSize(12);

    let yOffset = 10;
    const lineHeight = 10;
    const pageHeight = doc.internal.pageSize.height;
    const maxWidth = 180;

    doc.text("APPOINTMENT INFORMATION", 10, yOffset);
    yOffset += lineHeight;
    doc.text("------------------------", 10, yOffset);
    yOffset += lineHeight;
    doc.text(`Appointment ID: ${appointment._id}`, 10, yOffset);
    yOffset += lineHeight;
    doc.text(`Healthcare Provider: ${appointment.user_id.name || "Not provided"}`, 10, yOffset);
    yOffset += lineHeight;
    doc.text(`Date: ${new Date(appointment.date).toLocaleDateString()}`, 10, yOffset);
    yOffset += lineHeight;
    doc.text(`Time: ${appointment.time || "Not provided"}`, 10, yOffset);
    yOffset += lineHeight;
    doc.text(`Duration: ${appointment.duration || 30} minutes`, 10, yOffset);
    yOffset += lineHeight;
    const reasonText = appointment.message || "Not provided";
    const reasonLines = doc.splitTextToSize(`Reason: ${reasonText}`, maxWidth);
    doc.text(reasonLines, 10, yOffset);
    yOffset += reasonLines.length * lineHeight;
    yOffset += lineHeight;

    doc.text("PATIENT INFORMATION", 10, yOffset);
    yOffset += lineHeight;
    doc.text("------------------------", 10, yOffset);
    yOffset += lineHeight;
    doc.text(`Name: ${patient.name || "Not provided"}`, 10, yOffset);
    yOffset += lineHeight;
    doc.text(`Email: ${patient.email || "Not provided"}`, 10, yOffset);
    yOffset += lineHeight;
    doc.text(`Phone Number: ${patient.phone_number || "Not provided"}`, 10, yOffset);
   

    const pdfBuffer = doc.output("arraybuffer");

    if (req.method === "GET" && qrToken) {
      await OneTimeToken.deleteOne({ token: qrToken });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=appointment_${appointment._id}_${patient.name || "patient"}.pdf`
    );

    res.status(200).send(Buffer.from(pdfBuffer));
  } catch (error) {
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

// Modified updateAppointmentStatus to include appointmentId in QR code
export const updateAppointmentStatus = [
  async (req, res) => {
    const { appointmentId } = req.params;
    const { status } = req.body;

    try {
      const appointment = await Appointment.findById(appointmentId)
        .populate("patient_id", "name email")
        .populate("user_id", "name");

      if (!appointment) {
        return res.status(404).json({ message: "Appointment not found" });
      }

      const validStatuses = ["pending", "active", "completed", "rejected"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid status value" });
      }

      if (status === "active" && appointment.status !== "pending") {
        return res.status(400).json({ message: "Only pending appointments can be validated to active" });
      }

      if (status === "rejected" && appointment.status !== "pending") {
        return res.status(400).json({ message: "Only pending appointments can be rejected" });
      }

      appointment.status = status;
      if (status === "active") {
        const qrData = JSON.stringify({
          patientName: appointment.patient_id.name,
          doctorName: appointment.user_id.name,
          date: new Date(appointment.date).toLocaleDateString(),
          time: appointment.time,
          appointmentId: appointment._id.toString(), // Include appointmentId
        });

        const qrCodeDataUrl = await QRCode.toDataURL(qrData);
        const qrCodeBuffer = Buffer.from(qrCodeDataUrl.split(",")[1], "base64");

        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "appointment_qrcodes",
              public_id: `qrcode_${appointmentId}_${Date.now()}`,
              resource_type: "image",
            },
            (error, result) => {
              if (error) return reject(error);
              resolve(result);
            }
          );
          stream.end(qrCodeBuffer);
        });

        appointment.qrCodeUrl = uploadResult.secure_url;
      }

      await appointment.save();

      const io = req.app.get("io");
      const users = req.app.get("users");

      if (status === "active") {
        const existingChat = await Chat.findOne({
          patient_id: appointment.patient_id._id,
          healthcare_id: appointment.user_id._id,
        });

        let chatId;
        if (!existingChat) {
          const chat = new Chat({
            patient_id: appointment.patient_id._id,
            healthcare_id: appointment.user_id._id,
            appointment_ids: [appointmentId],
          });
          await chat.save();
          chatId = chat._id;
        } else {
          existingChat.appointment_ids = existingChat.appointment_ids || [];
          if (!existingChat.appointment_ids.includes(appointmentId)) {
            existingChat.appointment_ids.push(appointmentId);
            await existingChat.save();
          }
          chatId = existingChat._id;
        }

        const patientNotification = new Notification({
          user_id: appointment.patient_id._id,
          type: "appointment_accepted",
          message: `Your appointment with ${appointment.user_id.name} on ${new Date(
            appointment.date
          ).toLocaleDateString()} at ${appointment.time} has been accepted. Chat is now open.`,
          related_id: appointment._id,
        });
        await patientNotification.save();

        const patientSocket = users.get(appointment.patient_id._id.toString());
        if (patientSocket) {
          io.to(patientSocket).emit("receive_notification", patientNotification);
        }

        const patientEmail = appointment.patient_id.email;
        const qrCodeData = JSON.stringify({
          patientName: appointment.patient_id.name,
          doctorName: appointment.user_id.name,
          date: new Date(appointment.date).toLocaleDateString(),
          time: appointment.time,
          appointmentId: appointment._id.toString(),
        });
        const qrCodeDataUrl = await QRCode.toDataURL(qrCodeData);
        const qrCodeBuffer = Buffer.from(qrCodeDataUrl.split(",")[1], "base64");

        await sendEmail(
          patientEmail,
          "Appointment Accepted - Your QR Code",
          `
            <p>Dear ${appointment.patient_id.name},</p>
            <p>Your appointment with <strong>${appointment.user_id.name}</strong> on <strong>${new Date(
              appointment.date
            ).toLocaleDateString()} at ${appointment.time}</strong> has been accepted.</p>
            <p>Please find your appointment QR code attached below. Present this at the time of your appointment.</p>
            <p>You can now chat with your doctor through the platform.</p>
            <p>Best regards,<br>The MedTrack Team</p>
          `,
          [
            {
              filename: "appointment-qrcode.png",
              content: qrCodeBuffer,
              cid: "qrcode",
            },
          ]
        );
      }

      if (status === "rejected") {
        const patientNotification = new Notification({
          user_id: appointment.patient_id._id,
          type: "appointment_rejected",
          message: `Your appointment with ${appointment.user_id.name} on ${new Date(
            appointment.date
          ).toLocaleDateString()} at ${appointment.time} was rejected.`,
          related_id: appointment._id,
        });
        await patientNotification.save();

        const patientSocket = users.get(appointment.patient_id._id.toString());
        if (patientSocket) {
          io.to(patientSocket).emit("receive_notification", patientNotification);
        }

        const patientEmail = appointment.patient_id.email;
        await sendEmail(
          patientEmail,
          "Appointment Rejected",
          `
            <p>Dear ${appointment.patient_id.name},</p>
            <p>Your appointment with <strong>${appointment.user_id.name}</strong> on <strong>${new Date(
              appointment.date
            ).toLocaleDateString()} at ${appointment.time}</strong> has been rejected.</p>
            <p>Please schedule a new appointment if needed.</p>
            <p>Best regards,<br>The MedTrack Team</p>
          `
        );
      }

      res.status(200).json({ message: "Appointment status updated", appointment });
    } catch (error) {
      console.error("Error updating appointment:", error.message, error.stack);
      res.status(500).json({ message: "Server error" });
    }
  },
];

// Remaining controller functions (unchanged)
export const getPendingHealthCare = async (req, res) => {
  try {
    const pendingUsers = await userModel
      .find({ user_type: "healthcare", isApproved: false })
      .select("name email phone_number createdAt profile_image");

    const pendingDetails = await Promise.all(
      pendingUsers.map(async (user) => {
        const healthcare = await HealthCare.findOne({ user_id: user._id });
        if (!healthcare) return null;

        let typeSpecificData = {};
        switch (healthcare.healthcare_type) {
          case "doctor":
            typeSpecificData = await Doctor.findOne({ healthcare_id: healthcare._id });
            break;
          case "nurse":
            typeSpecificData = await Nurse.findOne({ healthcare_id: healthcare._id });
            break;
          case "pharmacy":
            typeSpecificData = await Pharmacy.findOne({ healthcare_id: healthcare._id });
            break;
          case "laboratory":
            typeSpecificData = await Laboratory.findOne({ healthcare_id: healthcare._id });
            break;
          default:
            break;
        }

        return {
          user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            phone_number: user.phone_number,
            profile_image: user.profile_image || "",
            createdAt: user.createdAt,
          },
          healthcare: {
            ...healthcare._doc,
            ...typeSpecificData?._doc,
          },
        };
      })
    );

    res.status(200).json(pendingDetails.filter((detail) => detail !== null));
  } catch (error) {
    console.error("Error fetching pending healthcare:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const approveHealthCare = async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await userModel.findById(userId);
    if (!user || user.user_type !== "healthcare") {
      return res.status(404).json({ message: "User not found or not a healthcare provider" });
    }
    if (user.isApproved) {
      return res.status(400).json({ message: "User is already approved" });
    }

    user.isApproved = true;
    await user.save();

    await sendEmail(
      user.email,
      "Your Application Has Been Approved",
      `
        <p>Dear ${user.name},</p>
        <p>Congratulations! Your application to join the MedTrack platform as a healthcare provider has been approved.</p>
        <p>You can now log in and start managing your profile and appointments.</p>
        <p>Best regards,<br>The MedTrack Team</p>
      `
    );

    res.status(200).json({ message: "Healthcare provider approved successfully" });
  } catch (error) {
    console.error("Error approving healthcare:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const rejectHealthCare = async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await userModel.findById(userId);
    if (!user || user.user_type !== "healthcare") {
      return res.status(404).json({ message: "User not found or not a healthcare provider" });
    }

    const healthcare = await HealthCare.findOne({ user_id: userId });
    if (!healthcare) {
      return res.status(404).json({ message: "Healthcare record not found" });
    }

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
      default:
        break;
    }

    await HealthCare.deleteOne({ user_id: userId });
    const subject = "Sorry, Your Application Has Been Rejected";
    const html = `
      <p>Dear ${user.name},</p>
      <p>We regret to inform you that your application to join the MedTrack platform as a healthcare provider has been rejected.</p>
      <p>If you have any questions or need further clarification, please contact our support team.</p>
      <p>Best regards,<br>The MedTrack Team</p>
    `;
    await sendEmail(user.email, subject, html);
    await userModel.deleteOne({ _id: userId });
    res.status(200).json({ message: "Healthcare provider rejected and account deleted successfully" });
  } catch (error) {
    console.error("Error rejecting healthcare provider:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getHealthCareDetails = async (req, res) => {
  try {
    const userId = req.user._id;

    const healthcare = await HealthCare.findOne({ user_id: userId });
    if (!healthcare) {
      return res.status(404).json({ message: "Healthcare details not found" });
    }

    let details = { ...healthcare._doc };

    switch (healthcare.healthcare_type) {
      case "doctor":
        const doctor = await Doctor.findOne({ healthcare_id: healthcare._id }).select("speciality clinic_name price");
        details = { ...details, ...doctor._doc };
        break;
      case "nurse":
        const nurse = await Nurse.findOne({ healthcare_id: healthcare._id }).select("ward clinic_name price");
        details = { ...details, ...nurse._doc };
        break;
      case "pharmacy":
        const pharmacy = await Pharmacy.findOne({ healthcare_id: healthcare._id });
        details = { ...details, ...pharmacy._doc };
        break;
      case "laboratory":
        const laboratory = await Laboratory.findOne({ healthcare_id: healthcare._id });
        details = { ...details, ...laboratory._doc };
        break;
      default:
        return res.status(400).json({ message: "Invalid healthcare type" });
    }

    res.status(200).json(details);
  } catch (error) {
    console.error("Error fetching healthcare details:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getAllApprovedHealthCare = async (req, res) => {
  try {
    const approvedUsers = await userModel
      .find({ user_type: "healthcare", isApproved: true })
      .select("name email phone_number profile_image")
      .lean(); // Use lean for performance

    if (approvedUsers.length === 0) {
      console.log("No approved healthcare providers found in users collection");
      return res.status(200).json([]);
    }

    console.log(
      "Fetched approved healthcare providers:",
      approvedUsers.map((user) => ({
        id: user._id,
        name: user.name,
        email: user.email,
      }))
    );

    const healthcareDetails = await Promise.all(
      approvedUsers.map(async (user) => {
        // Ensure user exists and has valid data
        if (!user._id || !user.name) {
          console.log("Skipping user with missing data:", user._id);
          return null;
        }

        const healthcare = await HealthCare.findOne({ user_id: user._id }).lean();
        if (!healthcare) {
          console.log("No HealthCare record for user:", user._id);
          return null;
        }

        let typeSpecificData = {};
        switch (healthcare.healthcare_type) {
          case "doctor":
            typeSpecificData = await Doctor.findOne({ healthcare_id: healthcare._id })
              .select("speciality clinic_name price")
              .lean();
            break;
          case "nurse":
            typeSpecificData = await Nurse.findOne({ healthcare_id: healthcare._id })
              .select("ward clinic_name price")
              .lean();
            break;
          case "pharmacy":
            typeSpecificData = await Pharmacy.findOne({ healthcare_id: healthcare._id })
              .select("pharmacy_name")
              .lean();
            break;
          case "laboratory":
            typeSpecificData = await Laboratory.findOne({ healthcare_id: healthcare._id })
              .select("lab_name equipment clinic_name")
              .lean();
            break;
          default:
            console.log("Unknown healthcare_type for user:", user._id, healthcare.healthcare_type);
            return null;
        }

        if (!typeSpecificData && healthcare.healthcare_type !== "pharmacy") {
          console.log(`No ${healthcare.healthcare_type} data for healthcare_id:`, healthcare._id);
          return null;
        }

        return {
          user_id: user._id,
          name: user.name,
          email: user.email,
          phone_number: user.phone_number || null,
          profile_image: user.profile_image || null,
          healthcare_type: healthcare.healthcare_type,
          location_link: healthcare.location_link || null,
          working_hours: healthcare.working_hours || null,
          can_deliver: healthcare.can_deliver || false,
          ...typeSpecificData,
        };
      })
    );

    const filteredDetails = healthcareDetails.filter((detail) => detail !== null);

    if (filteredDetails.length === 0) {
      console.log("No valid healthcare details after filtering");
    } else {
      console.log(
        "Returning healthcare details:",
        filteredDetails.map((detail) => ({
          user_id: detail.user_id,
          name: detail.name,
          healthcare_type: detail.healthcare_type,
        }))
      );
    }

    res.status(200).json(filteredDetails);
  } catch (error) {
    console.error("Error fetching approved healthcare providers:", error.message, error.stack);
    res.status(500).json({ message: "Server error" });
  }
};

export const getHealthcareAppointments = async (req, res) => {
  try {
    const appointments = await Appointment.find({ user_id: req.user._id })
      .populate({
        path: "patient_id",
        select: "name profile_image",
        model: userModel,
      })
      .sort({ date: -1 })
      .lean(); 

    const transformedAppointments = appointments.map((appointment) => ({
      ...appointment,
      patient_id: {
        _id: appointment.patient_id?._id || null,
        name: appointment.patient_id?.name || "User deleted",
        profile_image: appointment.patient_id?.profile_image || null,
      },
    }));

    console.log("Fetched appointments for healthcare:", req.user._id, transformedAppointments);
    res.status(200).json(transformedAppointments);
  } catch (error) {
    console.error("Error fetching healthcare appointments:", error.message, error.stack);
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

export const getHealthcareProfile = async (req, res) => {
  const { healthcareId } = req.params;

  try {
    const healthcare = await HealthCare.findOne({ user_id: healthcareId });
    if (!healthcare) {
      return res.status(404).json({ message: "Healthcare profile not found" });
    }

    const healthcareUser = await userModel.findById(healthcareId).select("name email phone_number user_type profile_image isBanned isApproved");
    if (!healthcareUser || healthcareUser.user_type !== "healthcare") {
      return res.status(404).json({ message: "Healthcare provider not found" });
    }

    let typeSpecificData = {};
    switch (healthcare.healthcare_type) {
      case "doctor":
        typeSpecificData = await Doctor.findOne({ healthcare_id: healthcare._id }).select("speciality clinic_name price");
        break;
      case "nurse":
        typeSpecificData = await Nurse.findOne({ healthcare_id: healthcare._id }).select("ward clinic_name price");
        break;
      case "pharmacy":
        typeSpecificData = await Pharmacy.findOne({ healthcare_id: healthcare._id }).select("pharmacy_name");
        break;
      case "laboratory":
        typeSpecificData = await Laboratory.findOne({ healthcare_id: healthcare._id }).select("lab_name equipment clinic_name");
        break;
      default:
        break;
    }

    const appointments = await Appointment.find({
      user_id: healthcareId,
      status: "completed",
      rating: { $ne: null },
    }).populate("patient_id", "name");

    const ratings = appointments.map((appt) => appt.rating).filter((r) => r !== null);
    const averageRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : "No ratings yet";
    const comments = appointments.map((appt) => ({
      patientName: appt.patient_id?.name || "Unknown Patient",
      rating: appt.rating || 0,
      comment: appt.comment || "No comment",
      date: appt.date || new Date(),
    }));

    const profile = {
      user_id: healthcareUser._id,
      name: healthcareUser.name || "Unknown Provider",
      email: healthcareUser.email || "Not provided",
      phone_number: healthcareUser.phone_number || "Not provided",
      profile_image: healthcareUser.profile_image || "",
      healthcare_type: healthcare.healthcare_type,
      location_link: healthcare.location_link || "Not provided",
      working_hours: healthcare.working_hours || "Not specified",
      can_deliver: healthcare.can_deliver || false,
      isBanned: healthcareUser.isBanned || false,
      isApproved: healthcareUser.isApproved || false,
      ...typeSpecificData?._doc,
      averageRating,
      comments,
    };

    res.status(200).json(profile);
  } catch (error) {
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

export const updateHealthcareProfile = [
  checkApproval,
  async (req, res) => {
    const userId = req.user._id;
    const {
      phone_number,
      location_link,
      working_hours,
      can_deliver,
      speciality,
      ward,
      pharmacy_name,
      lab_name,
      equipment,
      clinic_name,
      price,
    } = req.body;
    const profileImageFile = req.file;

    try {
      const user = await userModel.findById(userId);
      if (!user || user.user_type !== "healthcare") {
        return res.status(404).json({ message: "User not found or not healthcare" });
      }

      if (phone_number) {
        user.phone_number = phone_number;
      }

      let profileImageUrl = user.profile_image;

      if (profileImageFile) {
        try {
          console.log("Uploading profile image to Cloudinary:", {
            originalname: profileImageFile.originalname,
            mimetype: profileImageFile.mimetype,
            size: profileImageFile.size,
          });

          if (user.profile_image) {
            const publicId = user.profile_image.split("/").pop().split(".")[0];
            await cloudinary.uploader.destroy(`profiles/healthcare/${publicId}`).catch((err) => {
              console.error("Error deleting old image:", err);
            });
          }

          const uploadResult = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              {
                folder: "profiles/healthcare",
                public_id: `${userId}_${Date.now()}`,
                resource_type: "image",
                allowed_formats: ["jpg", "png", "gif"],
              },
              (error, result) => {
                if (error) return reject(error);
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

      await user.save();

      const healthcare = await HealthCare.findOne({ user_id: userId });
      if (!healthcare) {
        return res.status(404).json({ message: "Healthcare profile not found" });
      }

      healthcare.profile_image = profileImageUrl;
      healthcare.location_link = location_link || healthcare.location_link;
      healthcare.working_hours = working_hours || healthcare.working_hours;
      healthcare.can_deliver = can_deliver === "true" || can_deliver === true;

      switch (healthcare.healthcare_type) {
        case "doctor":
          const doctor = await Doctor.findOne({ healthcare_id: healthcare._id });
          if (doctor) {
            doctor.speciality = speciality || doctor.speciality;
            doctor.clinic_name = clinic_name || doctor.clinic_name;
            doctor.price = price ? parseFloat(price) : doctor.price;
            await doctor.save();
          }
          break;
        case "nurse":
          const nurse = await Nurse.findOne({ healthcare_id: healthcare._id });
          if (nurse) {
            nurse.ward = ward || nurse.ward;
            nurse.clinic_name = clinic_name || nurse.clinic_name;
            nurse.price = price ? parseFloat(price) : nurse.price;
            await nurse.save();
          }
          break;
        case "pharmacy":
          const pharmacy = await Pharmacy.findOne({ healthcare_id: healthcare._id });
          if (pharmacy) {
            pharmacy.pharmacy_name = pharmacy_name || pharmacy.pharmacy_name;
            await pharmacy.save();
          }
          break;
        case "laboratory":
          const laboratory = await Laboratory.findOne({ healthcare_id: healthcare._id });
          if (laboratory) {
            laboratory.lab_name = lab_name || laboratory.lab_name;
            laboratory.equipment = equipment || laboratory.equipment;
            laboratory.clinic_name = clinic_name || laboratory.clinic_name;
            await laboratory.save();
          }
          break;
      }

      await healthcare.save();

      const updatedUser = await userModel
        .findById(userId)
        .select("name email phone_number profile_image isBanned")
        .lean();

      let updatedHealthcare = { ...healthcare.toObject() };
      switch (healthcare.healthcare_type) {
        case "doctor":
          const doctor = await Doctor.findOne({ healthcare_id: healthcare._id }).select("speciality clinic_name price");
          updatedHealthcare = { ...updatedHealthcare, ...doctor._doc };
          break;
        case "nurse":
          const nurse = await Nurse.findOne({ healthcare_id: healthcare._id }).select("ward clinic_name price");
          updatedHealthcare = { ...updatedHealthcare, ...nurse._doc };
          break;
        case "pharmacy":
          const pharmacy = await Pharmacy.findOne({ healthcare_id: healthcare._id }).select("pharmacy_name");
          updatedHealthcare = { ...updatedHealthcare, ...pharmacy._doc };
          break;
        case "laboratory":
          const laboratory = await Laboratory.findOne({ healthcare_id: healthcare._id }).select("lab_name equipment clinic_name");
          updatedHealthcare = { ...updatedHealthcare, ...laboratory._doc };
          break;
      }

      res.status(200).json({
        message: "Healthcare profile updated successfully",
        healthcare: {
          ...updatedHealthcare,
          profile_image: profileImageUrl,
        },
        user: updatedUser,
      });
    } catch (error) {
      console.error("Error updating healthcare profile:", error);
      res.status(500).json({
        message: "Server error",
        error: error.message,
      });
    }
  },
];

export const deleteHealthcareRequest = async (req, res) => {
  const token = req.headers.authorization.split(" ")[1];
  const { frontendUrl } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await userModel.findById(decoded._id);
    if (!user || user.user_type !== "healthcare") {
      return res.status(404).json({ message: "User not found or not healthcare" });
    }

    const deletionToken = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
    const deletionLink = `${frontendUrl}/delete-account?token=${deletionToken}`;

    await sendEmail(
      user.email,
      "Account Deletion Request",
      `<p>Click <a href="${deletionLink}">here</a> to confirm account deletion. This link expires in 1 hour.</p>`
    );

    res.status(200).json({ message: "Deletion request sent" });
  } catch (error) {
    console.error("Delete request error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const createAnnouncement = [
  checkApproval,
  async (req, res) => {
    const { title, content } = req.body;

    try {
      const user = await userModel.findById(req.user._id);
      if (!user || user.user_type !== "healthcare") {
        return res.status(403).json({ message: "Unauthorized: Only healthcare providers can create announcements" });
      }

      if (!user.isApproved || user.isBanned) {
        return res.status(403).json({ message: "Account not approved or banned" });
      }

      const announcement = new Announcement({
        title,
        content,
        healthcare_id: req.user._id,
      });

      await announcement.save();
      res.status(201).json({ message: "Announcement created successfully", announcement });
    } catch (error) {
      res.status(500).json({ message: `Server error: ${error.message}` });
    }
  },
];

export const getAllAnnouncements = async (req, res) => {
  try {
    const { visited } = req.query;
    const user = req.user;
    let announcements;

    if (visited === "true" && user && user.user_type === "patient") {
      const acceptedAppointments = await Appointment.find({
        patient_id: user._id,
        status: { $in: ["active", "completed"] },
      }).select("user_id");

      const healthcareIds = [...new Set(acceptedAppointments.map((appt) => appt.user_id.toString()))];

      if (healthcareIds.length === 0) {
        return res.status(200).json([]);
      }

      const doctorHealthCare = await HealthCare.find({
        user_id: { $in: healthcareIds },
        healthcare_type: "doctor",
      }).select("user_id");

      const doctorIds = doctorHealthCare.map((hc) => hc.user_id.toString());

      if (doctorIds.length === 0) {
        return res.status(200).json([]);
      }

      announcements = await Announcement.find({
        healthcare_id: { $in: doctorIds },
      })
        .populate({
          path: "healthcare_id",
          select: "name profile_image",
          model: "User",
        })
        .sort({ createdAt: -1 })
        .lean();
    } else {
      announcements = await Announcement.find()
        .populate({
          path: "healthcare_id",
          select: "name profile_image",
          model: "User",
        })
        .sort({ createdAt: -1 })
        .lean(); 
    }

    const formattedAnnouncements = await Promise.all(
      announcements.map(async (announcement) => {
        let healthcareData = {};
        if (announcement.healthcare_id?._id) {
          const healthcare = await HealthCare.findOne({ user_id: announcement.healthcare_id._id }).select(
            "healthcare_type speciality location_link"
          );
          healthcareData = healthcare
            ? {
                healthcare_type: healthcare.healthcare_type || null,
                speciality: healthcare.speciality || null,
                location_link: healthcare.location_link || null,
              }
            : {};
        }

        return {
          ...announcement,
          healthcare_id: {
            _id: announcement.healthcare_id?._id || null,
            name: announcement.healthcare_id?.name || "User deleted",
            profile_image: announcement.healthcare_id?.profile_image || null,
            ...healthcareData,
          },
        };
      })
    );

    console.log(
      "Fetched announcements:",
      formattedAnnouncements.map((a) => ({
        id: a._id,
        healthcare_id: a.healthcare_id._id,
        healthcare_name: a.healthcare_id.name,
        profile_image: a.healthcare_id.profile_image,
        healthcare_type: a.healthcare_id.healthcare_type,
        speciality: a.healthcare_id.speciality,
      }))
    );

    res.status(200).json(formattedAnnouncements);
  } catch (error) {
    console.error("Error fetching announcements:", error.message, error.stack);
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

export const deleteAnnouncement = async (req, res) => {
  const { announcementId } = req.params;

  try {
    const announcement = await Announcement.findById(announcementId);
    if (!announcement) {
      return res.status(404).json({ message: "Announcement not found" });
    }

    if (announcement.healthcare_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized: Only the creator can delete this announcement" });
    }

    await Announcement.deleteOne({ _id: announcementId });
    console.log("Announcement deleted:", announcementId);
    res.status(200).json({ message: "Announcement deleted successfully" });
  } catch (error) {
    console.error("Error deleting announcement:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const addUnavailableSlot = async (req, res) => {
  try {
    const user = await userModel.findById(req.user._id);
    if (!user || user.user_type !== "healthcare") {
      return res.status(403).json({ message: "Unauthorized: Only healthcare providers can set unavailable slots" });
    }

    if (!Array.isArray(req.body)) {
      return res.status(400).json({ message: "Request body must be an array of slots" });
    }

    const slots = req.body;
    if (slots.length === 0) {
      return res.status(400).json({ message: "At least one slot must be provided" });
    }

    const savedSlots = [];

    for (const slot of slots) {
      const { date, startTime, endTime, reason } = slot;

      console.log("Processing slot:", { date, startTime, endTime, reason });

      if (!date || !startTime || !endTime) {
        return res.status(400).json({ message: "Each slot must include date, startTime, and endTime" });
      }

      if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
        return res.status(400).json({ message: "startTime and endTime must be in HH:MM format" });
      }

      const [startHours, startMinutes] = startTime.split(":").map(Number);
      const [endHours, endMinutes] = endTime.split(":").map(Number);
      const slotDate = new Date(date);

      if (isNaN(slotDate.getTime())) {
        return res.status(400).json({ message: "Invalid date format" });
      }

      const startDateTime = new Date(slotDate);
      startDateTime.setUTCHours(startHours, startMinutes, 0, 0);
      const endDateTime = new Date(slotDate);
      endDateTime.setUTCHours(endHours, endMinutes, 0, 0);

      if (startDateTime >= endDateTime) {
        return res.status(400).json({ message: `End time must be after start time for slot on ${date}` });
      }

      const now = new Date();
      if (startDateTime < now) {
        return res.status(400).json({ message: "Cannot set unavailability in the past" });
      }

      const isFullDay = startTime === "00:00" && endTime === "23:59";
      console.log("Is full day slot:", isFullDay);

      if (isFullDay) {
        const slotDateStart = new Date(slotDate.setHours(0, 0, 0, 0));
        const slotDateEnd = new Date(slotDate.setHours(23, 59, 59, 999));

        const pendingAppointments = await Appointment.find({
          user_id: req.user._id,
          date: { $gte: slotDateStart, $lte: slotDateEnd },
          status: "pending",
        })
          .populate("patient_id", "name email")
          .populate("user_id", "name");

        for (const appointment of pendingAppointments) {
          appointment.status = "rejected";
          await appointment.save();

          const patientNotification = new Notification({
            user_id: appointment.patient_id._id,
            type: "appointment_rejected",
            message: `Your appointment with ${appointment.user_id.name} on ${new Date(
              appointment.date
            ).toLocaleDateString()} at ${appointment.time} was rejected due to the provider marking the day as unavailable${reason ? `: ${reason}` : "."}`,
            related_id: appointment._id,
          });
          await patientNotification.save();

          const io = req.app.get("io");
          const users = req.app.get("users");
          const patientSocket = users.get(appointment.patient_id._id.toString());
          if (patientSocket) {
            io.to(patientSocket).emit("receive_notification", patientNotification);
          }

          const patientEmail = appointment.patient_id.email;
          await sendEmail(
            patientEmail,
            "Appointment Rejected - Provider Unavailability",
            `
              <p>Dear ${appointment.patient_id.name},</p>
              <p>Your appointment with <strong>${appointment.user_id.name}</strong> on <strong>${new Date(
                appointment.date
              ).toLocaleDateString()} at ${appointment.time}</strong> has been rejected.</p>
              <p>The provider has marked this day as unavailable${reason ? `: ${reason}` : ""}. Please schedule a new appointment if needed.</p>
              <p>Best regards,<br>The MedTrack Team</p>
            `
          );
        }

        await UnavailableSlot.deleteMany({
          healthcare_id: req.user._id,
          date: { $gte: slotDateStart, $lte: slotDateEnd },
        });
      } else {
        const existingSlots = await UnavailableSlot.find({
          healthcare_id: req.user._id,
          date: slotDate.toISOString().split("T")[0],
        });

        for (const existingSlot of existingSlots) {
          const [existingStartHours, existingStartMinutes] = existingSlot.startTime.split(":").map(Number);
          const [existingEndHours, existingEndMinutes] = existingSlot.endTime.split(":").map(Number);
          const existingStart = new Date(existingSlot.date);
          existingStart.setUTCHours(existingStartHours, existingStartMinutes, 0, 0);
          const existingEnd = new Date(existingSlot.date);
          existingEnd.setUTCHours(existingEndHours, existingEndMinutes, 0, 0);

          if (startDateTime.getTime() < existingEnd.getTime() && endDateTime.getTime() > existingStart.getTime()) {
            return res.status(400).json({
              message: `Time slot ${startTime}-${endTime} on ${date} overlaps with an existing unavailable slot (${existingSlot.startTime}-${existingSlot.endTime})`,
            });
          }
        }

        const existingAppointments = await Appointment.find({
          user_id: req.user._id,
          date: slotDate.toISOString().split("T")[0],
          status: { $in: ["pending", "active"] },
        });

        for (const appt of existingAppointments) {
          const apptStart = new Date(appt.date);
          const [apptHours, apptMinutes] = appt.time.split(":").map(Number);
          apptStart.setUTCHours(apptHours, apptMinutes, 0, 0);
          const apptEnd = new Date(apptStart.getTime() + (appt.duration || 30) * 60000);

          if (startDateTime.getTime() < apptEnd.getTime() && endDateTime.getTime() > apptStart.getTime()) {
            return res.status(400).json({
              message: `Time slot ${startTime}-${endTime} on ${date} conflicts with an existing appointment at ${appt.time}`,
            });
          }
        }
      }

      const unavailableSlot = new UnavailableSlot({
        healthcare_id: req.user._id,
        date: slotDate,
        startTime,
        endTime,
        reason,
      });

      const savedSlot = await unavailableSlot.save();
      savedSlots.push(savedSlot);
    }

    res.status(201).json({ message: "Unavailable slots added successfully", slot: savedSlots });
  } catch (error) {
    console.error("Error adding unavailable slot:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const getUnavailableSlots = async (req, res) => {
  try {
    const slots = await UnavailableSlot.find({ healthcare_id: req.user._id }).sort({ date: 1, startTime: 1 });
    res.status(200).json(slots);
  } catch (error) {
    console.error("Error fetching unavailable slots:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteUnavailableSlot = async (req, res) => {
  const { slotId } = req.params;

  try {
    const slot = await UnavailableSlot.findById(slotId);
    if (!slot) {
      return res.status(404).json({ message: "Unavailable slot not found" });
    }

    if (slot.healthcare_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized: You can only delete your own unavailable slots" });
    }

    await UnavailableSlot.deleteOne({ _id: slotId });
    res.status(200).json({ message: "Unavailable slot deleted successfully" });
  } catch (error) {
    console.error("Error deleting unavailable slot:", error);
    res.status(500).json({ message: "Server error" });
  }
};