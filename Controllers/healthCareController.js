import HealthCare from "../Models/healthCareModel.js";
import Doctor from "../Models/doctorModel.js";
import Nurse from "../Models/nurseModel.js";
import Pharmacy from "../Models/pharmacyModel.js";
import Laboratory from "../Models/laboratoryModel.js";
import userModel from "../Models/userModel.js";
import Appointment from "../Models/appointmentModel.js";

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
        select: "name",
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

export const updateAppointmentStatus = async (req, res) => {
  const { appointmentId } = req.params;
  const { status } = req.body;

  try {
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }
    if (appointment.user_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized to update this appointment" });
    }

    const validStatuses = ["pending", "active", "completed"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    appointment.status = status;
    await appointment.save();
    console.log("Updated appointment status:", appointment);
    res.status(200).json({ message: "Appointment status updated", appointment });
  } catch (error) {
    console.error("Error updating appointment:", error.message, error.stack);
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};


export const getHealthcareProfile = async (req, res) => {
  const { healthcareId } = req.params;

  try {
    console.log("Searching HealthCare collection for user_id:", healthcareId);
    const healthcare = await HealthCare.findOne({ user_id: healthcareId });
    if (!healthcare) {
      console.log("No healthcare profile found for user_id:", healthcareId);
      return res.status(404).json({ message: "Healthcare profile not found" });
    }

    console.log("Fetching user details for _id:", healthcareId);
    const healthcareUser = await userModel.findById(healthcareId).select("name email phone_number user_type profile_image");
    if (!healthcareUser || healthcareUser.user_type !== "healthcare") {
      console.log("User details:", healthcareUser);
      return res.status(404).json({ message: "Healthcare provider not found" });
    }

    let typeSpecificData = {};
    switch (healthcare.healthcare_type) {
      case "doctor":
        console.log("Fetching Doctor data for healthcare_id:", healthcare._id);
        typeSpecificData = await Doctor.findOne({ healthcare_id: healthcare._id }).select("speciality clinic_name");
        break;
      case "nurse":
        console.log("Fetching Nurse data for healthcare_id:", healthcare._id);
        typeSpecificData = await Nurse.findOne({ healthcare_id: healthcare._id }).select("ward clinic_name");
        break;
      case "pharmacy":
        console.log("Fetching Pharmacy data for healthcare_id:", healthcare._id);
        typeSpecificData = await Pharmacy.findOne({ healthcare_id: healthcare._id }).select("pharmacy_name");
        break;
      case "laboratory":
        console.log("Fetching Laboratory data for healthcare_id:", healthcare._id);
        typeSpecificData = await Laboratory.findOne({ healthcare_id: healthcare._id }).select("lab_name equipment clinic_name");
        break;
      default:
        console.log("No specific type data for healthcare_type:", healthcare.healthcare_type);
        break;
    }

    console.log("Fetching appointments for user_id:", healthcareId);
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
      ...typeSpecificData?._doc,
      averageRating,
      comments,
    };

    console.log("Profile data:", profile);
    res.status(200).json(profile);
  } catch (error) {
    console.error("Error fetching healthcare profile:", error.message, error.stack);
    res.status(500).json({ message: `Server error: ${error.message}` });
  }
};