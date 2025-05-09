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
import cloudinary from "../utils/cloudinary.js";
import QRCode from "qrcode";
import { jsPDF } from "jspdf"
// Function to send an email using nodemailer
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
    await transporter.sendMail(mailOptions); // Send the email
  } catch (error) {
    throw error; // Handle email sending error
  }
};

// Middleware to check if user is an approved healthcare provider
const checkApproval = async (req, res, next) => {
  try {
    const user = await userModel.findById(req.user._id);
    if (!user || user.user_type !== "healthcare") {
      return res.status(403).json({ message: "Unauthorized: Not a healthcare provider" });
    }
    if (!user.isApproved) {
      return res.status(403).json({ message: "Account not approved yet. Please wait for admin approval." });
    }
    next(); // Proceed if the user is approved
  } catch (error) {
    res.status(500).json({ message: "Server error" }); // Handle server errors
  }
};

// Function to parse and convert working hours string to time format
const parseWorkingHours = (workingHours) => {
  const hoursString = workingHours && typeof workingHours === "string" && workingHours.includes(" - ")
    ? workingHours
    : "9 AM - 5 PM"; // Default working hours if not provided

  try {
    if (hoursString === "24/7") return { startHour: 0, endHour: 24 }; // Special case for 24/7 hours
    const [start, end] = hoursString.split(" - "); // Extract start and end time
    let startHour = parseInt(start.split(" ")[0]);
    let endHour = parseInt(end.split(" ")[0]);
    
    // Convert PM/AM times to 24-hour format
    if (start.includes("PM") && start !== "12 PM") startHour += 12;
    if (end.includes("PM") && end !== "12 PM") endHour += 12;
    if (start.includes("AM") && start === "12 AM") startHour = 0;
    if (end.includes("AM") && end === "12 AM") endHour = 0;

    return { startHour, endHour }; // Return parsed working hours
  } catch (error) {
    return { startHour: 9, endHour: 17 }; // Default to 9 AM - 5 PM if error occurs
  }
};

// Function to fetch healthcare provider's availability
export const getHealthcareAvailability = async (req, res) => {
  const { healthcareId } = req.params;
  try {
    const now = new Date();
    const maxDate = new Date(now);
    maxDate.setDate(now.getDate() + 30); // Set the max date to 30 days ahead

    // Fetch booked appointments within the next 30 days
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
      return { start: start.toISOString(), time: appt.time, duration, end: end.toISOString() };
    });

    // Fetch unavailable slots for the healthcare provider
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

    // Identify days with full-day unavailability
    const fullDayUnavailableDates = unavailableSlotTimes
      .filter((slot) => slot.isFullDay)
      .map((slot) => new Date(slot.start).toISOString().split("T")[0]);

    res.status(200).json({
      slots: [...bookedSlots, ...unavailableSlotTimes],
      workingHours: { startHour, endHour },
      fullDayUnavailableDates,
    });
  } catch (error) {
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};


// Validate QR Code and Generate PDF
export const validateQRCodeAndGeneratePDF = async (req, res) => {
  let qrData, qrToken, appointmentId;

  // Handle GET or POST method
  if (req.method === "GET") {
    const { data, token } = req.query;
    qrData = data;
    qrToken = token;
  } else if (req.method === "POST") {
    const { qrData: bodyQrData } = req.body;
    qrData = bodyQrData;
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    // Validate QR code data
    if (!qrData) {
      return res.status(400).json({ message: "Missing QR code data" });
    }

    let qrContent;
    try {
      qrContent = JSON.parse(req.method === "GET" ? decodeURIComponent(qrData) : qrData);
    } catch (parseError) {
      return res.status(400).json({ message: "Invalid QR code data format" });
    }

    // Validate appointment ID in QR code
    appointmentId = qrContent.appointmentId;
    if (!appointmentId) {
      return res.status(400).json({ message: "QR code missing appointment ID" });
    }

    // Token validation for GET request
    if (req.method === "GET") {
      if (!qrToken) {
        return res.status(400).json({ message: "Missing QR code token" });
      }

      let decodedToken;
      try {
        decodedToken = jwt.verify(qrToken, process.env.JWT_SECRET);
      } catch (jwtError) {
        return res.status(401).json({ message: "Invalid or expired token" });
      }

      // Validate token record in database
      const tokenRecord = await OneTimeToken.findOne({
        token: qrToken,
        appointmentId: decodedToken.appointmentId,
        userId: decodedToken.userId,
      });

      if (!tokenRecord) {
        return res.status(401).json({ message: "Invalid or expired token" });
      }
    } else if (req.method === "POST") {
      // Validate Authorization token in POST request
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Unauthorized: Missing or invalid token" });
      }

      const token = authHeader.split(" ")[1];
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (jwtError) {
        return res.status(401).json({ message: "Unauthorized: Invalid token" });
      }

      // Check if user exists
      const user = await userModel.findById(decoded._id);
      if (!user) {
        return res.status(401).json({ message: "Unauthorized: User not found" });
      }
    }

    // Fetch appointment and patient data
    const appointment = await Appointment.findById(appointmentId)
      .populate("patient_id", "name email phone_number")
      .populate("user_id", "name");

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    const patient = await userModel.findById(appointment.patient_id._id).lean();
    const healthcare = await HealthCare.findOne({ user_id: appointment.user_id._id }).lean();

    if (!patient || !healthcare) {
      return res.status(404).json({ message: "Patient or healthcare provider not found" });
    }

    // Create PDF
    const doc = new jsPDF();
    doc.setFontSize(12);

    let yOffset = 10;
    const lineHeight = 10;
    const maxWidth = 180;

    // Appointment information
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

    // Patient information
    doc.text("PATIENT INFORMATION", 10, yOffset);
    yOffset += lineHeight;
    doc.text("------------------------", 10, yOffset);
    yOffset += lineHeight;
    doc.text(`Name: ${patient.name || "Not provided"}`, 10, yOffset);
    yOffset += lineHeight;
    doc.text(`Email: ${patient.email || "Not provided"}`, 10, yOffset);
    yOffset += lineHeight;
    doc.text(`Phone Number: ${patient.phone_number || "Not provided"}`, 10, yOffset);

    // Generate PDF buffer
    const pdfBuffer = doc.output("arraybuffer");

    // Clean up token (if GET request)
    if (req.method === "GET" && qrToken) {
      await OneTimeToken.deleteOne({ token: qrToken });
    }

    // Send PDF response
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=appointment_${appointment._id}_${patient.name || "patient"}.pdf`
    );

    res.status(200).send(Buffer.from(pdfBuffer));
  } catch (error) {
    // General error handler
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};


// Update appointment status, generate and upload QR code if activated, and notify patient
export const updateAppointmentStatus = [
  async (req, res) => {
    const { appointmentId } = req.params;
    const { status } = req.body;

    try {
      // Fetch appointment with patient and doctor details
      const appointment = await Appointment.findById(appointmentId)
        .populate("patient_id", "name email")
        .populate("user_id", "name");

      if (!appointment) {
        return res.status(404).json({ message: "Appointment not found" });
      }

      // Validate status
      const validStatuses = ["pending", "active", "completed", "rejected"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid status value" });
      }

      // Prevent invalid status transitions
      if (status === "active" && appointment.status !== "pending") {
        return res.status(400).json({ message: "Only pending appointments can be validated to active" });
      }
      if (status === "rejected" && appointment.status !== "pending") {
        return res.status(400).json({ message: "Only pending appointments can be rejected" });
      }

      appointment.status = status;

      // Handle QR code generation and upload when activating appointment
      if (status === "active") {
        const qrData = JSON.stringify({
          patientName: appointment.patient_id.name,
          doctorName: appointment.user_id.name,
          date: new Date(appointment.date).toLocaleDateString(),
          time: appointment.time,
          appointmentId: appointment._id.toString(),
        });

        // Generate QR code image from data
        const qrCodeDataUrl = await QRCode.toDataURL(qrData);
        const qrCodeBuffer = Buffer.from(qrCodeDataUrl.split(",")[1], "base64");

        // Upload QR code to Cloudinary
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

      // Get WebSocket and user map
      const io = req.app.get("io");
      const users = req.app.get("users");

      // Handle active status: create chat, notify and email patient
      if (status === "active") {
        // Create or update chat between patient and doctor
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

        // Create and send notification
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

        // Send email to patient with embedded QR code
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
          appointment.patient_id.email,
          "Appointment Accepted",
          `
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
              <title>Appointment Confirmation</title>
              <style>
                body {
                  font-family: 'Segoe UI', Roboto, Arial, sans-serif;
                  background-color: #f4f6f8;
                  margin: 0;
                  padding: 40px 0;
                }
                .email-container {
                  max-width: 600px;
                  background-color: #ffffff;
                  margin: auto;
                  padding: 30px;
                  border-radius: 10px;
                  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.06);
                  color: #333333;
                }
                h2 {
                  color: #2a7ae2;
                  margin-top: 0;
                }
                .qr-section {
                  text-align: center;
                  margin: 30px 0;
                }
                .qr-section img {
                  width: 200px;
                  height: auto;
                  border: 1px solid #ddd;
                  border-radius: 8px;
                }
                .footer {
                  margin-top: 40px;
                  font-size: 13px;
                  color: #777;
                  text-align: center;
                }
              </style>
            </head>
            <body>
              <div class="email-container">
                <h2>Appointment Confirmed</h2>
                <p>Dear <strong>${appointment.patient_id.name}</strong>,</p>
                <p>Your appointment has been <strong>accepted</strong>.</p>
                <p>
                  <strong>Doctor:</strong> ${appointment.user_id.name}<br>
                  <strong>Date:</strong> ${new Date(appointment.date).toLocaleDateString()}<br>
                  <strong>Time:</strong> ${appointment.time}
                </p>
                <p>Present the QR code below at your appointment:</p>
                <div class="qr-section">
                  <img src="cid:qrcode" alt="QR Code">
                </div>
                <p>You can now chat with your doctor through the platform.</p>
                <div class="footer">
                  &copy; ${new Date().getFullYear()} HealthTrack | All rights reserved.
                </div>
              </div>
            </body>
            </html>
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

      // Handle rejected status: notify and email patient
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

        await sendEmail(
          appointment.patient_id.email,
          "Appointment Rejected",
          `
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
              <title>Appointment Rejected</title>
              <style>
                body {
                  font-family: 'Segoe UI', Roboto, Arial, sans-serif;
                  background-color: #f4f6f8;
                  margin: 0;
                  padding: 40px 0;
                }
                .email-container {
                  max-width: 600px;
                  background-color: #ffffff;
                  margin: auto;
                  padding: 30px;
                  border-radius: 10px;
                  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.06);
                  color: #333333;
                }
                h2 {
                  color: #e02b2b;
                  margin-top: 0;
                }
                .footer {
                  margin-top: 40px;
                  font-size: 13px;
                  color: #777;
                  text-align: center;
                }
              </style>
            </head>
            <body>
              <div class="email-container">
                <h2>Appointment Rejected</h2>
                <p>Dear <strong>${appointment.patient_id.name}</strong>,</p>
                <p>Your appointment with <strong>${appointment.user_id.name}</strong> on <strong>${new Date(appointment.date).toLocaleDateString()} at ${appointment.time}</strong> has been <strong>rejected</strong>.</p>
                <p>Please consider scheduling a new appointment at your convenience.</p>
                <div class="footer">
                  &copy; ${new Date().getFullYear()} HealthTrack | All rights reserved.
                </div>
              </div>
            </body>
            </html>
          `
        );
      }

      res.status(200).json({ message: "Appointment status updated", appointment });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  },
];

// Get all pending healthcare providers
export const getPendingHealthCare = async (req, res) => {
  try {
    // Find unapproved users with type "healthcare"
    const pendingUsers = await userModel
      .find({ user_type: "healthcare", isApproved: false })
      .select("name email phone_number createdAt profile_image");

    // For each user, get their detailed healthcare info based on type
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

        // Return combined user and healthcare details
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

    // Filter out null entries and return
    res.status(200).json(pendingDetails.filter((detail) => detail !== null));
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Approve a pending healthcare provider
export const approveHealthCare = async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await userModel.findById(userId);

    // Check if user exists and is a healthcare provider
    if (!user || user.user_type !== "healthcare") {
      return res.status(404).json({ message: "User not found or not a healthcare provider" });
    }

    // Prevent double approval
    if (user.isApproved) {
      return res.status(400).json({ message: "User is already approved" });
    }

    // Approve and save user
    user.isApproved = true;
    await user.save();

    // Send approval email
    await sendEmail(
      user.email,
      "Your Application Has Been Approved",
      `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
          <title>Application Approved</title>
          <style>
            body {
              font-family: 'Segoe UI', Roboto, Arial, sans-serif;
              background-color: #f4f6f8;
              margin: 0;
              padding: 40px 0;
            }
            .email-container {
              max-width: 600px;
              background-color: #ffffff;
              margin: auto;
              padding: 30px;
              border-radius: 10px;
              box-shadow: 0 4px 10px rgba(0, 0, 0, 0.06);
              color: #333333;
            }
            h2 {
              color: #2a7ae2;
              margin-top: 0;
            }
            .footer {
              margin-top: 40px;
              font-size: 13px;
              color: #777;
              text-align: center;
            }
          </style>
        </head>
        <body>
          <div class="email-container">
            <h2>Welcome to HealthTrack!</h2>
            <p>Dear <strong>${user.name}</strong>,</p>
            <p>🎉 Congratulations! Your application to join the HealthTrack platform as a healthcare provider has been <strong>approved</strong>.</p>
            <p>You can now log in to your account to complete your profile, set your availability, and begin managing appointments.</p>
            <div class="footer">
              &copy; ${new Date().getFullYear()} HealthTrack | Empowering Healthcare Providers.
            </div>
          </div>
        </body>
        </html>
      `
    );

    res.status(200).json({ message: "Healthcare provider approved successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Reject a pending healthcare provider
export const rejectHealthCare = async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await userModel.findById(userId);

    // Check if user exists and is a healthcare provider
    if (!user || user.user_type !== "healthcare") {
      return res.status(404).json({ message: "User not found or not a healthcare provider" });
    }

    const healthcare = await HealthCare.findOne({ user_id: userId });
    if (!healthcare) {
      return res.status(404).json({ message: "Healthcare record not found" });
    }

    // Delete specific healthcare type record
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

    // Delete general healthcare record
    await HealthCare.deleteOne({ user_id: userId });

    // Prepare rejection email
    const subject = "Sorry, Your Application Has Been Rejected";
    const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Application Rejected</title>
    <style>
      body {
        font-family: 'Segoe UI', Roboto, Arial, sans-serif;
        background-color: #f4f6f8;
        margin: 0;
        padding: 40px 0;
      }
      .email-container {
        max-width: 600px;
        background-color: #ffffff;
        margin: auto;
        padding: 30px;
        border-radius: 10px;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.06);
        color: #333333;
      }
      h2 {
        color: #e02b2b;
        margin-top: 0;
      }
      .footer {
        margin-top: 40px;
        font-size: 13px;
        color: #777;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <div class="email-container">
      <h2>Application Rejected</h2>
      <p>Dear <strong>${user.name}</strong>,</p>
      <p>We regret to inform you that your application to join the <strong>Healthrack</strong> platform as a healthcare provider has been <strong>rejected</strong>.</p>
      <div class="footer">
        &copy; ${new Date().getFullYear()} HealthTrack | Supporting Healthcare Excellence.
      </div>
    </div>
  </body>
  </html>
`;

    // Send rejection email and delete user
    await sendEmail(user.email, subject, html);
    await userModel.deleteOne({ _id: userId });

    res.status(200).json({ message: "Healthcare provider rejected and account deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Get details of a specific healthcare provider based on logged-in user
export const getHealthCareDetails = async (req, res) => {
  try {
    const userId = req.user._id;

    // Find healthcare linked to the user
    const healthcare = await HealthCare.findOne({ user_id: userId });
    if (!healthcare) {
      return res.status(404).json({ message: "Healthcare details not found" });
    }

    let details = { ...healthcare._doc };

    // Fetch additional details based on the type
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
    res.status(500).json({ message: "Server error" });
  }
};

// Get all approved healthcare providers with their relevant details
export const getAllApprovedHealthCare = async (req, res) => {
  try {
    // Get users marked as approved healthcare providers
    const approvedUsers = await userModel
      .find({ user_type: "healthcare", isApproved: true })
      .select("name email phone_number profile_image")
      .lean();

    if (approvedUsers.length === 0) {
      return res.status(200).json([]);
    }

    // Gather type-specific data for each provider
    const healthcareDetails = await Promise.all(
      approvedUsers.map(async (user) => {
        if (!user._id || !user.name) {
          return null;
        }

        const healthcare = await HealthCare.findOne({ user_id: user._id }).lean();
        if (!healthcare) {
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
            return null;
        }

        if (!typeSpecificData && healthcare.healthcare_type !== "pharmacy") {
          return null;
        }

        // Return combined details
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

    // Filter out invalid results
    const filteredDetails = healthcareDetails.filter((detail) => detail !== null);
    res.status(200).json(filteredDetails);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Get appointments for a specific healthcare provider
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

    // Format patient data
    const transformedAppointments = appointments.map((appointment) => ({
      ...appointment,
      patient_id: {
        _id: appointment.patient_id?._id || null,
        name: appointment.patient_id?.name || "User deleted",
        profile_image: appointment.patient_id?.profile_image || null,
      },
    }));

    res.status(200).json(transformedAppointments);
  } catch (error) {
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

// Get detailed profile of a specific healthcare provider by ID
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

    // Get completed appointments with ratings and comments
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

    // Build full profile
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


// Middleware to update healthcare user profile
export const updateHealthcareProfile = [
  checkApproval, // Check if the user is approved to perform the operation
  async (req, res) => {
    const userId = req.user._id;

    // Destructure relevant fields from the request body
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

      // Update phone number if provided
      if (phone_number) {
        user.phone_number = phone_number;
      }

      let profileImageUrl = user.profile_image;

      // Handle profile image upload
      if (profileImageFile) {
        try {
          if (user.profile_image) {
            // Delete old image from Cloudinary
            const publicId = user.profile_image.split("/").pop().split(".")[0];
            await cloudinary.uploader.destroy(`profiles/healthcare/${publicId}`).catch((err) => { throw err });
          }

          // Upload new image to Cloudinary
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
          user.profile_image = profileImageUrl;
        } catch (uploadError) {
          return res.status(500).json({
            message: "Failed to upload image",
            error: uploadError.message,
          });
        }
      }

      await user.save();

      // Fetch healthcare-specific profile
      const healthcare = await HealthCare.findOne({ user_id: userId });
      if (!healthcare) {
        return res.status(404).json({ message: "Healthcare profile not found" });
      }

      // Update general healthcare info
      healthcare.profile_image = profileImageUrl;
      healthcare.location_link = location_link || healthcare.location_link;
      healthcare.working_hours = working_hours || healthcare.working_hours;
      healthcare.can_deliver = can_deliver === "true" || can_deliver === true;

      // Update based on healthcare type
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

      // Fetch updated user and healthcare data
      const updatedUser = await userModel
        .findById(userId)
        .select("name email phone_number profile_image isBanned isApproved")
        .lean();

      let updatedHealthcare = { ...healthcare.toObject(), isApproved: user.isApproved };

      // Attach specific role-based fields to healthcare object
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

      // Return final response
      res.status(200).json({
        message: "Healthcare profile updated successfully",
        healthcare: {
          ...updatedHealthcare,
          profile_image: profileImageUrl,
        },
        user: updatedUser,
      });
    } catch (error) {
      res.status(500).json({
        message: "Server error",
        error: error.message,
      });
    }
  },
];

// Send email with deletion confirmation link
export const deleteHealthcareRequest = async (req, res) => {
  const token = req.headers.authorization.split(" ")[1];
  const { frontendUrl } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await userModel.findById(decoded._id);
    if (!user || user.user_type !== "healthcare") {
      return res.status(404).json({ message: "User not found or not healthcare" });
    }

    // Generate deletion confirmation token
    const deletionToken = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
    const deletionLink = `${frontendUrl}/delete-account?token=${deletionToken}`;

    // Send email to user with confirmation link
    await sendEmail(
      user.email,
      "Account Deletion Request",
      `<p>Click <a href="${deletionLink}">here</a> to confirm account deletion. This link expires in 1 hour.</p>`
    );

    res.status(200).json({ message: "Deletion request sent" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Create a new announcement
export const createAnnouncement = [
  checkApproval, // Ensure user is approved
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

      // Create and save announcement
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

// Get all announcements (with optional filtering by visited doctors)
export const getAllAnnouncements = async (req, res) => {
  try {
    const { visited } = req.query;
    const user = req.user;
    let announcements;

    if (visited === "true" && user && user.user_type === "patient") {
      // Fetch accepted appointments for the patient
      const acceptedAppointments = await Appointment.find({
        patient_id: user._id,
        status: { $in: ["active", "completed"] },
      }).select("user_id");

      const healthcareIds = [...new Set(acceptedAppointments.map((appt) => appt.user_id.toString()))];

      if (healthcareIds.length === 0) {
        return res.status(200).json([]);
      }

      // Get only doctor-type healthcare profiles
      const doctorHealthCare = await HealthCare.find({
        user_id: { $in: healthcareIds },
        healthcare_type: "doctor",
      }).select("user_id");

      const doctorIds = doctorHealthCare.map((hc) => hc.user_id.toString());

      if (doctorIds.length === 0) {
        return res.status(200).json([]);
      }

      // Fetch announcements by those doctors
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
      // Return all announcements if no filtering
      announcements = await Announcement.find()
        .populate({
          path: "healthcare_id",
          select: "name profile_image",
          model: "User",
        })
        .sort({ createdAt: -1 })
        .lean(); 
    }

    // Add extra healthcare metadata to each announcement
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

    res.status(200).json(formattedAnnouncements);
  } catch (error) {
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};


// Deletes a specific announcement if it exists and the requester is authorized
export const deleteAnnouncement = async (req, res) => {
  // Extract announcement ID from the URL parameters
  const { announcementId } = req.params;

  try {
    // Find the announcement in the database by its ID
    const announcement = await Announcement.findById(announcementId);

    // If the announcement doesn't exist, return a 404 error
    if (!announcement) {
      return res.status(404).json({ message: "Announcement not found" });
    }

    // Check if the requester is the creator of the announcement
    if (announcement.healthcare_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized: Only the creator can delete this announcement" });
    }

    // Delete the announcement from the database
    await Announcement.deleteOne({ _id: announcementId });

    // Return a success response
    res.status(200).json({ message: "Announcement deleted successfully" });
  } catch (error) {
    // Catch any server error and return a 500 response
    res.status(500).json({ message: "Server error" });
  }
};


// Adds unavailable slots for a healthcare provider, handling validation and potential conflicts
export const addUnavailableSlot = async (req, res) => {
  try {
    // Retrieve user from the database using their ID from the request (auth token)
    const user = await userModel.findById(req.user._id);

    // Check if the user exists and is a healthcare provider, if not, return unauthorized error
    if (!user || user.user_type !== "healthcare") {
      return res.status(403).json({ message: "Unauthorized: Only healthcare providers can set unavailable slots" });
    }

    // Ensure the request body is an array of slots
    if (!Array.isArray(req.body)) {
      return res.status(400).json({ message: "Request body must be an array of slots" });
    }

    const slots = req.body;

    // Ensure that at least one slot is provided
    if (slots.length === 0) {
      return res.status(400).json({ message: "At least one slot must be provided" });
    }

    const savedSlots = []; // Array to store successfully saved slots

    // Iterate over each slot to validate and save it
    for (const slot of slots) {
      const { date, startTime, endTime, reason } = slot;

      // Ensure each slot has the required fields: date, startTime, and endTime
      if (!date || !startTime || !endTime) {
        return res.status(400).json({ message: "Each slot must include date, startTime, and endTime" });
      }

      // Ensure start and end times are in HH:MM format using regular expressions
      if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
        return res.status(400).json({ message: "startTime and endTime must be in HH:MM format" });
      }

      // Convert start and end times to date objects for further validation
      const [startHours, startMinutes] = startTime.split(":").map(Number);
      const [endHours, endMinutes] = endTime.split(":").map(Number);
      const slotDate = new Date(date);

      // Check if the provided date is valid
      if (isNaN(slotDate.getTime())) {
        return res.status(400).json({ message: "Invalid date format" });
      }

      // Create start and end datetime objects based on the provided date and time
      const startDateTime = new Date(slotDate);
      startDateTime.setUTCHours(startHours, startMinutes, 0, 0);
      const endDateTime = new Date(slotDate);
      endDateTime.setUTCHours(endHours, endMinutes, 0, 0);

      // Ensure that the end time is after the start time
      if (startDateTime >= endDateTime) {
        return res.status(400).json({ message: `End time must be after start time for slot on ${date}` });
      }

      const now = new Date();

      // Ensure that the start time is not in the past
      if (startDateTime < now) {
        return res.status(400).json({ message: "Cannot set unavailability in the past" });
      }

      // Check if the slot represents a full-day unavailability (00:00 to 23:59)
      const isFullDay = startTime === "00:00" && endTime === "23:59";

      // If the slot is a full day, handle special logic to reject pending appointments for the day
      if (isFullDay) {
        const slotDateStart = new Date(slotDate.setHours(0, 0, 0, 0));
        const slotDateEnd = new Date(slotDate.setHours(23, 59, 59, 999));

        // Find all pending appointments for the day and reject them
        const pendingAppointments = await Appointment.find({
          user_id: req.user._id,
          date: { $gte: slotDateStart, $lte: slotDateEnd },
          status: "pending",
        })
          .populate("patient_id", "name email")
          .populate("user_id", "name");

        for (const appointment of pendingAppointments) {
          appointment.status = "rejected"; // Reject the appointment
          await appointment.save();

          // Create a notification for the patient about the rejection
          const patientNotification = new Notification({
            user_id: appointment.patient_id._id,
            type: "appointment_rejected",
            message: `Your appointment with ${appointment.user_id.name} on ${new Date(
              appointment.date
            ).toLocaleDateString()} at ${appointment.time} was rejected due to the provider marking the day as unavailable${reason ? `: ${reason}` : "."}`,
            related_id: appointment._id,
          });
          await patientNotification.save();

          // Emit a notification to the patient in real-time
          const io = req.app.get("io");
          const users = req.app.get("users");
          const patientSocket = users.get(appointment.patient_id._id.toString());
          if (patientSocket) {
            io.to(patientSocket).emit("receive_notification", patientNotification);
          }

          // Send an email notification to the patient
          const patientEmail = appointment.patient_id.email;
          await sendEmail(
            patientEmail,
            "Appointment Rejected - Provider Unavailability",
            `
              <!DOCTYPE html>
              <html lang="en">
              <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
                <title>Appointment Rejected</title>
                <style>
                  body { font-family: 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 40px 0; }
                  .email-container { max-width: 600px; background-color: #ffffff; margin: auto; padding: 30px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.06); color: #333333; }
                  h2 { color: #e02b2b; margin-top: 0; }
                  .footer { margin-top: 40px; font-size: 13px; color: #777; text-align: center; }
                </style>
              </head>
              <body>
                <div class="email-container">
                  <h2>Appointment Rejected</h2>
                  <p>Dear <strong>${appointment.patient_id.name}</strong>,</p>
                  <p>Your appointment with <strong>${appointment.user_id.name}</strong> on <strong>${new Date(
                    appointment.date
                  ).toLocaleDateString()} at ${appointment.time}</strong> has been <strong>rejected</strong>.</p>
                  <p>The provider has marked this day as unavailable${reason ? `: <em>${reason}</em>` : ""}.</p>
                  <p>Please schedule a new appointment if needed.</p>
                  <div class="footer">
                    &copy; ${new Date().getFullYear()} HealthTrack | Enhancing Patient-Doctor Connections.
                  </div>
                </div>
              </body>
              </html>
            `
          );
        }

        // Delete any existing unavailable slots for the day
        await UnavailableSlot.deleteMany({
          healthcare_id: req.user._id,
          date: { $gte: slotDateStart, $lte: slotDateEnd },
        });
      } else {
        // Handle the case for a partial time slot (not a full day)
        const existingSlots = await UnavailableSlot.find({
          healthcare_id: req.user._id,
          date: slotDate.toISOString().split("T")[0],
        });

        // Check for overlapping unavailable slots
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

        // Check for conflicting existing appointments for the specified date and time
        const existingAppointments = await Appointment.find({
          user_id: req.user._id,
          date: slotDate.toISOString().split("T")[0],
          status: { $in: ["pending", "active"] },
        });

        // Check for time conflicts with existing appointments
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

      // Create and save the unavailable slot
      const unavailableSlot = new UnavailableSlot({
        healthcare_id: req.user._id,
        date: slotDate,
        startTime,
        endTime,
        reason,
      });

      const savedSlot = await unavailableSlot.save();
      savedSlots.push(savedSlot); // Add the saved slot to the result array
    }

    // Return a success response with the saved slots
    res.status(201).json({ message: "Unavailable slots added successfully", slot: savedSlots });
  } catch (error) {
    // Catch any server error and return an appropriate message
    res.status(500).json({ message: "Server error", error: error.message });
  }
};


// Fetch all unavailable slots for the current healthcare provider
export const getUnavailableSlots = async (req, res) => {
  try {
    // Find all unavailable slots for the current healthcare provider
    const slots = await UnavailableSlot.find({ healthcare_id: req.user._id })
      .sort({ date: 1, startTime: 1 }); // Sort by date and start time

    // Return the list of unavailable slots
    res.status(200).json(slots);
  } catch (error) {
    // Handle errors and send server error message
    res.status(500).json({ message: "Server error", error: error.message });
  }
};


// Delete a specific unavailable slot by ID
export const deleteUnavailableSlot = async (req, res) => {
  const { slotId } = req.params;

  try {
    // Find the unavailable slot by ID
    const slot = await UnavailableSlot.findById(slotId);
    if (!slot) {
      return res.status(404).json({ message: "Unavailable slot not found" });
    }

    // Check if the slot belongs to the current healthcare provider
    if (slot.healthcare_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized: You can only delete your own unavailable slots" });
    }

    // Delete the unavailable slot
    await UnavailableSlot.deleteOne({ _id: slotId });

    // Send a success response
    res.status(200).json({ message: "Unavailable slot deleted successfully" });
  } catch (error) {
    // Handle errors and send server error message
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
