import jwt from "jsonwebtoken";
import userModel from "../Models/userModel.js";

// Middleware to authenticate and authorize admin users
const adminMiddleware = async (req, res, next) => {
  // Extract token from Authorization header
  const token = req.header("Authorization")?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Access denied. No token provided." });
  }

  try {
    // Verify token and decode payload
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Fetch user from database, excluding password
    const user = await userModel.findById(decoded._id).select("-hashed_password");
    if (!user) {
      return res.status(401).json({ message: "Invalid token" });
    }
    // Check if user is an admin
    if (user.user_type !== "admin") {
      return res.status(403).json({ message: "Access denied. Admins only." });
    }
    req.user = user;
    // Proceed to next middleware
    next();
  } catch (error) {
    res.status(400).json({ message: "Invalid token" });
  }
};

export default adminMiddleware;