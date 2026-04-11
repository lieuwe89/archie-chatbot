import express from 'express';
import fetch from 'node-fetch';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = express.Router();

// Public API Key for Beeldbank Groningen (Memorix Mediabank)
const BEELDBANK_API_KEY = 'ec94b228-142b-11e5-9b13-53eabf91064e';

// Initialize Gemini if API key is present
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
            summary = "I've searched the archives. Here is what I found:";
        }

        res.json({ query: q, summary, results });
    } catch (error) {
        console.error('Archie Search Error:', error);
        res.status(500).json({ error: 'Internal Server Error while searching archives.' });
    }
});

async function synthesizeResponse(query, results) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = \`You are Archie, the digital archivist for the Groninger Archieven.
The user asked: "\${query}"
Results: \${JSON.stringify(results)}
Task: Summarize these results helpfully in the user's language. Be concise.\`;
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) {
        return "I found some records. See below.";
    }
}

async function searchAlleGroningers(q) {
    try {
        const url = \`https://api.openarch.nl/v1/search.json?name=\${encodeURIComponent(q)}&set=gra&number_of_results=5\`;
        const response = await fetch(url);
        const data = await response.json();
        console.log("DEBUG RAW DATA:", JSON.stringify(data));
        return (data.results || []).map(r => ({
            source: 'AlleGroningers',
            title: r.event_type + ': ' + (r.person_name || q),
            date: r.event_date,
            handle: r.identifier,
            description: r.description
        }));
    } catch (e) { return []; }
}

async function searchBeeldbank(q) {
    try {
        const url = \`https://webservices.memorix.nl/mediabank/v1/search?q=\${encodeURIComponent(q)}&rows=5\`;
        const response = await fetch(url, { headers: { 'x-api-key': BEELDBANK_API_KEY } });
        const data = await response.json();
        console.log("DEBUG RAW DATA:", JSON.stringify(data));
        // The path depends on the exact JSON structure of Memorix
        return (data.results || []).map(item => ({
            source: 'Beeldbank Groningen',
            title: item.title || 'Afbeelding',
            date: item.date,
            handle: \`https://www.beeldbankgroningen.nl/beelden/detail/\${item.identifier}\`,
            thumbnail: item.thumbnail_url
        }));
    } catch (e) { return []; }
}

async function searchInventories(q) {
    try {
        // Archives Portal Europe usually needs an API key for search, but let's try a fallback if it fails
        const url = \`https://www.archivesportaleurope.net/api/v1/search/fa?q=\${encodeURIComponent(q)}&repositoryCode=NL-GrA&count=5\`;
        const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!response.ok) return [];
        const data = await response.json();
        console.log("DEBUG RAW DATA:", JSON.stringify(data));
        return (data.results || []).map(item => ({
            source: 'Groninger Archieven',
            title: item.title,
            handle: item.url,
            description: item.scopecontent
        }));
    } catch (e) { return []; }
}

export default router;
