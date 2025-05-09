import jwt from "jsonwebtoken";
import userModel from "../Models/userModel.js";

// Middleware to authenticate requests using JWT
const authMiddleware = async (req, res, next) => {
  // Extract token from Authorization header
  const token = req.header("Authorization")?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Access denied. No token provided." });
  }

  try {
    // Verify token and decode payload
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Fetch user from database, excluding password
    req.user = await userModel.findById(decoded._id).select("-hashed_password");
    if (!req.user) {
      return res.status(401).json({ message: "Invalid token" });
    }
    // Proceed to next middleware
    next();
  } catch (error) {
    res.status(400).json({ message: "Invalid token" });
  }
};

export default authMiddleware;