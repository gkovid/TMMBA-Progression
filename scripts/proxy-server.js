#!/usr/bin/env node
const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const CALENDAR_ID = process.env.CALENDAR_ID || 'ccbonsd41ih8soareip63hogg4baojke@import.calendar.google.com';
const API_KEY = process.env.GOOGLE_CALENDAR_API_KEY || process.env.CALENDAR_API_KEY || '';

if (!API_KEY) {
    console.warn('Warning: no Google Calendar API key provided. Set GOOGLE_CALENDAR_API_KEY or CALENDAR_API_KEY.');
}

function buildUrl(query = {}) {
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`;
    const params = new URLSearchParams(Object.assign({ singleEvents: 'true', orderBy: 'startTime', maxResults: '50' }, query));
    if (API_KEY) params.set('key', API_KEY);
    return `${base}?${params.toString()}`;
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/events') {
        try {
            const timeMin = url.searchParams.get('timeMin') || new Date().toISOString();
            const q = { timeMin };
            const fetchUrl = buildUrl(q);
            const r = await fetch(fetchUrl);
            if (!r.ok) {
                res.writeHead(r.status, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: `Calendar API error ${r.status}` }));
                return;
            }
            const data = await r.json();
            const items = (data.items || []).filter(it => it.start?.dateTime || it.start?.date).map((item) => ({
                id: item.id,
                title: item.summary || 'Untitled assignment',
                start: item.start.dateTime || `${item.start.date}T11:59:00`,
                location: item.location || '',
                description: item.description || '',
                link: item.htmlLink || '',
            }));

            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ items }));
        } catch (err) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
        }

        return;
    }

    // simple health
    if (url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
    console.log(`Calendar proxy running on http://localhost:${PORT} — proxying calendar ${CALENDAR_ID}`);
});
