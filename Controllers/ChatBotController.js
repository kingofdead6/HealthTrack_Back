import axios from 'axios';
import jwt from 'jsonwebtoken';
import HealthData from '../Models/healthCareModel.js';
import Doctor from '../Models/doctorModel.js';
import User from '../Models/userModel.js';
import Appointment from '../Models/appointmentModel.js';

// Health-related keywords in English
const healthKeywordsEn = [
    'health', 'medicine', 'doctor', 'hospital', 'disease', 'symptom', 'treatment', 'pain',
    'illness', 'medication', 'therapy', 'surgery', 'diagnosis', 'patient', 'blood', 'heart',
    'lungs', 'brain', 'cancer', 'infection', 'fever', 'vaccine', 'virus', 'bacteria', 'allergy',
    'diabetes', 'stroke', 'injury', 'wound', 'antibiotics', 'pharmacy', 'nurse', 'emergency',
    'pregnancy', 'nutrition', 'diet', 'exercise', 'mental', 'stress', 'depression', 'anxiety',
    'sleep', 'immune', 'skin', 'liver', 'kidney', 'bone', 'muscle', 'joint', 'arthritis',
    'cardiologist', 'best doctor', 'best rated doctor', 'top doctor', 'rating', 'appointment',
    'speciality', 'specialties', 'multiple specialities', 'specialists', 'headache', 'eye pain',
    'nausea', 'nauseous'
];

// Health-related keywords in French
const healthKeywordsFr = [
    'santé', 'médecine', 'médecin', 'hôpital', 'maladie', 'symptôme', 'traitement', 'douleur',
    'maladie', 'médicament', 'thérapie', 'chirurgie', 'diagnostic', 'patient', 'sang', 'cœur',
    'poumons', 'cerveau', 'cancer', 'infection', 'fièvre', 'vaccin', 'virus', 'bactérie',
    'allergie', 'diabète', 'accident vasculaire cérébral', 'blessure', 'plaie', 'antibiotiques',
    'pharmacie', 'infirmière', 'urgence', 'grossesse', 'nutrition', 'régime', 'exercice',
    'mental', 'stress', 'dépression', 'anxiété', 'sommeil', 'immunitaire', 'peau', 'foie',
    'rein', 'os', 'muscle', 'articulation', 'arthrite', 'cardiologue', 'meilleur médecin',
    'meilleur docteur', 'top médecin', 'note', 'évaluation', 'rendez-vous', 'spécialité',
    'spécialités', 'multiples spécialités', 'spécialistes', 'mal de tête', 'douleur oculaire',
    'nausée', 'nausées'
];

// Greeting keywords in English
const greetingKeywordsEn = [
    'hello', 'hi', 'hey', 'greetings', 'good morning', 'good afternoon', 'good evening',
    'howdy', 'yo', 'what’s up', 'salutations'
];

// Greeting keywords in French
const greetingKeywordsFr = [
    'bonjour', 'salut', 'coucou', 'bonsoir', 'allô', 'bienvenue', 'hé', 'quoi de neuf',
    'salutations', 'bonne journée', 'bonne soirée'
];

// Language detection function
function detectLanguage(prompt) {
    const promptLower = prompt.toLowerCase();
    const hasFrench = healthKeywordsFr.some(keyword => promptLower.includes(keyword)) ||
                     greetingKeywordsFr.some(keyword => promptLower.includes(keyword));
    const hasEnglish = healthKeywordsEn.some(keyword => promptLower.includes(keyword)) ||
                      greetingKeywordsEn.some(keyword => promptLower.includes(keyword));
    return hasFrench && !hasEnglish ? 'fr' : 'en';
}

// Fetch doctor information from database
async function fetchDoctors(prompt, language, userId) {
    const promptLower = prompt.toLowerCase();
    console.log('fetchDoctors called with prompt:', prompt);
    try {
        if (promptLower.includes('best doctor') || promptLower.includes('meilleur médecin') ||
            promptLower.includes('best rated doctor') || promptLower.includes('top doctor')) {
            console.log('Fetching best doctor...');
            const doctors = await Appointment.aggregate([
                { $match: { rating: { $ne: null, $gte: 0, $lte: 5 } } },
                {
                    $group: {
                        _id: '$user_id',
                        averageRating: { $avg: '$rating' },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { averageRating: -1, count: -1 } },
                { $limit: 1 },
                {
                    $lookup: {
                        from: 'doctors',
                        localField: '_id',
                        foreignField: 'user_id',
                        as: 'doctor'
                    }
                },
                { $unwind: { path: '$doctor', preserveNullAndEmptyArrays: true } },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user'
                    }
                },
                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } }
            ]);

            console.log('Aggregation result:', JSON.stringify(doctors, null, 2));
            if (doctors.length === 0 || !doctors[0].user) {
                console.log('No doctors with ratings found');
                return language === 'fr'
                    ? 'Aucun médecin avec des évaluations trouvé.'
                    : 'No doctors with ratings found.';
            }

            const doctor = doctors[0];
            const specialities = doctor.doctor?.specialities?.length
                ? doctor.doctor.specialities.join(', ')
                : doctor.doctor?.speciality || 'General Practice';
            console.log('Best doctor found:', doctor.user.name);
            return language === 'fr'
                ? `**Dr. ${doctor.user.name}**  
- Spécialité : ${specialities}  
- Note moyenne : ${doctor.averageRating.toFixed(1)}/5 (${doctor.count} évaluations)`
                : `**Dr. ${doctor.user.name}**  
- Specialty: ${specialities}  
- Average rating: ${doctor.averageRating.toFixed(1)}/5 (${doctor.count} reviews)`;
        } else if (promptLower.includes('cardiologist') || promptLower.includes('cardiologue') ||
                   promptLower.includes('headache') || promptLower.includes('mal de tête') ||
                   promptLower.includes('nausea') || promptLower.includes('nausée')) {
            const specialty = promptLower.includes('cardiologist') || promptLower.includes('cardiologue')
                ? 'Cardiologist'
                : 'Neurologist';
            console.log(`Fetching ${specialty}...`);
            const doctors = await Doctor.find({ specialities: specialty })
                .populate({
                    path: 'healthcare_id',
                    populate: { path: 'user_id', select: 'name' }
                })
                .limit(1);

            if (doctors.length === 0) {
                console.log(`No ${specialty} found`);
                return language === 'fr'
                    ? `Aucun ${specialty === 'Cardiologist' ? 'cardiologue' : 'neurologue'} trouvé.`
                    : `No ${specialty.toLowerCase()} found.`;
            }

            const doctor = doctors[0];
            const user = doctor.healthcare_id?.user_id;
            if (!user) {
                console.log('No user linked to doctor');
                return language === 'fr'
                    ? 'Erreur : Médecin non trouvé.'
                    : 'Error: Doctor not found.';
            }

            const ratings = await Appointment.aggregate([
                { $match: { user_id: doctor.user_id, rating: { $ne: null, $gte: 0, $lte: 5 } } },
                {
                    $group: {
                        _id: null,
                        averageRating: { $avg: '$rating' },
                        count: { $sum: 1 }
                    }
                }
            ]);

            const rating = ratings[0] ? ratings[0].averageRating.toFixed(1) : 'N/A';
            const count = ratings[0] ? ratings[0].count : 0;
            return language === 'fr'
                ? `**Dr. ${user.name}**  
- Spécialité : ${specialty}  
- Note moyenne : ${rating}/5 (${count} évaluations)`
                : `**Dr. ${user.name}**  
- Specialty: ${specialty}  
- Average rating: ${rating}/5 (${count} reviews)`;
        }
        return '';
    } catch (error) {
        console.error('Error fetching doctors:', error.message);
        return language === 'fr' ? 'Erreur lors de la récupération des médecins.' : 'Error fetching doctors.';
    }
}

// Fetch health data from database
async function fetchRelevantHealthData(prompt, language) {
    const keywords = language === 'fr' ? healthKeywordsFr : healthKeywordsEn;
    const promptLower = prompt.toLowerCase();
    const relevantKeywords = keywords.filter(keyword => promptLower.includes(keyword));

    if (relevantKeywords.length === 0) {
        return language === 'fr'
            ? 'Aucune information spécifique disponible.'
            : 'No specific information available.';
    }

    try {
        const healthDocs = await HealthData.find({
            $or: [
                { content: { $regex: relevantKeywords.join('|'), $options: 'i' } },
                { title: { $regex: relevantKeywords.join('|'), $options: 'i' } },
                { category: { $regex: relevantKeywords.join('|'), $options: 'i' } }
            ]
        }).limit(2);

        if (healthDocs.length === 0) {
            console.log('No health data found for keywords:', relevantKeywords);
            return language === 'fr'
                ? 'Aucune information spécifique disponible.'
                : 'No specific information available.';
        }

        return healthDocs
            .map(doc => `- **${doc.title || 'Information'}**: ${doc.content?.substring(0, 200) || 'N/A'}...`)
            .join('\n');
    } catch (error) {
        console.error('Error fetching health data:', error.message);
        return language === 'fr'
            ? 'Erreur lors de la récupération des informations.'
            : 'Error fetching information.';
    }
}

// Fetch user information for personalization
async function fetchUserInfo(userId, language) {
    try {
        const user = await User.findById(userId).select('name');
        if (!user) {
            console.log('No user found for userId:', userId);
            return { name: language === 'fr' ? 'Monsieur' : 'Mister', healthHistory: '' };
        }

        const appointments = await Appointment.find({ patient_id: userId })
            .populate('user_id', 'name')
            .limit(2);
        const healthHistory = appointments.length
            ? appointments.map(app => `Consultation avec ${app.user_id?.name || 'un médecin'} le ${new Date(app.date).toLocaleDateString()}`).join('; ')
            : language === 'fr' ? 'Aucun rendez-vous récent.' : 'No recent appointments.';

        return { name: user.name, healthHistory };
    } catch (error) {
        console.error('Error fetching user info:', error.message);
        return { name: language === 'fr' ? 'Monsieur' : 'Mister', healthHistory: '' };
    }
}

// Default health advice for common symptoms
const defaultHealthAdvice = {
    headache: {
        en: [
            'Rest in a quiet, dark room.',
            'Stay hydrated by drinking water.',
            'Take an over-the-counter pain reliever if needed.',
            'Consult a neurologist if symptoms persist.'
        ],
        fr: [
            'Reposez-vous dans une pièce calme et sombre.',
            'Restez hydraté en buvant de l’eau.',
            'Prenez un antidouleur en vente libre si nécessaire.',
            'Consultez un neurologue si les symptômes persistent.'
        ]
    },
    nausea: {
        en: [
            'Sip clear fluids like water or ginger ale.',
            'Eat small, bland meals like crackers.',
            'Avoid strong smells or heavy foods.',
            'Seek medical attention if nausea persists.'
        ],
        fr: [
            'Buvez des liquides clairs comme de l’eau ou du ginger ale.',
            'Mangez de petits repas fades comme des craquelins.',
            'Évitez les odeurs fortes ou les aliments lourds.',
            'Consultez un médecin si les nausées persistent.'
        ]
    }
};

// Chatbot handler
export const handleChatbotRequest = async (req, res) => {
    try {
        const { prompt, chatHistory = [] } = req.body;
        if (!prompt) {
            console.log('Prompt missing in request');
            return res.status(400).send({ error: 'Prompt is required' });
        }

        const promptLower = prompt.toLowerCase();
        const language = detectLanguage(prompt);
        const instruction = language === 'fr'
            ? 'Répondez de manière concise, claire et organisée avec des puces ou des paragraphes courts. Fournissez uniquement la réponse sans répéter la question ou les informations de l’utilisateur : '
            : 'Respond concisely, clearly, and in an organized manner with bullets or short paragraphs. Provide only the answer without repeating the question or user information: ';

        const healthKeywords = language === 'fr' ? healthKeywordsFr : healthKeywordsEn;
        const greetingKeywords = language === 'fr' ? greetingKeywordsFr : greetingKeywordsEn;

        const isGreeting = greetingKeywords.some(keyword => promptLower.includes(keyword));
        const isHealthRelated = healthKeywords.some(keyword => promptLower.includes(keyword));
        const doctorQuery = promptLower.includes('best doctor') || promptLower.includes('meilleur médecin') ||
                           promptLower.includes('best rated doctor') || promptLower.includes('top doctor') ||
                           promptLower.includes('cardiologist') || promptLower.includes('cardiologue');

        // Extract user ID from JWT token
        let userId = null;
        let userInfo = { name: language === 'fr' ? 'Monsieur' : 'Mister', healthHistory: '' };
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                userId = decoded.id;
                userInfo = await fetchUserInfo(userId, language);
            } catch (error) {
                console.log('Invalid JWT token:', error.message);
            }
        }

        let healthContext = '';
        let finalResponse = '';
        const recentHistory = chatHistory.slice(-3).map(msg => 
            `${msg.isAi ? 'Assistant' : userInfo.name}: ${msg.text}`
        ).join('\n');

        // Handle doctor queries
        if (doctorQuery) {
            console.log('Processing doctor query');
            healthContext = await fetchDoctors(prompt, language, userId);
            finalResponse = language === 'fr'
                ? `${userInfo.name}, voici le médecin recommandé :\n${healthContext}`
                : `${userInfo.name}, here’s the recommended doctor:\n${healthContext}`;
        } else if (isHealthRelated) {
            console.log('Processing health-related query');
            healthContext = await fetchRelevantHealthData(prompt, language);

            // Default advice for specific symptoms
            let defaultAdvice = '';
            if (promptLower.includes('headache') || promptLower.includes('mal de tête')) {
                defaultAdvice = defaultHealthAdvice.headache[language === 'fr' ? 'fr' : 'en'].map(item => `- ${item}`).join('\n');
            }
            if (promptLower.includes('nausea') || promptLower.includes('nausée')) {
                const nauseaAdvice = defaultHealthAdvice.nausea[language === 'fr' ? 'fr' : 'en'].map(item => `- ${item}`).join('\n');
                defaultAdvice = defaultAdvice ? `${defaultAdvice}\n${nauseaAdvice}` : nauseaAdvice;
            }

            // Fetch specialist for health queries
            let specialistInfo = '';
            if (promptLower.includes('headache') || promptLower.includes('mal de tête') ||
                promptLower.includes('nausea') || promptLower.includes('nausée')) {
                specialistInfo = await fetchDoctors(prompt, language, userId);
            }

            // Prepare API input without user info or question
            const contextInstruction = language === 'fr'
                ? `Contexte :\n${healthContext}\n\nHistorique :\n${recentHistory}\n\nFournissez une réponse directe : ${prompt}`
                : `Context:\n${healthContext}\n\nHistory:\n${recentHistory}\n\nProvide a direct answer: ${prompt}`;

            const fullInput = `${instruction}${contextInstruction}`;
            console.log('Sending to Hugging Face API:', fullInput);

            // Call Hugging Face API
            const response = await axios.post(
                'https://api-inference.huggingface.co/models/mistralai/Mixtral-8x7B-Instruct-v0.1',
                {
                    inputs: fullInput,
                    parameters: {
                        max_length: 200,
                        temperature: 0.7,
                        top_p: 0.9,
                        num_return_sequences: 1
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.HF_API_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            let botResponse = response.data[0]?.generated_text?.trim() || '';
            if (!botResponse || botResponse.length < 10) {
                console.log('Hugging Face API returned empty or short response');
                botResponse = defaultAdvice || (language === 'fr'
                    ? '- Essayez de reformuler votre question pour plus de détails.'
                    : '- Try rephrasing your question for more details.');
            }

            if (botResponse.startsWith(fullInput)) {
                botResponse = botResponse.substring(fullInput.length).trim();
            }

            // Remove any echo of the prompt
            if (botResponse.toLowerCase().includes(promptLower.substring(0, 20))) {
                botResponse = botResponse.substring(prompt.length).trim();
            }

            // Format response
            botResponse = botResponse.split('\n')
                                    .map(line => line.trim())
                                    .filter(line => line && !line.toLowerCase().includes('question') && !line.toLowerCase().includes('utilisateur') && !line.toLowerCase().includes('user'))
                                    .map(line => `- ${line}`)
                                    .join('\n');

            const healthDisclaimer = language === 'fr'
                ? '\n**Note** : Consultez un médecin pour un diagnostic précis.'
                : '\n**Note**: Consult a doctor for an accurate diagnosis.';

            finalResponse = language === 'fr'
                ? `${userInfo.name}, voici des conseils :\n${botResponse || defaultAdvice}\n${specialistInfo ? `\nRecommandation :\n${specialistInfo}` : ''}${healthDisclaimer}`
                : `${userInfo.name}, here’s some advice:\n${botResponse || defaultAdvice}\n${specialistInfo ? `\nRecommendation:\n${specialistInfo}` : ''}${healthDisclaimer}`;
        } else if (isGreeting) {
            console.log('Processing greeting');
            finalResponse = language === 'fr'
                ? `Bonjour, ${userInfo.name} ! Comment puis-je vous aider avec votre santé aujourd'hui ?`
                : `Hello, ${userInfo.name}! How can I assist you with your health today?`;
        } else {
            console.log('Processing non-health query');
            finalResponse = language === 'fr'
                ? `${userInfo.name}, je suis spécialisé en santé. Posez une question sur la santé ou les médecins !`
                : `${userInfo.name}, I specialize in health. Ask a health or doctor-related question!`;
        }

        console.log('Final response:', finalResponse);
        res.status(200).send({ bot: finalResponse });
    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
        const status = error.response?.status || 500;
        const language = detectLanguage(req.body.prompt || '');
        const errorMessage = language === 'fr'
            ? 'Une erreur s’est produite. Vérifiez votre connexion ou réessayez.'
            : 'An error occurred. Check your connection or try again.';
        res.status(status).send({ error: errorMessage });
    }
};