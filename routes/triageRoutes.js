const express = require('express');
const { analyzeSymptoms } = require('../services/aiTriage');

const router = express.Router();

router.post('/triage', async (req, res) => {
    try {
        const { symptomText } = req.body;
        if (!symptomText) {
            return res.status(400).json({ error: "Symptom text is required" });
        }

        const triageResult = await analyzeSymptoms(symptomText);

        res.status(200).json({
            success: true,
            triageData: triageResult 
        });
    } catch (error) {
        console.error("AI Triage Error:", error);
        res.status(500).json({ error: "Failed to analyze symptoms." });
    }
});

module.exports = router;