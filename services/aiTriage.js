const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function analyzeSymptoms(symptomsText) {
    const prompt = `You are a medical triage assistant for a rural clinic in Andhra Pradesh.
    Analyze these symptoms: "${symptomsText}".
    Respond ONLY with a valid JSON object containing exactly these keys:
    - "urgencyLevel": (Must be "Emergency", "Urgent", or "Routine")
    - "department": (e.g., "General Medicine", "Pediatrics", "Cardiology")
    - "departmentTelugu": (The accurate Telugu translation of the department name)
    - "summary": (A 1-sentence clinical summary for the doctor)`;
    
    const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
        }
    });

    return JSON.parse(response.text);
}

module.exports = { analyzeSymptoms };