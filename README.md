# TMMBA Progression

A lightweight React dashboard for tracking the TMMBA quarter schedule and assignment deadlines.

## Updating Quarter Data

Quarter-specific content now lives in data files instead of `src/App.jsx`.

- Edit `src/data/quarterData.json` to update the program label, page title, course catalog, keyword matching, and class schedule.
- Edit `src/data/calendarConfig.json` to update the Google Calendar ID, deadline query window, and embedded calendar URL.

## Calendar API Key

Set the browser API key in a local env file before running the app:

```bash
VITE_GOOGLE_CALENDAR_API_KEY=your_key_here
```

The app reads this from `import.meta.env.VITE_GOOGLE_CALENDAR_API_KEY`.
