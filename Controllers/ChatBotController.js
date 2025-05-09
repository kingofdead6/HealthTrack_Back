import mongoose from 'mongoose';
import Doctor from '../Models/doctorModel.js';
import Appointment from '../Models/appointmentModel.js';
import User from '../Models/userModel.js';
import genAI from '../utils/geminiClient.js';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

// Multer configuration for image uploads
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer disk storage configuration for handling file uploads
const storage = multer.diskStorage({
  // Define the destination folder for uploaded files
  destination: (req, file, cb) => {
    cb(null, uploadDir); // uploadDir should be defined elsewhere
  },
  // Define how the uploaded file should be named
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9); // Unique timestamp-based suffix
    cb(null, `${uniqueSuffix}-${file.originalname}`); // Prevents filename conflicts
  }
});

// File filter to accept only certain image types
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true); // Accept file
  } else {
    cb(new Error('Only JPEG, PNG, and GIF images are allowed'), false); // Reject file
  }
};

// Multer upload middleware configuration
const upload = multer({
  storage, 
  limits: { fileSize: 5 * 1024 * 1024 }, // Limit file size to 5MB
  fileFilter 
});

// Utility function to count the number of words in a text
const countWords = (text) => {
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
};

// Trim or adjust a text to fit a target word count, accounting for an optional appended message
const adjustResponseLength = (text, targetWordCount, appendMessage = '') => {
  const appendWordCount = countWords(appendMessage);
  const baseTarget = targetWordCount - appendWordCount;
  let words = text.trim().split(/\s+/).filter((word) => word.length > 0);

  if (words.length > baseTarget) {
    words = words.slice(0, baseTarget); // Trim to target
  }

  return appendMessage ? `${words.join(' ')}\n\n${appendMessage}` : words.join(' ');
};

// Check if a user message is likely a database query
const isDatabaseQuery = (message) => {
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('best doctor') || lowerMessage.includes('top doctor')) {
    return 'bestDoctor';
  }
  if (lowerMessage.includes('specialties') || lowerMessage.includes('specialities')) {
    return 'specialties';
  }
  return null;
};

// Check if a user message is a greeting
const isGreeting = (message) => {
  const greetings = [
    'hi',
    'hello',
    'hey',
    'greetings',
    'good morning',
    'good afternoon',
    'good evening',
  ];
  const lowerMessage = message.toLowerCase().trim();
  return greetings.some((greeting) => lowerMessage === greeting);
};

// Fetch the best-rated doctor from the database using aggregation
const getBestDoctor = async () => {
  try {
    const bestDoctor = await Appointment.aggregate([
      { $match: { rating: { $ne: null } } }, // Filter appointments with ratings
      {
        $group: {
          _id: '$user_id', // Group by user (doctor)
          avgRating: { $avg: '$rating' }, // Calculate average rating
          count: { $sum: 1 }, // Count number of ratings
        },
      },
      { $sort: { avgRating: -1, count: -1 } }, // Sort by rating and count
      { $limit: 1 }, // Get top doctor
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'healthcares',
          localField: '_id',
          foreignField: 'user_id',
          as: 'healthcare',
        },
      },
      { $unwind: { path: '$healthcare', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'doctors',
          localField: 'healthcare._id',
          foreignField: 'healthcare_id',
          as: 'doctor',
        },
      },
      { $unwind: { path: '$doctor', preserveNullAndEmptyArrays: true } },
    ]);

    // If no doctor is found
    if (!bestDoctor.length || !bestDoctor[0].user || !bestDoctor[0].doctor) {
      return 'No doctors with ratings found.';
    }

    const { user, doctor, avgRating } = bestDoctor[0];
    return `The best doctor is ${user.name}, a ${doctor.speciality}, with an average rating of ${avgRating.toFixed(1)}.`;
  } catch (error) {
    return 'Unable to fetch best doctor due to an error.';
  }
};

// Fetch all distinct specialties from the database
const getSpecialties = async () => {
  try {
    const specialties = await Doctor.distinct('speciality'); // Get unique specialties
    if (specialties.length === 0) {
      return 'No specialties found in the database.';
    }
    return `Available specialties: ${specialties.join(', ')}.`;
  } catch (error) {
    return 'Unable to fetch specialties due to an error.';
  }
};


// Controller to handle chat messages with image support
const handleChatMessage = async (req, res) => {
  const { message = '' } = req.body; // Extract text message from request
  const image = req.file; // Extract uploaded image (if any)

  // Reject empty requests (neither message nor image)
  if (!message && !image) {
    return res.status(400).json({ error: 'Message or image is required' });
  }

  try {
    // Check if the message matches a specific database query (e.g., "best doctor" or "specialties")
    const dbQueryType = isDatabaseQuery(message);
    if (dbQueryType) {
      let dbResponse;
      if (dbQueryType === 'bestDoctor') {
        dbResponse = await getBestDoctor(); // Fetch best-rated doctor
      } else if (dbQueryType === 'specialties') {
        dbResponse = await getSpecialties(); // Fetch list of specialties
      }

      const adjustedReply = adjustResponseLength(dbResponse, 100); // Limit reply length
      return res.json({ reply: adjustedReply });
    }

    // Initialize the Gemini generative model (text or vision depending on need)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    // Handle greetings (e.g., "hi", "hello") with friendly preset responses
    if (isGreeting(message) && !image) {
      const greetingPrompt = `Respond to the greeting "${message}" with a friendly message in up to 40 words, encouraging health-related questions or image uploads. Example: "Hello! How can I assist with health questions or analyze an image today?"`;

      let greetingResult;
      try {
        greetingResult = await model.generateContent(greetingPrompt);
      } catch (apiError) {
        throw new Error('Failed to generate greeting response with Gemini API');
      }
      const greetingText = await greetingResult.response.text();

      const adjustedReply = adjustResponseLength(greetingText, 50);
      return res.json({ reply: adjustedReply });
    }

    // Check if the message (and optional image) is health-related using Gemini
    let isHealthRelated = false;
    if (message || image) {
      const classificationPrompt = image
        ? `Determine if the following query, which includes an image, is health-related. Health-related queries involve physical or mental health, diseases, symptoms, treatments, nutrition, exercise, or medical advice. The text is: "${message}". Answer only with "Yes" or "No".`
        : `Determine if the following question is health-related. Health-related questions involve physical or mental health, diseases, symptoms, treatments, nutrition, exercise, or medical advice. Examples: "What are symptoms of diabetes?", "How to manage stress?". Answer only with "Yes" or "No": "${message}"`;

      let classificationResult;
      try {
        classificationResult = await model.generateContent(classificationPrompt);
      } catch (apiError) {
        throw new Error('Failed to classify message with Gemini API');
      }
      const classificationText = await classificationResult.response.text();
      isHealthRelated = classificationText.trim().toLowerCase() === 'yes';
    }

    // Configure the prompt and settings based on health-related status
    let responsePrompt;
    let targetWordCount;
    let appendMessage;

    if (isHealthRelated) {
      targetWordCount = 100;
      appendMessage = 'Please consult a doctor for a more precise diagnosis.';

      if (image) {
        // Read image file and encode in base64
        const imagePath = path.resolve(image.path);
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString('base64');

        // Prompt for image and message analysis
        responsePrompt = [
          {
            text: `Analyze the provided image and the following health-related question: "${message}". Provide a response in up to 90 words describing any relevant observations (e.g., symptoms visible in the image) and potential health implications.`
          },
          {
            inlineData: {
              mimeType: image.mimetype,
              data: base64Image
            }
          }
        ];

        // Delete the uploaded image file after processing
        fs.unlinkSync(imagePath);
      } else {
        // Prompt for text-only health-related message
        responsePrompt = `Answer the following health-related question in up to 90 words: "${message}"`;
      }
    } else {
      // Handle non-health-related input
      targetWordCount = 50;
      appendMessage = 'I am not designed to answer this question, please ask a health-related question or upload a relevant image.';

      if (image) {
        const imagePath = path.resolve(image.path);
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString('base64');

        responsePrompt = [
          {
            text: `The user uploaded an image with the message: "${message}". Since this does not appear to be health-related, respond in up to 40 words, asking for a health-related question or image.`
          },
          {
            inlineData: {
              mimeType: image.mimetype,
              data: base64Image
            }
          }
        ];

        fs.unlinkSync(imagePath); // Clean up file
      } else {
        responsePrompt = `Answer the following question in up to 40 words: "${message}"`;
      }
    }

    // Generate final response from Gemini
    let responseResult;
    try {
      responseResult = await model.generateContent(responsePrompt);
    } catch (apiError) {
      throw new Error('Failed to generate response with Gemini API');
    }
    const responseText = await responseResult.response.text();

    // Adjust response length and add final note if necessary
    const adjustedReply = adjustResponseLength(responseText, targetWordCount, appendMessage);

    // Send JSON reply to client
    res.json({ reply: adjustedReply });

  } catch (error) {
    // Ensure uploaded file is deleted in case of error
    if (image && fs.existsSync(image.path)) {
      fs.unlinkSync(image.path); 
    }
    res.status(500).json({ error: 'Failed to process request: ' + error.message });
  }
};

export default [upload.single('image'), handleChatMessage];