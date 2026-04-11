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

/**
 * ARCHIE SEARCH: Parallel Search across multiple archive silos
 */
router.post('/search', async (req, res) => {
    const { q, history = [] } = req.body;

    if (!q) {
        return res.status(400).json({ error: 'Search query "q" is required.' });
    }

    try {
        // 1. Run all searches in parallel
        const [genealogy, beeldbank, inventories] = await Promise.all([
            searchAlleGroningers(q),
            searchBeeldbank(q),
            searchInventories(q)
        ]);

        const results = { genealogy, beeldbank, inventories };

        // 2. Synthesize a conversational response using Gemini if available
        let summary = null;
        if (genAI) {
            summary = await synthesizeResponse(q, results, history);
        } else {
            summary = `I've found some interesting records related to "${q}" in the archives. Take a look at the results below! (Set GEMINI_API_KEY for a more detailed analysis)`;
        }

        res.json({
            query: q,
            summary,
            results
        });
    } catch (error) {
        console.error('Archie Search Error:', error);
        res.status(500).json({ error: 'Internal Server Error while searching archives.' });
    }
});

/**
 * Use Gemini to explain WHY these results are relevant to the user's query
 */
async function synthesizeResponse(query, results, history) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = `
You are Archie, the digital archivist for the Groninger Archieven.
The user asked: "${query}"

Here are the search results from our databases:
${JSON.stringify(results, null, 2)}

Your task:
1. Briefly summarize what was found across the three silos (AlleGroningers, Beeldbank, Archive Inventories).
2. Highlight the most relevant items and explain WHY they are interesting based on the user's query.
3. If you find a person in AlleGroningers that matches a name in the query, point them out.
4. Keep the tone helpful, professional, and enthusiastic about history.
5. Use Dutch if the user query was in Dutch, otherwise English.
6. Be concise.

Response:`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (e) {
        console.error('Synthesis Error:', e);
        return `I found several records for "${query}". You can browse them by category below.`;
    }
}

/**
 * Search AlleGroningers via Open Archieven REST API
 */
async function searchAlleGroningers(q) {
    try {
        const url = `https://api.openarch.nl/v1/search.json?name=${encodeURIComponent(q)}&set=gra&number_of_results=5`;
        const response = await fetch(url);
        const data = await response.json();
        console.log("Inventory Raw:", JSON.stringify(data).slice(0, 500));
        console.log("Beeldbank Raw:", JSON.stringify(data).slice(0, 500));
        console.log("AlleGroningers Raw:", JSON.stringify(data).slice(0, 500));
        
        return (data.results || []).map(record => ({
            source: 'AlleGroningers',
            title: record.title || `${record.name} - ${record.event_type}`,
            date: record.event_date,
            handle: record.identifier, 
            description: record.description,
            meta: {
                event_type: record.event_type,
                place: record.event_place
            }
        }));
    } catch (e) {
        console.error('AlleGroningers Error:', e);
        return [];
    }
}

/**
 * Search Beeldbank Groningen via Memorix Mediabank API
 */
async function searchBeeldbank(q) {
    try {
        const url = `https://webservices.memorix.nl/mediabank/v1/search?q=${encodeURIComponent(q)}&rows=5`;
        const response = await fetch(url, {
            headers: {
                'x-api-key': BEELDBANK_API_KEY,
                'Accept': 'application/json'
            }
        });
        const data = await response.json();
        console.log("Inventory Raw:", JSON.stringify(data).slice(0, 500));
        console.log("Beeldbank Raw:", JSON.stringify(data).slice(0, 500));
        console.log("AlleGroningers Raw:", JSON.stringify(data).slice(0, 500));

        return (data.results || []).map(item => ({
            source: 'Beeldbank Groningen',
            title: item.title || 'Untitled Image',
            date: item.date,
            handle: `https://www.beeldbankgroningen.nl/beelden/detail/${item.identifier}`,
            thumbnail: item.thumbnail_url,
            description: item.description
        }));
    } catch (e) {
        console.error('Beeldbank Error:', e);
        return [];
    }
}

/**
 * Search Archive Inventories via Archives Portal Europe (APE)
 */
async function searchInventories(q) {
    try {
        const url = `https://www.archivesportaleurope.net/api/v1/search/fa?q=${encodeURIComponent(q)}&repositoryCode=NL-GrA&count=5`;
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' }
        });
        const data = await response.json();
        console.log("Inventory Raw:", JSON.stringify(data).slice(0, 500));
        console.log("Beeldbank Raw:", JSON.stringify(data).slice(0, 500));
        console.log("AlleGroningers Raw:", JSON.stringify(data).slice(0, 500));

        return (data.results || []).map(item => ({
            source: 'Groninger Archieven',
            title: item.title,
            date: item.date,
            handle: item.url, 
            description: item.scopecontent || item.abstract
        }));
    } catch (e) {
        console.error('Inventory Error:', e);
        return [];
    }
}

export default router;
