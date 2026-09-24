# Life OS

A personal tool I built to track patterns across sleep, diet, mood, environment and activity. It's a personal project, not a commercial product, but it is deployed and I use it every day.

**What's interesting about it:**

- **Voice to structured data.** I speak a quick daily check-in in plain language, from the app or an iOS Shortcut. The Claude API turns it into a structured daily log and merges it with anything already recorded that day.
- **Several data sources in one view.** Fitbit data comes in through the Google Health API, and weather, air quality and pollen come from Open-Meteo and the Met Office. Scheduled jobs pull all of it in automatically, next to the manual entries.
- **Pattern finding.** A daily job checks tracked factors against each other, allowing for time delays (for example, whether something today affects sleep two nights later), and shows the strongest links.
- **Full-stack and live.** It has a React front end, serverless API routes, a hosted database and scheduled jobs, all deployed and running.

## How it's built

- **Frontend:** React + Vite, with separate layouts for desktop and mobile
- **Backend:** Vercel serverless functions and Vercel Cron for the scheduled syncs and analysis
- **Data:** Supabase (Postgres), with authentication and syncing across devices
- **AI:** Claude API. One shared prompt handles parsing for both the in-app and iOS Shortcut check-ins
- **Integrations:** Google Health API (OAuth), Open-Meteo, Met Office
