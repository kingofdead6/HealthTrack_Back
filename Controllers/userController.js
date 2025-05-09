import userModel from "../Models/userModel.js";
import HealthCare from "../Models/healthCareModel.js";
import Doctor from "../Models/doctorModel.js";
import Nurse from "../Models/nurseModel.js";
import Pharmacy from "../Models/pharmacyModel.js";
import Laboratory from "../Models/laboratoryModel.js";
import Patient from "../Models/patientModel.js";
import Report from "../Models/reportModel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import validator from "validator";
import nodemailer from "nodemailer";
import cloudinary from "../utils/cloudinary.js";
import { PassThrough } from "stream";

// Generate JWT token for user authentication
const createToken = (_id) => {
  return jwt.sign({ _id }, process.env.JWT_SECRET, { expiresIn: "3d" });
};

// Send email using nodemailer
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
  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    throw error;
  }
};

// Register a new user (patient or healthcare provider)
export const registerUser = async (req, res) => {
  const {
    name,
    email,
    password,
    phone_number,
    user_type,
    location_link,
    healthcare_type,
    working_hours,
    can_deliver,
    speciality,
    ward,
    lab_name,
    equipment,
    pharmacy_name,
    clinic_name,
  } = req.body;

  const certificate = req.files?.certificate?.[0];

  try {
    // Validate required fields and input
    if (!name || !email || !password || !phone_number || !user_type) {
      return res.status(400).json({ message: "All user fields are required" });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: "Invalid email" });
    }
    if (!validator.isStrongPassword(password, { minSymbols: 0 })) {
      return res.status(400).json({ message: "Password must be strong" });
    }

    const userTypeString = String(user_type).trim().toLowerCase();
    const validUserTypes = ["patient", "healthcare"];
    if (!validUserTypes.includes(userTypeString)) {
      return res.status(400).json({ message: "Invalid user type" });
    }

    // Validate healthcare-specific fields
    if (userTypeString === "healthcare" && (!location_link || !healthcare_type || !working_hours || !certificate)) {
      return res.status(400).json({ message: "All healthcare fields, including certificate, are required" });
    }

    // Check for existing user
    const existingUser = await userModel.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }

    // Upload certificate to Cloudinary if provided
    let certificateUrl = null;
    if (certificate) {
      certificateUrl = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: "certificates",
            public_id: `${Date.now()}-${certificate.originalname}`,
            resource_type: "image",
          },
          (error, result) => {
            if (error) {
              return reject(new Error(`Cloudinary upload failed: ${error.message}`));
            }
            resolve(result.secure_url);
          }
        );

        const bufferStream = new PassThrough();
        bufferStream.end(certificate.buffer);
        bufferStream.pipe(uploadStream);

        bufferStream.on("error", (error) => {
          reject(error);
        });
      });

      if (!certificateUrl) {
        throw new Error("Failed to obtain certificate URL from Cloudinary");
      }
    }

    // Create and save new user
    const salt = await bcrypt.genSalt(10);
    const hashed_password = await bcrypt.hash(password, salt);
    const user = new userModel({
      name,
      email,
      hashed_password,
      phone_number,
      user_type: userTypeString,
      isApproved: userTypeString === "patient",
    });
    await user.save();

    // Create patient or healthcare record
    if (userTypeString === "patient") {
      const patient = new Patient({ user_id: user._id });
      await patient.save();
    } else if (userTypeString === "healthcare") {
      const healthCare = new HealthCare({
        user_id: user._id,
        location_link,
        healthcare_type,
        working_hours,
        can_deliver: can_deliver === "true" || can_deliver === true,
        certificate: certificateUrl,
      });
      await healthCare.save();

      // Save healthcare-specific details
      switch (healthcare_type) {
        case "doctor":
          if (!speciality) return res.status(400).json({ message: "Speciality is required for doctors" });
          await new Doctor({ healthcare_id: healthCare._id, speciality, clinic_name }).save();
          break;
        case "nurse":
          await new Nurse({ healthcare_id: healthCare._id, ward, clinic_name }).save();
          break;
        case "laboratory":
          if (!lab_name) return res.status(400).json({ message: "Lab name is required for laboratories" });
          await new Laboratory({ healthcare_id: healthCare._id, lab_name, equipment, clinic_name }).save();
          break;
        case "pharmacy":
          if (!pharmacy_name) return res.status(400).json({ message: "Pharmacy name is required for pharmacies" });
          await new Pharmacy({ healthcare_id: healthCare._id, pharmacy_name }).save();
          break;
        default:
          return res.status(400).json({ message: "Invalid healthcare type" });
      }

      // Notify admin of new healthcare provider registration
      await sendEmail(
        process.env.ADMIN_EMAIL,
        "New Healthcare Provider Registration",
        `
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
            <title>New Registration</title>
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
              <h2>New Provider Registration</h2>
              <p>A new healthcare provider has registered on the HealthTrack platform.</p>
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p>Please review and approve their registration from the admin dashboard.</p>
              <div class="footer">
                © ${new Date().getFullYear()} HealthTrack Admin Panel
              </div>
            </div>
          </body>
          </html>
        `
      );
    }

    // Return token and user details
    const token = createToken(user._id);
    res.status(201).json({
      token,
      user: { _id: user._id, name, email, user_type: user.user_type, isApproved: user.isApproved },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Login user and return JWT token
export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    // Check user credentials
    const user = await userModel.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.hashed_password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Generate token and include healthcare type if applicable
    const token = createToken(user._id);
    let healthcare_type = null;
    if (user.user_type === "healthcare") {
      const healthcare = await HealthCare.findOne({ user_id: user._id });
      healthcare_type = healthcare ? healthcare.healthcare_type : null;
    }

    res.status(200).json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        user_type: user.user_type,
        isApproved: user.isApproved,
        healthcare_type,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error during login" });
  }
};

// Get details of the authenticated user
export const getCurrentUser = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Include healthcare type if applicable
    let healthcare_type = null;
    if (user.user_type === "healthcare") {
      const healthcare = await HealthCare.findOne({ user_id: user._id });
      healthcare_type = healthcare ? healthcare.healthcare_type : null;
    }

    res.status(200).json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        user_type: user.user_type,
        isApproved: user.isApproved,
        phone_number: user.phone_number,
        isBanned: user.isBanned,
        healthcare_type,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Get all users (admin only)
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
        if (user.user_type === "healthcare") {
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

// Ban a user (admin only)
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

// Unban a user (admin only)
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

// Delete a user and related records (admin only)
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

// Request password reset
export const requestPasswordReset = async (req, res) => {
  const { email } = req.body;
  try {
    // Validate input
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }
    const user = await userModel.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate and save reset token
    const resetToken = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
    user.resetToken = resetToken;
    user.resetTokenExpires = Date.now() + 3600000;
    await user.save();

    // Send reset email
    const resetUrl = `${process.env.FRONTEND_URL}/change-password?token=${resetToken}`;
    const html = `
      <p>You requested a password reset. Click the link below to reset your password:</p>
      <a href="${resetUrl}"><button style="padding: 10px 20px; background-color: #A5CCFF; color: white; border: none; border-radius: 5px;">Reset Password</button></a>
      <p>This link will expire in 1 hour.</p>
    `;
    await sendEmail(email, "Password Reset Request", html);
    res.status(200).json({ message: "Password reset email sent" });
  } catch (error) {
    res.status(500).json({ message: "Server error during password reset request" });
  }
};

// Change password using reset token
export const changePassword = async (req, res) => {
  const { password, token } = req.body;

  try {
    // Validate input
    if (!password || !token) {
      return res.status(400).json({ message: "Password and token are required" });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    const user = await userModel.findById(decoded._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Validate token and expiration
    if (user.resetToken !== token || user.resetTokenExpires < Date.now()) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    // Validate new password
    if (!validator.isStrongPassword(password,  { minSymbols: 0 })) {
      return res.status(400).json({ message: "Password must be strong" });
    }

    // Update password
    const salt = await bcrypt.genSalt(10);
    const hashed_password = await bcrypt.hash(password, salt);
    user.hashed_password = hashed_password;
    user.resetToken = null;
    user.resetTokenExpires = null;
    await user.save();

    res.status(200).json({ message: "Password reset successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error during password reset" });
  }
};

// Report a user
export const reportUser = async (req, res) => {
  const { reported_id, reason } = req.body;
  const reporter_id = req.user._id;

  try {
    // Validate input
    if (!reported_id || !reason) {
      return res.status(400).json({ message: "Reported user ID and reason are required" });
    }

    const reportedUser = await userModel.findById(reported_id);
    if (!reportedUser) {
      return res.status(404).json({ message: "Reported user not found" });
    }

    // Prevent self-reporting
    if (reporter_id.toString() === reported_id.toString()) {
      return res.status(400).json({ message: "You cannot report yourself" });
    }

    // Save report
    const report = new Report({
      reporter_id,
      reported_id,
      reason,
    });
    await report.save();

    res.status(201).json({ message: "Report submitted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error while submitting report" });
  }
};

// Add a new admin (admin only)
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