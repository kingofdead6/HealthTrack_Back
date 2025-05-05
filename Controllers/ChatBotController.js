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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, and GIF images are allowed'), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter
});

const countWords = (text) => {
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
};

const adjustResponseLength = (text, targetWordCount, appendMessage = '') => {
  const appendWordCount = countWords(appendMessage);
  const baseTarget = targetWordCount - appendWordCount;
  let words = text.trim().split(/\s+/).filter((word) => word.length > 0);

  if (words.length > baseTarget) {
    words = words.slice(0, baseTarget);
  }

  return appendMessage ? `${words.join(' ')}\n\n${appendMessage}` : words.join(' ');
};

// Detect database queries
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

// Detect greetings
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

// Get best doctor
const getBestDoctor = async () => {
  try {
    const bestDoctor = await Appointment.aggregate([
      { $match: { rating: { $ne: null } } },
      {
        $group: {
          _id: '$user_id',
          avgRating: { $avg: '$rating' },
          count: { $sum: 1 },
        },
      },
      { $sort: { avgRating: -1, count: -1 } },
      { $limit: 1 },
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

    if (!bestDoctor.length || !bestDoctor[0].user || !bestDoctor[0].doctor) {
      return 'No doctors with ratings found.';
    }

    const { user, doctor, avgRating } = bestDoctor[0];
    return `The best doctor is ${user.name}, a ${doctor.speciality}, with an average rating of ${avgRating.toFixed(1)}.`;
  } catch (error) {
    return 'Unable to fetch best doctor due to an error.';
  }
};

// Get specialties
const getSpecialties = async () => {
  try {
    const specialties = await Doctor.distinct('speciality');
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
  const { message = '' } = req.body;
  const image = req.file;

  if (!message && !image) {
    return res.status(400).json({ error: 'Message or image is required' });
  }

  try {
    // Check for database-related queries (text-only)
    const dbQueryType = isDatabaseQuery(message);
    if (dbQueryType) {
      let dbResponse;
      if (dbQueryType === 'bestDoctor') {
        dbResponse = await getBestDoctor();
      } else if (dbQueryType === 'specialties') {
        dbResponse = await getSpecialties();
      }

      const adjustedReply = adjustResponseLength(dbResponse, 100);
      return res.json({ reply: adjustedReply });
    }

    // Initialize Gemini model
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }); // Adjust to vision model if needed

    // Handle greetings (text-only)
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

    // Determine if the input is health-related
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

    // Prepare response
    let responsePrompt;
    let targetWordCount;
    let appendMessage;

    if (isHealthRelated) {
      targetWordCount = 100;
      appendMessage = 'Please consult a doctor for a more precise diagnosis.';
      if (image) {
        // Read image file
        const imagePath = path.resolve(image.path);
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString('base64');

        // Prepare prompt for vision model
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

        // Clean up uploaded file
        fs.unlinkSync(imagePath);
      } else {
        responsePrompt = `Answer the following health-related question in up to 90 words: "${message}"`;
      }
    } else {
      targetWordCount = 50;
      appendMessage = 'I am not designed to answer this question, please ask a health-related question or upload a relevant image.';
      if (image) {
        // Read image file
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

        // Clean up uploaded file
        fs.unlinkSync(imagePath);
      } else {
        responsePrompt = `Answer the following question in up to 40 words: "${message}"`;
      }
    }

    let responseResult;
    try {
      responseResult = await model.generateContent(responsePrompt);
    } catch (apiError) {
      throw new Error('Failed to generate response with Gemini API');
    }
    const responseText = await responseResult.response.text();

    const adjustedReply = adjustResponseLength(responseText, targetWordCount, appendMessage);

    res.json({ reply: adjustedReply });
  } catch (error) {
    if (image && fs.existsSync(image.path)) {
      fs.unlinkSync(image.path); 
    }
    res.status(500).json({ error: 'Failed to process request: ' + error.message });
  }
};

export default [upload.single('image'), handleChatMessage];