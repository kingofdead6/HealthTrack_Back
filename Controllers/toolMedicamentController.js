import ToolMedicament from "../Models/ToolMedicamentModel.js";
import HealthCare from "../Models/healthCareModel.js";
import User from "../Models/userModel.js";
import cloudinary from "../utils/cloudinary.js";
import { PassThrough } from "stream";

// Create a new tool or medicament post
export const createToolMedicament = async (req, res) => {
  const { name, price, description, category } = req.body;
  const picture = req.files?.picture;

  try {
    // Validate required fields
    if (!name) {
      return res.status(400).json({ message: "Name is required" });
    }
    if (!price || isNaN(price) || Number(price) < 0) {
      return res.status(400).json({ message: "Valid price is required" });
    }
    if (!picture) {
      return res.status(400).json({ message: "Picture is required" });
    }

    // Restrict to approved, non-banned healthcare users (pharmacy or laboratory)
    if (req.user.user_type !== "healthcare") {
      return res.status(403).json({ message: "Only healthcare users can create posts" });
    }
    const user = await User.findById(req.user._id);
    if (!user.isApproved) {
      return res.status(403).json({ message: "Your account must be approved to create posts" });
    }
    if (user.isBanned) {
      return res.status(403).json({ message: "Banned accounts cannot create posts" });
    }
    const healthcare = await HealthCare.findOne({ user_id: req.user._id });
    if (!healthcare || !["pharmacy", "laboratory"].includes(healthcare.healthcare_type)) {
      return res.status(403).json({ message: "Only pharmacies and laboratories can create posts" });
    }

    // Upload picture to Cloudinary
    const pictureUrl = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: "tools_medicaments",
          public_id: `${Date.now()}-${picture.name}`,
          resource_type: "image",
        },
        (error, result) => {
          if (error) return reject(new Error(`Cloudinary upload failed: ${error.message}`));
          resolve(result.secure_url);
        }
      );
      const bufferStream = new PassThrough();
      bufferStream.end(picture.data);
      bufferStream.pipe(uploadStream);
    });

    // Save new tool/medicament
    const toolMedicament = new ToolMedicament({
      user_id: req.user._id,
      healthcare_type: healthcare.healthcare_type,
      name,
      price: Number(price),
      description: description || "",
      category: category || "",
      picture: pictureUrl,
    });
    await toolMedicament.save();

    res.status(201).json({ message: "Tool/Medicament created", toolMedicament });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Get tools/medicaments created by the authenticated user
export const getMyToolsMedicaments = async (req, res) => {
  const user = req.user;

  try {
    // Restrict to healthcare users
    if (user.user_type !== "healthcare") {
      return res.status(403).json({ message: "Only healthcare users can view their posts" });
    }

    // Fetch user's tools/medicaments, sorted by creation date
    const toolsMedicaments = await ToolMedicament.find({ user_id: user._id }).sort({ createdAt: -1 });
    res.status(200).json({ toolsMedicaments });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Get all tools/medicaments with optional filters
export const getAllToolsMedicaments = async (req, res) => {
  const { name, minPrice, maxPrice, healthcareType, pharmacyName, category } = req.query;

  try {
    // Build query based on filters
    let query = {};
    if (name) {
      query.name = { $regex: name, $options: "i" };
    }
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }
    if (healthcareType) {
      query.healthcare_type = healthcareType;
    }
    if (pharmacyName) {
      const users = await User.find({ name: { $regex: pharmacyName, $options: "i" } }).lean();
      if (users.length === 0) {
        return res.status(200).json({ toolsMedicaments: [] });
      }
      query.user_id = { $in: users.map((u) => u._id) };
    }
    if (category) {
      query.category = { $regex: category, $options: "i" };
    }

    // Fetch tools/medicaments with user details
    const toolsMedicaments = await ToolMedicament.find(query)
      .populate({
        path: "user_id",
        select: "name profile_image",
        model: "User",
      })
      .sort({ createdAt: -1 })
      .lean();

    // Filter out invalid entries
    const validToolsMedicaments = toolsMedicaments.filter(
      (tool) => tool.user_id && tool.user_id._id && tool.user_id.name
    );

    if (validToolsMedicaments.length === 0) {
      return res.status(200).json({ toolsMedicaments: [] });
    }

    // Include healthcare details
    const toolsWithHealthcare = await Promise.all(
      validToolsMedicaments.map(async (tool) => {
        const healthcare = await HealthCare.findOne({ user_id: tool.user_id._id })
          .select(
            "healthcare_type name email phone_number location_link working_hours can_deliver speciality pharmacy_name lab_name averageRating comments"
          )
          .lean();
        return {
          ...tool,
          healthcare: healthcare || null,
        };
      })
    );

    res.status(200).json({ toolsMedicaments: toolsWithHealthcare });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Rate a tool/medicament
export const rateToolMedicament = async (req, res) => {
  const { toolMedicamentId, rating, comment } = req.body;
  const user = req.user;

  try {
    // Restrict to patients and validate rating
    if (user.user_type !== "patient") {
      return res.status(403).json({ message: "Only patients can rate" });
    }
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }

    // Find and update tool/medicament with rating
    const toolMedicament = await ToolMedicament.findById(toolMedicamentId);
    if (!toolMedicament) {
      return res.status(404).json({ message: "Tool/Medicament not found" });
    }
    toolMedicament.ratings.push({
      patient_id: user._id,
      rating: Number(rating),
      comment: comment || "",
    });
    await toolMedicament.save();

    res.status(200).json({ message: "Rating submitted", toolMedicament });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Delete a tool/medicament
export const deleteToolMedicament = async (req, res) => {
  const { toolMedicamentId } = req.params;
  const user = req.user;

  try {
    // Restrict to healthcare users and verify ownership
    if (user.user_type !== "healthcare") {
      return res.status(403).json({ message: "Only healthcare users can delete posts" });
    }
    const toolMedicament = await ToolMedicament.findById(toolMedicamentId);
    if (!toolMedicament) {
      return res.status(404).json({ message: "Tool/Medicament not found" });
    }
    if (toolMedicament.user_id.toString() !== user._id.toString()) {
      return res.status(403).json({ message: "You can only delete your own posts" });
    }

    // Delete the tool/medicament
    await toolMedicament.deleteOne();
    res.status(200).json({ message: "Tool/Medicament deleted" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Delete a review for a tool/medicament
export const deleteReview = async (req, res) => {
  const { toolMedicamentId, reviewId } = req.params;
  const user = req.user;

  try {
    // Restrict to patients and verify ownership
    if (user.user_type !== "patient") {
      return res.status(403).json({ message: "Only patients can delete their reviews" });
    }
    const toolMedicament = await ToolMedicament.findById(toolMedicamentId);
    if (!toolMedicament) {
      return res.status(404).json({ message: "Tool/Medicament not found" });
    }
    const review = toolMedicament.ratings.id(reviewId);
    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }
    if (review.patient_id.toString() !== user._id.toString()) {
      return res.status(403).json({ message: "You can only delete your own reviews" });
    }

    // Remove review and save
    toolMedicament.ratings.pull({ _id: reviewId });
    await toolMedicament.save();

    res.status(200).json({ message: "Review deleted", toolMedicament });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};