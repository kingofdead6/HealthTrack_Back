import Patient from "../Models/patientModel.js";
import { PassThrough } from "stream";
import { Readable } from "stream";
import jwt from "jsonwebtoken";
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
import cloudinary from "../utils/cloudinary.js";

const sendEmail = async (toEmail, subject, html) => {
  // Creates a nodemailer transporter using Gmail service.
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER, // Retrieves the sender's email from environment variables.
      pass: process.env.EMAIL_PASS, // Retrieves the sender's email password from environment variables.
    },
  });

  // Defines the email options.
  const mailOptions = {
    from: process.env.EMAIL_USER, // Sets the sender's email address.
    to: toEmail, // Sets the recipient's email address.
    subject, // Sets the email subject.
    html, // Sets the email body, which can contain HTML.
  };

  // Sends the email using the transporter.
  await transporter.sendMail(mailOptions);
};

const sendDeletionEmail = async (toEmail, token, frontendUrl) => {
  // Creates a nodemailer transporter using Gmail service (similar to sendEmail).
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  // Constructs the account deletion link with a unique token.
  const deletionLink = `${frontendUrl}/delete-account?token=${token}`;
  // Defines the email options for the account deletion email.
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: toEmail,
    subject: "MedTrack - Account Deletion Request",
    // HTML content for the deletion confirmation email.
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 20px auto;
            background-color: #ffffff;
            border-radius: 8px;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
            overflow: hidden;
          }
          .header {
            background-color: #007bff;
            color: #ffffff;
            padding: 20px;
            text-align: center;
          }
          .header h1 {
            margin: 0;
            font-size: 24px;
          }
          .content {
            padding: 20px;
            color: #333333;
          }
          .content p {
            line-height: 1.6;
            margin: 0 0 15px;
          }
          .button {
            display: inline-block;
            padding: 12px 25px;
            background-color: #dc3545;
            color: #ffffff;
            text-decoration: none;
            border-radius: 5px;
            font-weight: bold;
          }
          .button:hover {
            background-color: #c82333;
          }
          .footer {
            background-color: #f8f9fa;
            padding: 15px;
            text-align: center;
            font-size: 12px;
            color: #666666;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>MedTrack</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>We’ve received a request to delete your MedTrack account. If this wasn’t you, please ignore this email.</p>
            <p>To proceed with the account deletion, please click the button below and enter your password to confirm. This link will expire in 1 hour for your security.</p>
            <p style="text-align: center;">
              <a href="${deletionLink}" class="button">Confirm Account Deletion</a>
            </p>
            <p>If you have any questions, feel free to contact our support team.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} MedTrack. All rights reserved.</p>
            <p>This is an automated message, please do not reply directly to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };

  try {
    // Sends the account deletion email.
    await transporter.sendMail(mailOptions);
  } catch (error) {
    // If sending the email fails, it throws the error.
    throw error;
  }
};

// Controller function to handle the request for account deletion.
export const requestAccountDeletion = async (req, res) => {
  try {
    // Finds the user by their ID from the request object (assuming middleware has added it).
    const user = await userModel.findById(req.user._id);
    // Checks if the user exists and is a patient.
    if (!user || user.user_type !== "patient") {
      return res.status(404).json({ message: "Patient not found" });
    }

    // Retrieves the frontend URL from the request body.
    const { frontendUrl } = req.body;
    // Checks if the frontend URL is provided.
    if (!frontendUrl) {
      return res.status(400).json({ message: "Frontend URL is required" });
    }

    // Creates a JWT token containing the user ID, valid for 1 hour.
    const deletionToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET, // Retrieves the JWT secret from environment variables.
      { expiresIn: "1h" }
    );

    // Sends the account deletion email with the generated token and frontend URL.
    await sendDeletionEmail(user.email, deletionToken, frontendUrl);

    // Responds with a success message.
    res.status(200).json({ message: "Deletion request sent. Please check your email." });
  } catch (error) {
    // Handles any errors that occur during the process.
    res.status(500).json({ message: `Failed to send deletion email: ${error.message}` });
  }
};

// Controller function to confirm and process the account deletion.
export const confirmAccountDeletion = async (req, res) => {
  // Retrieves the token and password from the request body.
  const { token, password } = req.body;

  try {
    // Verifies the JWT token using the secret key.
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Finds the user associated with the decoded user ID.
    const user = await userModel.findById(decoded.userId);
    // Checks if the user exists and is a patient.
    if (!user || user.user_type !== "patient") {
      return res.status(404).json({ message: "Invalid or expired token" });
    }

    // Compares the provided password with the user's hashed password.
    const isMatch = await bcrypt.compare(password, user.hashed_password);
    // If the passwords don't match, returns an error.
    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect password" });
    }

    // Deletes the patient's specific data and then the user's core data.
    await Patient.deleteOne({ user_id: user._id });
    await userModel.deleteOne({ _id: user._id });

    // Responds with a success message.
    res.status(200).json({ message: "Account deleted successfully" });
  } catch (error) {
    // Handles specific token expiration errors.
    if (error.name === "TokenExpiredError") {
      return res.status(400).json({ message: "Deletion token has expired" });
    }
    // Handles other server errors.
    res.status(500).json({ message: "Server error" });
  }
};

// Controller function to update the patient's profile information.
export const updatePatientProfile = async (req, res) => {
  // Extracts relevant fields from the request body.
  const { gender, height, weight, blood_type, medical_state, phone_number } = req.body;
  // Extracts the uploaded profile image file from the request.
  const profileImageFile = req.file;

  try {
    // Finds the patient profile associated with the authenticated user's ID.
    const patient = await Patient.findOne({ user_id: req.user._id });
    // If the patient profile is not found, returns a 404 error.
    if (!patient) {
      return res.status(404).json({ message: "Patient profile not found" });
    }

    // Updates the patient's profile fields if new values are provided.
    patient.gender = gender || patient.gender;
    patient.height = height || patient.height;
    patient.weight = weight || patient.weight;
    patient.blood_type = blood_type || patient.blood_type;
    patient.medical_state = medical_state || patient.medical_state;
    // Saves the updated patient profile.
    await patient.save();

    // Finds the user associated with the authenticated user's ID.
    const user = await userModel.findById(req.user._id);
    // If the user is not found, returns a 404 error.
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Initializes the profile image URL with the existing one.
    let profileImageUrl = user.profile_image;

    // Handles the profile image upload if a new file is provided.
    if (profileImageFile) {
      try {
        // If the user already has a profile image, attempts to delete it from Cloudinary.
        if (user.profile_image) {
          const publicId = user.profile_image.split("/").pop().split(".")[0];
          await cloudinary.uploader.destroy(`profiles/patients/${publicId}`).catch((err) => {
            // Catch and potentially log errors during deletion (non-blocking).
          });
        }

        // Uploads the new profile image to Cloudinary.
        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "profiles/patients", // Specifies the Cloudinary folder.
              public_id: `${req.user._id}_${Date.now()}`, // Creates a unique public ID.
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
          stream.end(profileImageFile.buffer); // Streams the buffer to Cloudinary.
        });

        // Updates the profile image URL with the Cloudinary URL.
        profileImageUrl = uploadResult.secure_url;
        // Updates the user's profile image in the database.
        user.profile_image = profileImageUrl;
      } catch (uploadError) {
        // Handles errors that occur during the image upload.
        return res.status(500).json({
          message: "Failed to upload image",
          error: uploadError.message,
        });
      }
    }

    // Updates the user's phone number if provided.
    if (phone_number) {
      user.phone_number = phone_number;
    }

    // Saves the updated user information.
    await user.save();

    // Retrieves the updated user data (excluding sensitive information).
    const updatedUser = await userModel.findById(req.user._id).select(
      "name email phone_number profile_image isBanned"
    );
    // Responds with a success message and the updated patient and user data.
    res.status(200).json({
      message: "Profile updated successfully",
      patient,
      user: updatedUser,
    });
  } catch (error) {
    // Handles any server errors during the profile update process.
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Controller function to upload a medical register (PDF file) for a patient.
export const uploadMedicalRegister = async (req, res) => {
  // Extracts the user ID from the authenticated request.
  const userId = req.user._id;
  // Extracts the uploaded file from the request.
  const file = req.file;
  // Extracts a custom name for the medical register from the request body.
  const customName = req.body.name;

  try {
    // Finds the patient associated with the authenticated user ID.
    const patient = await Patient.findOne({ user_id: userId });
    // If the patient is not found, returns a 404 error.
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    // Checks if a file was uploaded.
    if (!file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // Checks if the uploaded file is a PDF.
    if (file.mimetype !== "application/pdf") {
      return res.status(400).json({ message: "Only PDF files are allowed" });
    }

    // Creates a new medical register entry object.
    const newRegister = {
      name: customName || `medical-register-${patient.medical_register.length + 1}`, // Uses custom name or generates a default name.
      data: file.buffer, // Stores the file buffer directly in the database.
      contentType: file.mimetype, // Stores the MIME type of the file.
      size: file.size // Stores the size of the file.
    };

    // Pushes the new register entry to the patient's medical_register array.
    patient.medical_register.push(newRegister);
    // Saves the updated patient document.
    await patient.save();

    // Responds with a success message and details of the uploaded register.
    res.status(200).json({
      message: "Medical register uploaded successfully",
      register: {
        name: newRegister.name,
        size: newRegister.size,
        uploadedAt: newRegister.uploadedAt // Automatically generated timestamp.
      }
    });
  } catch (error) {
    // Handles any server errors during the file upload process.
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Controller function to download a specific medical register (PDF) of a patient.
export const downloadMedicalRegister = async (req, res) => {
  // Extracts the index of the medical register from the request parameters.
  const { index } = req.params;
  // Extracts the authenticated user's ID from the request object.
  const userId = req.user._id;

  try {
    // Parses the index from the string to an integer.
    const idx = parseInt(index);
    // Checks if the parsed index is a valid non-negative number.
    if (isNaN(idx) || idx < 0) {
      return res.status(400).json({ message: "Invalid index" });
    }

    // Finds the patient profile associated with the authenticated user's ID.
    const patient = await Patient.findOne({ user_id: userId });
    // If the patient profile is not found, returns a 404 error.
    if (!patient) {
      return res.status(404).json({ message: "Patient profile not found" });
    }

    // Checks if the medical_register array exists and if the requested index is within its bounds.
    if (!Array.isArray(patient.medical_register) || idx >= patient.medical_register.length) {
      return res.status(404).json({ message: `Medical register at index ${idx} not found` });
    }

    // Retrieves the specific medical register entry using the provided index.
    const medicalRegister = patient.medical_register[idx];
    // Checks if the retrieved medical register entry has data.
    if (!medicalRegister?.data) {
      return res.status(404).json({ message: "Medical register entry is invalid" });
    }

    // Set headers for file download.
    const fileName = medicalRegister.name?.endsWith(".pdf")
      ? medicalRegister.name
      : `${medicalRegister.name || `medical-register-${idx}`}.pdf`;

    res.setHeader("Content-Type", medicalRegister.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", medicalRegister.size);

    // Sends the PDF buffer directly as the response.
    res.send(medicalRegister.data);
  } catch (error) {
    // Handles any errors that occur during the process.
    res.status(500).json({ message: "Failed to download file", error: error.message });
  }
};

// Controller function to view a specific medical register (PDF) of a patient in the browser.
export const viewMedicalRegisterPDF = async (req, res) => {
  // Extracts the index of the medical register from the request parameters.
  const { index } = req.params;
  // Extracts the authenticated user's ID from the request object.
  const userId = req.user._id;

  try {
    // Parses the index from the string to an integer.
    const idx = parseInt(index);
    // Checks if the parsed index is a valid non-negative number.
    if (isNaN(idx) || idx < 0) {
      return res.status(400).json({ message: "Invalid index" });
    }

    // Finds the patient profile associated with the authenticated user's ID.
    const patient = await Patient.findOne({ user_id: userId });
    // If the patient profile is not found, returns a 404 error.
    if (!patient) {
      return res.status(404).json({ message: "Patient profile not found" });
    }

    // Checks if the medical_register array exists and if the requested index is within its bounds.
    if (!Array.isArray(patient.medical_register) || idx >= patient.medical_register.length) {
      return res.status(404).json({ message: `Medical register at index ${idx} not found` });
    }

    // Retrieves the specific medical register entry using the provided index.
    const medicalRegister = patient.medical_register[idx];
    // Checks if the retrieved medical register entry has data.
    if (!medicalRegister?.data) {
      return res.status(404).json({ message: "Medical register entry is invalid" });
    }

    // Set headers for viewing in browser.
    const fileName = medicalRegister.name?.endsWith(".pdf")
      ? medicalRegister.name
      : `${medicalRegister.name || `medical-register-${idx}`}.pdf`;

    res.setHeader("Content-Type", medicalRegister.contentType);
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    res.setHeader("Content-Length", medicalRegister.size);

    // Sends the PDF buffer directly as the response for inline viewing.
    res.send(medicalRegister.data);
  } catch (error) {
    // Handles any errors that occur during the process.
    res.status(500).json({ message: "Failed to view file", error: error.message });
  }
};

// Controller function to delete a specific medical register of a patient.
export const deleteMedicalRegister = async (req, res) => {
  // Extracts the index of the medical register to delete from the request parameters.
  const { index } = req.params;
  // Extracts the authenticated user's ID from the request object.
  const userId = req.user._id;

  try {
    // Parses the index from the string to an integer.
    const idx = parseInt(index);
    // Checks if the parsed index is a valid non-negative number.
    if (isNaN(idx) || idx < 0) {
      return res.status(400).json({ message: "Invalid index" });
    }

    // Finds the patient profile associated with the authenticated user's ID.
    const patient = await Patient.findOne({ user_id: userId });
    // If the patient profile is not found, returns a 404 error.
    if (!patient) {
      return res.status(404).json({ message: "Patient profile not found" });
    }

    // Checks if the medical_register array exists.
    if (!patient.medical_register || !Array.isArray(patient.medical_register)) {
      return res.status(404).json({ message: "No medical registers found" });
    }

    // Checks if the requested index is within the bounds of the medical_register array.
    if (idx >= patient.medical_register.length) {
      return res.status(404).json({ message: `Medical register at index ${idx} not found` });
    }

    // Removes the medical register entry at the specified index.
    patient.medical_register.splice(idx, 1);
    // Saves the updated patient document.
    await patient.save();

    // Responds with a success message.
    res.status(200).json({ message: "Medical register deleted successfully" });
  } catch (error) {
    // Handles any errors that occur during the process.
    res.status(500).json({ message: "Failed to delete medical register", error: error.message });
  }
};

// Controller function to retrieve the patient's profile information.
export const getPatientProfile = async (req, res) => {
  try {
    // Finds the patient profile associated with the authenticated user's ID and populates the 'user_id' field.
    const patient = await Patient.findOne({ user_id: req.user._id }).populate(
      "user_id", // The field to populate.
      "name email phone_number profile_image isBanned" // The fields to select from the populated 'userModel'.
    );
    // If the patient profile is not found, returns a 404 error.
    if (!patient) {
      return res.status(404).json({ message: "Patient profile not found" });
    }
    // Responds with the patient profile data.
    res.status(200).json({ patient });
  } catch (error) {
    // Handles any server errors during the process.
    res.status(500).json({ message: "Server error" });
  }
};

// Controller function to retrieve all announcements.
export const getAnnouncements = async (req, res) => {
  try {
    // Finds all announcements and populates the 'healthcare_id' field.
    const announcements = await Announcement.find()
      .populate({
        path: "healthcare_id", // The field to populate.
        select: "name", // The field to select from the populated 'userModel'.
        model: userModel, // Specifies the model to use for population.
      })
      .sort({ createdAt: -1 }); // Sorts the announcements by creation date in descending order.

    // If no announcements are found, returns a 404 error.
    if (!announcements) {
      return res.status(404).json({ message: "No announcements found" });
    }

    // Responds with the array of announcements.
    res.status(200).json(announcements);
  } catch (error) {
    // Handles any server errors during the process.
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

// Controller function to retrieve the appointments of the authenticated patient.
export const getPatientAppointments = async (req, res) => {
  try {
    // Finds all appointments associated with the authenticated patient's ID and populates the 'user_id' field.
    const appointments = await Appointment.find({ patient_id: req.user._id })
      .populate({
        path: "user_id", // The field to populate (referencing the healthcare provider).
        select: "name", // The field to select from the populated 'userModel'.
        model: userModel, // Specifies the model to use for population.
      })
      .sort({ date: -1 }); // Sorts the appointments by date in descending order.

    // Enriches the appointment data by fetching the healthcare provider's type.
    const enrichedAppointments = await Promise.all(
      appointments.map(async (appointment) => {
        let healthcareType = "Unknown";
        // Checks if the 'user_id' and its '_id' exist in the appointment object.
        if (appointment.user_id && appointment.user_id._id) {
          // Finds the healthcare provider's profile to get their type.
          const healthcare = await HealthCare.findOne({ user_id: appointment.user_id._id });
          healthcareType = healthcare ? healthcare.healthcare_type : "Unknown";
        }

        // Returns a new object combining the appointment data with the healthcare type.
        return {
          ...appointment._doc, // Includes all existing properties of the appointment.
          healthcare_type: healthcareType, // Adds the healthcare type.
        };
      })
    );
    // Responds with the enriched array of appointments.
    res.status(200).json(enrichedAppointments);
  } catch (error) {
    // Handles any server errors during the process.
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

// Controller function to add a healthcare provider to the patient's favorites list.
export const addFavoriteHealthcare = async (req, res) => {
  // Extracts the ID of the healthcare provider to add to favorites from the request body.
  const { healthcare_id } = req.body;

  try {
    // Finds the patient profile associated with the authenticated user's ID.
    const patient = await Patient.findOne({ user_id: req.user._id });
    // If the patient profile is not found, returns a 404 error.
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    // Finds the healthcare provider by their ID and checks if they exist and are of type 'healthcare'.
    const healthcare = await userModel.findById(healthcare_id);
    if (!healthcare || healthcare.user_type !== "healthcare") {
      return res.status(404).json({ message: "Healthcare provider not found" });
    }

    // Initializes the 'favorites' array if it doesn't exist.
    if (!patient.favorites) patient.favorites = [];
    // Adds the healthcare provider's ID to the favorites list if it's not already there.
    if (!patient.favorites.includes(healthcare_id)) {
      patient.favorites.push(healthcare_id);
      // Saves the updated patient profile.
      await patient.save();
    }

    // Responds with a success message.
    res.status(200).json({ message: "Added to favorites successfully" });
  } catch (error) {
    // Handles any server errors during the process.
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

// Controller function to remove a healthcare provider from the patient's favorites list.
export const removeFavoriteHealthcare = async (req, res) => {
  // Extracts the ID of the healthcare provider to remove from favorites from the request body.
  const { healthcare_id } = req.body;

  try {
    // Finds the patient profile associated with the authenticated user's ID.
    const patient = await Patient.findOne({ user_id: req.user._id });
    // If the patient profile is not found, returns a 404 error.
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    // Checks if the 'favorites' array exists and includes the healthcare provider's ID.
    if (patient.favorites && patient.favorites.includes(healthcare_id)) {
      // Filters out the healthcare provider's ID from the favorites list.
      patient.favorites = patient.favorites.filter(id => id.toString() !== healthcare_id.toString());
      // Saves the updated patient profile.
      await patient.save();
    }

    // Responds with a success message.
    res.status(200).json({ message: "Removed from favorites successfully" });
  } catch (error) {
    // Handles any server errors during the process.
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

// Controller function to retrieve the list of the patient's favorite healthcare providers.
export const getFavoriteHealthcare = async (req, res) => {
  try {
    // Finds the patient profile associated with the authenticated user's ID.
    const patient = await Patient.findOne({ user_id: req.user._id });
    // If the patient profile is not found, returns a 404 error.
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    // Iterates over the patient's favorites list and fetches detailed information for each healthcare provider.
    const favorites = await Promise.all(
      patient.favorites.map(async (userId) => {
        // Finds the user details (name, email, etc.) of the favorite healthcare provider.
        const user = await userModel.findById(userId).select("name email phone_number profile_image");
        // Finds the generic healthcare provider details (type, location, etc.).
        const healthcare = await HealthCare.findOne({ user_id: userId });
        // If either user or healthcare info is missing, returns null for this entry.
        if (!user || !healthcare) return null;

        let typeSpecificData = {};
        // Fetches type-specific data based on the healthcare provider's type.
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

        // Returns a combined object with user details, generic healthcare info, and type-specific data.
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
          ...typeSpecificData?._doc, // Includes type-specific data if available.
        };
      })
    );

    // Filters out any null entries (due to missing user or healthcare info).
    const validFavorites = favorites.filter((fav) => fav !== null);
    // Responds with the array of favorite healthcare providers.
    res.status(200).json(validFavorites || []);
  } catch (error) {
    // Handles any server errors during the process.
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

// Rate Appointment
export const rateAppointment = async (req, res) => {
  const { appointmentId, rating, comment } = req.body;

  // Validate input
  if (!appointmentId || rating === undefined || !comment) {
    return res.status(400).json({ message: "Appointment ID, rating, and comment are required" });
  }

  // Validate rating range
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ message: "Rating must be between 1 and 5" });
  }

  try {
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    // Ensure only the correct patient can rate
    if (appointment.patient_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized to rate this appointment" });
    }

    // Only completed appointments can be rated
    if (appointment.status !== "completed") {
      return res.status(400).json({ message: "Can only rate completed appointments" });
    }

    // Prevent duplicate rating
    if (appointment.rating) {
      return res.status(400).json({ message: "Appointment already rated" });
    }

    // Save rating and comment
    appointment.rating = rating;
    appointment.comment = comment;
    await appointment.save();

    res.status(200).json({ message: "Rating submitted successfully", appointment });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Get Patient Profile by ID
export const getPatientProfileById = async (req, res) => {
  const { patientId } = req.params;

  try {
    const requester = await userModel.findById(req.user._id);

    // Only healthcare providers can access patient profiles
    if (!requester || requester.user_type !== "healthcare") {
      return res.status(403).json({ message: "Unauthorized: Only healthcare providers can access patient profiles" });
    }

    // Find and populate patient info
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

// Utility: Parse working hours string into start and end hours
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
    return { startHour: 9, endHour: 17 };
  }
};

// Create Appointment
export const createAppointment = async (req, res) => {
  const { user_id, date, time, message, duration } = req.body;

  try {
    const patient = await userModel.findById(req.user._id);

    // Prevent banned users from booking
    if (patient.isBanned) {
      return res.status(403).json({ message: "Banned users cannot create appointments" });
    }

    const healthcare = await userModel.findById(user_id);

    // Validate healthcare provider
    if (!healthcare || healthcare.user_type !== "healthcare" || !healthcare.isApproved || healthcare.isBanned) {
      return res.status(404).json({ message: "Healthcare provider not found, not approved, or banned" });
    }

    const healthcareDetails = await HealthCare.findOne({ user_id });
    const { startHour, endHour } = parseWorkingHours(healthcareDetails?.working_hours);

    // Convert date and time to UTC
    const apptDate = new Date(date);
    const [hours, minutes] = time.split(":");
    apptDate.setUTCHours(parseInt(hours), parseInt(minutes), 0, 0);

    const apptDuration = parseInt(duration) || 30;
    const apptEnd = new Date(apptDate);
    apptEnd.setMinutes(apptEnd.getMinutes() + apptDuration);

    const apptHour = apptDate.getUTCHours() + apptDate.getUTCMinutes() / 60;
    const apptEndHour = apptHour + apptDuration / 60;

    // Ensure appointment is within working hours
    if (apptHour < startHour || apptEndHour > endHour) {
      return res.status(400).json({ message: `Appointment outside working hours (${startHour}:00 - ${endHour}:00)` });
    }

    // Appointment must be within the next 30 days
    const now = new Date();
    const maxDate = new Date(now);
    maxDate.setDate(now.getDate() + 30);

    if (apptDate < now || apptDate > maxDate) {
      return res.status(400).json({ message: "Appointments must be within today and 30 days ahead" });
    }

    // Check for overlapping existing appointments
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

    // Check for healthcare's unavailable slots
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

      if (apptDate < slotEnd && apptEnd > slotStart) {
        return res.status(400).json({ message: "This time slot is marked as unavailable by the healthcare provider" });
      }
    }

    // Save appointment
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

    // Create and send notification
    const notification = new Notification({
      user_id: user_id,
      type: "appointment_request",
      message: `New appointment request from ${patient.name} on ${new Date(date).toLocaleDateString()} at ${time}`,
      related_id: appointment._id,
    });

    await notification.save();

    // Emit real-time notification if healthcare is online
    const io = req.app.get("io");
    const users = req.app.get("users");
    const recipientSocket = users.get(user_id.toString());
    if (recipientSocket) {
      io.to(recipientSocket).emit("receive_notification", notification);
    }

    // Send email notification
    await sendEmail(
      healthcare.email,
      "New Appointment Request",
      `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
          <title>New Appointment Request</title>
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
            <h2>New Appointment Request</h2>
            <p>Dear <strong>${healthcare.name}</strong>,</p>
            <p>You have a new appointment request from <strong>${patient.name}</strong> on <strong>${new Date(
              date
            ).toLocaleDateString()} at ${time}</strong>.</p>
            <p>Please review and accept or reject the appointment through the platform.</p>
            <div class="footer">
              &copy; ${new Date().getFullYear()} HealthTrack | Connecting Healthcare Professionals with Patients.
            </div>
          </div>
        </body>
        </html>
      `
    );

    res.status(201).json({ message: "Appointment request sent successfully", appointment });
  } catch (error) {
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};


// Get available healthcare slots for the next 30 days
export const getHealthcareAvailability = async (req, res) => {
  const { healthcareId } = req.params;

  try {
    const now = new Date();
    const maxDate = new Date(now);
    maxDate.setDate(now.getDate() + 30); // Set range to 30 days from now

    // Fetch appointments within the 30-day window
    const appointments = await Appointment.find({
      user_id: healthcareId,
      date: { $gte: now, $lte: maxDate },
      status: { $in: ["pending", "active"] },
    });

    // Map booked slots with start and end time
    const bookedSlots = appointments.map((appt) => ({
      start: new Date(appt.date).toISOString(),
      time: appt.time,
      duration: appt.duration || 30,
      end: new Date(new Date(appt.date).getTime() + (appt.duration || 30) * 60000).toISOString(),
    }));

    // Fetch unavailable time ranges for the healthcare provider
    const unavailableSlots = await UnavailableSlot.find({
      healthcare_id: healthcareId,
      date: { $gte: now, $lte: maxDate },
    });

    // Map unavailable slots with start and end times
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

    // Get working hours for the provider
    const healthcare = await HealthCare.findOne({ user_id: healthcareId });
    const { startHour, endHour } = parseWorkingHours(healthcare?.working_hours);

    // Extract full-day unavailable dates
    const fullDayUnavailableDates = unavailableSlotTimes
      .filter((slot) => slot.isFullDay)
      .map((slot) => new Date(slot.start).toISOString().split("T")[0]);

    // Respond with all relevant availability data
    res.status(200).json({
      slots: [...bookedSlots, ...unavailableSlotTimes],
      workingHours: { startHour, endHour },
      fullDayUnavailableDates,
    });
  } catch (error) {
    // Handle any server error
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};
