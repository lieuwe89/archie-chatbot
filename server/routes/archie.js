import express from 'express';
import fetch from 'node-fetch';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = express.Router();

// Memorix API keys (from the live website source)
const BEELDBANK_API_KEY = 'fd45b590-346a-11e5-a2cb-0800200c9a66';
const GENEALOGY_API_KEY = '6976bb7e-0c61-4f03-bf5b-df645d5fd086';

let genAI = null;
if (process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

router.post('/search', async (req, res) => {
    const { q } = req.body;
    if (!q) return res.status(400).json({ error: 'Search query "q" is required.' });

    try {
        const [genealogy, beeldbank, inventories] = await Promise.all([
            searchAlleGroningers(q),
            searchBeeldbank(q),
            searchInventories(q)
        ]);

        const results = { genealogy, beeldbank, inventories };
        let summary = null;
        if (genAI) {
            summary = await synthesizeResponse(q, results);
        } else {
            summary = "I found some records. See below.";
        }

        res.json({ query: q, summary, results });
    } catch (error) {
        console.error('Archie Search Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

async function synthesizeResponse(query, results) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = "You are Archie, the digital archivist for the Groninger Archieven. The user asked: " + query + ". Results: " + JSON.stringify(results) + ". Task: Summarize these results helpfully and concisely.";
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) {
        console.error('Gemini synthesis error:', e.message);
        return null;
    }
}

async function searchAlleGroningers(q) {
    try {
        const url = 'https://webservices.memorix.nl/genealogy/person?apiKey=' + GENEALOGY_API_KEY + '&q=' + encodeURIComponent(q) + '&rows=5';
        const response = await fetch(url);
        const data = await response.json();
        return (data.person || []).map(p => ({
            source: 'AlleGroningers',
            title: p.metadata.person_display_name || q,
            date: p.metadata.datum,
            handle: 'https://www.allegroningers.nl/zoeken-op-naam/persons/' + p.entity_uuid,
            description: [p.metadata.deed_type_title, p.metadata.register_gemeente].filter(Boolean).join(', ')
        }));
    } catch (e) { return []; }
}

async function searchBeeldbank(q) {
    try {
        const url = 'https://webservices.memorix.nl/mediabank/media?apiKey=' + BEELDBANK_API_KEY + '&q=' + encodeURIComponent(q) + '&rows=5';
        const response = await fetch(url);
        const data = await response.json();
        return (data.media || []).map(item => ({
            source: 'Beeldbank Groningen',
            title: item.title || 'Afbeelding',
            date: item.metadata?.date,
            handle: 'https://www.beeldbankgroningen.nl/beelden/detail/' + item.id,
            thumbnail: item.asset?.[0]?.thumb?.small,
            description: item.description
        }));
    } catch (e) { return []; }
}

async function searchInventories(q) {
    // Archives Portal Europe API returns HTML, not JSON — skip for now
    return [];
}

export default router;
