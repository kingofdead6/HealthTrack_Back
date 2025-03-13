// Controllers/healthCareController.js
import HealthCare from "../Models/healthCareModel.js";
import Doctor from "../Models/doctorModel.js";
import Nurse from "../Models/nurseModel.js";
import Pharmacy from "../Models/pharmacyModel.js";
import Laboratory from "../Models/laboratoryModel.js";
import userModel from "../Models/userModel.js";

export const getPendingHealthCare = async (req, res) => {
  try {
    const pendingUsers = await userModel
      .find({ user_type: "healthcare", isApproved: false })
      .select("name email phone_number createdAt");

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

// Approve healthcare user (unchanged)
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

    let details = { ...healthcare._doc }; // Spread healthcare base data

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