import axios from 'axios';

// Health-related keywords in English
const healthKeywordsEn = [
    'health', 'medicine', 'doctor', 'hospital', 'disease', 'symptom', 'treatment', 'pain',
    'illness', 'medication', 'therapy', 'surgery', 'diagnosis', 'patient', 'blood', 'heart',
    'lungs', 'brain', 'cancer', 'infection', 'fever', 'vaccine', 'virus', 'bacteria', 'allergy',
    'diabetes', 'stroke', 'injury', 'wound', 'antibiotics', 'pharmacy', 'nurse', 'emergency',
    'pregnancy', 'nutrition', 'diet', 'exercise', 'mental', 'stress', 'depression', 'anxiety',
    'sleep', 'immune', 'skin', 'liver', 'kidney', 'bone', 'muscle', 'joint', 'arthritis'
];

// Health-related keywords in French
const healthKeywordsFr = [
    'santé', 'médecine', 'médecin', 'hôpital', 'maladie', 'symptôme', 'traitement', 'douleur',
    'maladie', 'médicament', 'thérapie', 'chirurgie', 'diagnostic', 'patient', 'sang', 'cœur',
    'poumons', 'cerveau', 'cancer', 'infection', 'fièvre', 'vaccin', 'virus', 'bactérie',
    'allergie', 'diabète', 'accident vasculaire cérébral', 'blessure', 'plaie', 'antibiotiques',
    'pharmacie', 'infirmière', 'urgence', 'grossesse', 'nutrition', 'régime', 'exercice',
    'mental', 'stress', 'dépression', 'anxiété', 'sommeil', 'immunitaire', 'peau', 'foie',
    'rein', 'os', 'muscle', 'articulation', 'arthrite'
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
    
    if (hasFrench && !hasEnglish) return 'fr';
    return 'en';
}

// Chatbot handler
export const handleChatbotRequest = async (req, res) => {
    try {
        const prompt = req.body.prompt;
        const promptLower = prompt.toLowerCase();
        const language = detectLanguage(prompt);
        const instruction = language === 'fr'
            ? 'Répondez à la question ou au commentaire suivant : '
            : 'Answer the following question or respond to the statement: ';
        const fullInput = `${instruction}${prompt}`;

        const healthKeywords = language === 'fr' ? healthKeywordsFr : healthKeywordsEn;
        const greetingKeywords = language === 'fr' ? greetingKeywordsFr : greetingKeywordsEn;

        const isGreeting = greetingKeywords.some(keyword => promptLower.includes(keyword));
        const isHealthRelated = healthKeywords.some(keyword => promptLower.includes(keyword));

        const response = await axios.post(
            'https://api-inference.huggingface.co/models/mistralai/Mixtral-8x7B-Instruct-v0.1',
            {
                inputs: fullInput,
                parameters: {
                    max_length: isHealthRelated ? 100 : 30,
                    temperature: 1,
                    top_p: 0.5,
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

        let botResponse = response.data[0].generated_text.trim();
        if (botResponse.startsWith(fullInput)) {
            botResponse = botResponse.substring(fullInput.length).trim();
        }

        let finalResponse = botResponse;
        const healthDisclaimer = language === 'fr'
            ? " Veuillez consulter un professionnel de la santé pour une consultation plus précise et détaillée."
            : " Please consider a healthcare professional for better and more precise consultation.";

        if (isGreeting) {
            finalResponse = botResponse;
        } else if (isHealthRelated) {
            finalResponse = `${botResponse}${healthDisclaimer}`;
        } else {
            const offTopicDisclaimer = language === 'fr'
                ? " - Je ne suis pas conçu pour cela. Veuillez me poser une question sur la médecine ou la santé personnelle !"
                : " - I'm not designed for this. Please ask me about medicine or personal health!";
            finalResponse = `${botResponse}${offTopicDisclaimer}`;
        }

        res.status(200).send({
            bot: finalResponse
        });
    } catch (error) {
        console.error('Hugging Face Error:', error.response?.data || error.message);
        const status = error.response?.status || 500;
        const language = detectLanguage(req.body.prompt || '');
        const errorMessage = language === 'fr'
            ? 'Désolé, je n’ai pas assez d’informations'
            : 'Sorry, I don’t have enough information';
        res.status(status).send({ error: errorMessage });
    }
};

