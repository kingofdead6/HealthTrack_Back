import HealthCare from "../Models/healthCareModel.js";
import Doctor from "../Models/doctorModel.js";
import Nurse from "../Models/nurseModel.js";
import Pharmacy from "../Models/pharmacyModel.js";
import Laboratory from "../Models/laboratoryModel.js";
import userModel from "../Models/userModel.js";
import Appointment from "../Models/appointmentModel.js";
import Announcement from "../Models/announcementModel.js";
import jwt from "jsonwebtoken";
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
        const doctor = await Doctor.findOne({ healthcare_id: healthcare._id });
        details = { ...details, ...doctor._doc };
        break;
      case "nurse":
        const nurse = await Nurse.findOne({ healthcare_id: healthcare._id });
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
      .select("name email phone_number profile_image");

    if (approvedUsers.length === 0) {
      console.log("No approved healthcare providers found in users collection");
    } else {
      console.log("Fetched approved healthcare providers:", approvedUsers);
    }

    const healthcareDetails = await Promise.all(
      approvedUsers.map(async (user) => {
        const healthcare = await HealthCare.findOne({ user_id: user._id });
        if (!healthcare) {
          console.log("No HealthCare record for user:", user._id);
          return null;
        }

        let typeSpecificData = {};
        switch (healthcare.healthcare_type) {
          case "doctor":
            typeSpecificData = await Doctor.findOne({ healthcare_id: healthcare._id }).select("speciality clinic_name");
            break;
          case "nurse":
            typeSpecificData = await Nurse.findOne({ healthcare_id: healthcare._id }).select("ward clinic_name");
            break;
          case "pharmacy":
            typeSpecificData = await Pharmacy.findOne({ healthcare_id: healthcare._id }).select("pharmacy_name");
            break;
          case "laboratory":
            typeSpecificData = await Laboratory.findOne({ healthcare_id: healthcare._id }).select("lab_name equipment clinic_name");
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
          working_hours: healthcare.working_hours,
          can_deliver: healthcare.can_deliver,
          ...typeSpecificData?._doc,
        };
      })
    );

    const filteredDetails = healthcareDetails.filter((detail) => detail !== null);
    console.log("Returning healthcare details:", filteredDetails);
    res.status(200).json(filteredDetails);
  } catch (error) {
    console.error("Error fetching approved healthcare providers:", error);
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
      .sort({ date: -1 });

    console.log("Fetched appointments for healthcare:", req.user._id, appointments);
    res.status(200).json(appointments);
  } catch (error) {
    console.error("Error fetching healthcare appointments:", error.message, error.stack);
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};

export const updateAppointmentStatus = [checkApproval, async (req, res) => {
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
    await appointment.save();

    if (status === "rejected") {
      const patientEmail = appointment.patient_id.email;
      const healthcareName = appointment.user_id.name;
      const subject = "Appointment Rejected";
      const html = `
        <p>Dear ${appointment.patient_id.name},</p>
        <p>Your appointment scheduled for <strong>${new Date(appointment.date).toLocaleDateString()} at ${appointment.time}</strong> with <strong>${healthcareName}</strong> has been rejected.</p>
        <p>Reason: Unspecified (contact the provider for details).</p>
        <p>Please schedule a new appointment if needed.</p>
        <p>Best regards,<br>Your Healthcare Team</p>
      `;
      await sendEmail(patientEmail, subject, html);
      console.log(`Rejection email sent to ${patientEmail}`);
    }

    console.log("Updated appointment status:", appointment);
    res.status(200).json({ message: "Appointment status updated", appointment });
  } catch (error) {
    console.error("Error updating appointment:", error.message, error.stack);
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
}];

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
        typeSpecificData = await Doctor.findOne({ healthcare_id: healthcare._id }).select("speciality clinic_name");
        break;
      case "nurse":
        typeSpecificData = await Nurse.findOne({ healthcare_id: healthcare._id }).select("ward clinic_name");
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

export const updateHealthcareProfile = [checkApproval, async (req, res) => {
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
  } = req.body;
  const profile_image = req.files?.profile_image?.[0]?.path;

  try {
    const user = await userModel.findById(userId);
    if (!user || user.user_type !== "healthcare") {
      return res.status(404).json({ message: "User not found or not healthcare" });
    }

    user.phone_number = phone_number || user.phone_number;
    if (profile_image) user.profile_image = profile_image;
    await user.save();

    const healthcare = await HealthCare.findOne({ user_id: userId });
    if (!healthcare) {
      return res.status(404).json({ message: "Healthcare record not found" });
    }

    healthcare.location_link = location_link || healthcare.location_link;
    healthcare.working_hours = working_hours || healthcare.working_hours;
    healthcare.can_deliver = can_deliver === "true" || can_deliver === true;
    await healthcare.save();

    let typeSpecificModel;
    switch (healthcare.healthcare_type) {
      case "doctor":
        typeSpecificModel = await Doctor.findOne({ healthcare_id: healthcare._id });
        if (typeSpecificModel) {
          typeSpecificModel.speciality = speciality || typeSpecificModel.speciality;
          typeSpecificModel.clinic_name = clinic_name || typeSpecificModel.clinic_name;
          await typeSpecificModel.save();
        }
        break;
      case "nurse":
        typeSpecificModel = await Nurse.findOne({ healthcare_id: healthcare._id });
        if (typeSpecificModel) {
          typeSpecificModel.ward = ward || typeSpecificModel.ward;
          typeSpecificModel.clinic_name = clinic_name || typeSpecificModel.clinic_name;
          await typeSpecificModel.save();
        }
        break;
      case "pharmacy":
        typeSpecificModel = await Pharmacy.findOne({ healthcare_id: healthcare._id });
        if (typeSpecificModel) {
          typeSpecificModel.pharmacy_name = pharmacy_name || typeSpecificModel.pharmacy_name;
          await typeSpecificModel.save();
        }
        break;
      case "laboratory":
        typeSpecificModel = await Laboratory.findOne({ healthcare_id: healthcare._id });
        if (typeSpecificModel) {
          typeSpecificModel.lab_name = lab_name || typeSpecificModel.lab_name;
          typeSpecificModel.equipment = equipment || typeSpecificModel.equipment;
          typeSpecificModel.clinic_name = clinic_name || typeSpecificModel.clinic_name;
          await typeSpecificModel.save();
        }
        break;
    }

    const updatedProfile = await getHealthCareDetails(req, { ...res, status: () => ({ json: (data) => data }) }); // Mock res for reuse
    res.status(200).json({ ...updatedProfile, user: { phone_number: user.phone_number, profile_image: user.profile_image } });
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).json({ message: "Server error" });
  }
}];

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

export const createAnnouncement = [checkApproval, async (req, res) => {
  const { title, content } = req.body;

  try {
    const user = await userModel.findById(req.user._id);
    if (!user || user.user_type !== "healthcare") {
      return res.status(403).json({ message: "Unauthorized: Only healthcare providers can create announcements" });
    }
    const healthcare = await userModel.findById(user_id);
        if (!healthcare || healthcare.user_type !== "healthcare" || !healthcare.isApproved || healthcare.isBanned) {
          return res.status(404).json({ message: "Healthcare provider not found, not approved, or banned" });
        }
    const announcement = new Announcement({
      title,
      content,
      healthcare_id: req.user._id,
    });

    await announcement.save();
    res.status(201).json({ message: "Announcement created successfully", announcement });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
}];

export const getAllAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.find()
      .populate("healthcare_id", "name profile_image") 
      .sort({ createdAt: -1 }); 

    console.log("Fetched all announcements:", announcements);
    res.status(200).json(announcements);
  } catch (error) {
    console.error("Error fetching announcements:", error.message);
    res.status(500).json({ message: "Server error" });
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