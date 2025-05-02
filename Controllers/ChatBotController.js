import mongoose from "mongoose";
import Doctor from "../Models/doctorModel.js"; 
import Appointment from "../Models/appointmentModel.js"; 
import User from "../Models/userModel.js"; 
import genAI from "../utils/geminiClient.js"; 

// Function to count words in a string
const countWords = (text) => {
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
};

// Function to adjust response to target word count (truncate only, no padding)
const adjustResponseLength = (text, targetWordCount, appendMessage = "") => {
  const appendWordCount = countWords(appendMessage);
  const baseTarget = targetWordCount - appendWordCount;
  let words = text.trim().split(/\s+/).filter((word) => word.length > 0);

  if (words.length > baseTarget) {
    words = words.slice(0, baseTarget);
  }

  return appendMessage ? `${words.join(" ")}\n\n${appendMessage}` : words.join(" ");
};

// Function to detect database-related queries
const isDatabaseQuery = (message) => {
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes("best doctor") || lowerMessage.includes("top doctor")) {
    return "bestDoctor";
  }
  if (lowerMessage.includes("specialties") || lowerMessage.includes("specialities")) {
    return "specialties";
  }
  return null;
};

// Function to detect greetings
const isGreeting = (message) => {
  const greetings = [
    "hi",
    "hello",
    "hey",
    "greetings",
    "good morning",
    "good afternoon",
    "good evening",
  ];
  const lowerMessage = message.toLowerCase().trim();
  return greetings.some((greeting) => lowerMessage === greeting);
};

// Function to get the best doctor based on ratings
const getBestDoctor = async () => {
  try {
    const bestDoctor = await Appointment.aggregate([
      { $match: { rating: { $ne: null } } },
      {
        $group: {
          _id: "$user_id",
          avgRating: { $avg: "$rating" },
          count: { $sum: 1 },
        },
      },
      { $sort: { avgRating: -1, count: -1 } },
      { $limit: 1 },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "healthcares",
          localField: "_id",
          foreignField: "user_id",
          as: "healthcare",
        },
      },
      { $unwind: { path: "$healthcare", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "doctors",
          localField: "healthcare._id",
          foreignField: "healthcare_id",
          as: "doctor",
        },
      },
      { $unwind: { path: "$doctor", preserveNullAndEmptyArrays: true } },
    ]);

    if (!bestDoctor.length || !bestDoctor[0].user || !bestDoctor[0].doctor) {
      return "No doctors with ratings found.";
    }

    const { user, doctor, avgRating } = bestDoctor[0];
    return `The best doctor is ${user.name}, a ${doctor.speciality}, with an average rating of ${avgRating.toFixed(1)}.`;
  } catch (error) {
    return "Unable to fetch best doctor due to an error.";
  }
};

// Function to get available specialties
const getSpecialties = async () => {
  try {
    const specialties = await Doctor.distinct("speciality");
    if (specialties.length === 0) {
      return "No specialties found in the database.";
    }
    return `Available specialties: ${specialties.join(", ")}.`;
  } catch (error) {
    return "Unable to fetch specialties due to an error.";
  }
};

// Controller to handle chat messages
const handleChatMessage = async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    // Check for database-related queries
    const dbQueryType = isDatabaseQuery(message);
    if (dbQueryType) {
      let dbResponse;
      if (dbQueryType === "bestDoctor") {
        dbResponse = await getBestDoctor();
      } else if (dbQueryType === "specialties") {
        dbResponse = await getSpecialties();
      }

      const adjustedReply = adjustResponseLength(dbResponse, 100);
      return res.json({ reply: adjustedReply });
    }

    // Initialize Gemini model
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Check for greetings
    if (isGreeting(message)) {
      const greetingPrompt = `Respond to the greeting "${message}" with a friendly message in up to 40 words, encouraging health-related questions. Example: "Hello! How can I assist you with health-related questions today?"`;

      let greetingResult;
      try {
        greetingResult = await model.generateContent(greetingPrompt);
      } catch (apiError) {
        throw new Error("Failed to generate greeting response with Gemini API");
      }
      const greetingText = await greetingResult.response.text();

      const adjustedReply = adjustResponseLength(greetingText, 50);
      return res.json({ reply: adjustedReply });
    }

    // Step 1: Determine if the question is health-related
    const classificationPrompt = `Determine if the following question is health-related. Health-related questions involve physical or mental health, diseases, symptoms, treatments, nutrition, exercise, or medical advice. Examples: "What are symptoms of diabetes?", "How to manage stress?", "Is aspirin safe daily?". Non-health-related examples: "What is the capital of France?", "How to fix a car?". Answer only with "Yes" or "No": "${message}"`;

    let classificationResult;
    try {
      classificationResult = await model.generateContent(classificationPrompt);
    } catch (apiError) {
      throw new Error("Failed to classify message with Gemini API");
    }
    const classificationText = await classificationResult.response.text();
    const isHealthRelated = classificationText.trim().toLowerCase() === "yes";


    // Step 2: Generate the appropriate response
    let responsePrompt;
    let targetWordCount;
    let appendMessage;

    if (isHealthRelated) {
      targetWordCount = 100;
      appendMessage = "Please consult a doctor for a more precise answer.";
      responsePrompt = `Answer the following health-related question in up to 90 words: "${message}"`;
    } else {
      targetWordCount = 50;
      appendMessage = "I am not designed to answer this question, please ask a health-related question.";
      responsePrompt = `Answer the following question in up to 40 words: "${message}"`;
    }

    let responseResult;
    try {
      responseResult = await model.generateContent(responsePrompt);
    } catch (apiError) {
      throw new Error("Failed to generate response with Gemini API");
    }
    const responseText = await responseResult.response.text();


    const adjustedReply = adjustResponseLength(responseText, targetWordCount, appendMessage);

    res.json({ reply: adjustedReply });
  } catch (error) {
    res.status(500).json({ error: "Failed to process request: " + error.message });
  }
};

export { handleChatMessage };