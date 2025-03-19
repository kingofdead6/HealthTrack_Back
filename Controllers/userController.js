import userModel from "../Models/userModel.js";
import HealthCare from "../Models/healthCareModel.js";
import Doctor from "../Models/doctorModel.js";
import Nurse from "../Models/nurseModel.js";
import Pharmacy from "../Models/pharmacyModel.js";
import Laboratory from "../Models/laboratoryModel.js";
import Patient from "../Models/patientModel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import validator from "validator";
import nodemailer from "nodemailer";

const createToken = (_id) => {
  return jwt.sign({ _id }, process.env.JWT_SECRET, { expiresIn: "3d" });
};

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
    console.log(`Email sent successfully to ${toEmail}`);
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
};

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

  const profileImage = req.files?.profile_image?.[0];
  const certificate = req.files?.certificate?.[0];

  try {
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

    if (userTypeString === "healthcare" && (!location_link || !healthcare_type || !working_hours || !certificate)) {
      return res.status(400).json({ message: "All healthcare fields are required" });
    }

    const existingUser = await userModel.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashed_password = await bcrypt.hash(password, salt);

    const user = new userModel({
      name,
      email,
      hashed_password,
      phone_number,
      user_type: userTypeString,
      isApproved: userTypeString === "patient",
      profile_image: profileImage ? profileImage.path : null,
    });
    await user.save();

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
        certificate: certificate ? certificate.path : null,
      });
      await healthCare.save();

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

      await sendEmail(
        process.env.ADMIN_EMAIL,
        "New Healthcare Provider Registration",
        `<p>Please approve ${name} (${email}) as a healthcare provider. Visit the admin dashboard to review.</p>`
      );
    }

    const token = createToken(user._id);
    res.status(201).json({
      token,
      user: { _id: user._id, name, email, user_type: user.user_type, isApproved: user.isApproved, profile_image: user.profile_image },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: error.message });
  }
};

export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await userModel.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.hashed_password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = createToken(user._id);

    res.status(200).json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        user_type: user.user_type,
        isApproved: user.isApproved,
        profile_image: user.profile_image,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error during login" });
  }
};

export const getCurrentUser = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        user_type: user.user_type,
        isApproved: user.isApproved,
        phone_number: user.phone_number,
        profile_image: user.profile_image,
        isBanned: user.isBanned,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    if (req.user.user_type !== "admin") {
      return res.status(403).json({ message: "Access denied. Admins only." });
    }

    const users = await userModel.find().select(
      "_id name email user_type profile_image isBanned createdAt"
    );

    const usersWithDetails = await Promise.all(
      users.map(async (user) => {
        if (user.user_type === "healthcare") {
          const healthcare = await HealthCare.findOne({ user_id: user._id });
          return {
            _id: user._id,
            name: user.name,
            email: user.email,
            user_type: user.user_type,
            profile_image: user.profile_image,
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
          profile_image: user.profile_image,
          isBanned: user.isBanned,
          healthcare_type: "N/A",
        };
      })
    );

    res.status(200).json({ users: usersWithDetails });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Server error while fetching users" });
  }
};

export const banUser = async (req, res) => {
  try {
    if (req.user.user_type !== "admin") {
      return res.status(403).json({ message: "Access denied. Admins only." });
    }

    const userId = req.params.userId;
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await userModel.findByIdAndUpdate(userId, { 
      isBanned: true,
      bannedAt: new Date() 
    });
    res.status(200).json({ message: "User banned successfully" });
  } catch (error) {
    console.error("Error banning user:", error);
    res.status(500).json({ message: "Server error while banning user" });
  }
};

export const unbanUser = async (req, res) => {
  try {
    if (req.user.user_type !== "admin") {
      return res.status(403).json({ message: "Access denied. Admins only." });
    }

    const userId = req.params.userId;
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await userModel.findByIdAndUpdate(userId, { 
      isBanned: false,
      bannedAt: null // Reset bannedAt timestamp
    });
    res.status(200).json({ message: "User unbanned successfully" });
  } catch (error) {
    console.error("Error unbanning user:", error);
    res.status(500).json({ message: "Server error while unbanning user" });
  }
};

export const deleteUser = async (req, res) => {
  try {
    if (req.user.user_type !== "admin") {
      return res.status(403).json({ message: "Access denied. Admins only." });
    }

    const userId = req.params.userId;
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

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
    console.error("Error deleting user:", error);
    res.status(500).json({ message: "Server error while deleting user" });
  }
};