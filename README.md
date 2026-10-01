# Attentional Blink

An RSVP attentional blink experiment for students, built with Next.js and deployed on Vercel.

- RSVP at a 100 ms SOA (10 items per second, 20 items per stream): each digit is visible for 83 ms,
  followed by a 17 ms blank. Set `itemOnMs` equal to `soaMs` in `lib/experiment.ts` for a gapless stream.
  The targets are **6** and **9**.
- Trial mix: 50% two targets (one 6 and one 9, split evenly between lag 3 and lag 7), 25% one target, 25% no target.
- Answer options: No target / 6 / 9 / Both. There is no feedback during the experiment; responses are recorded
  and the next trial starts automatically (blank 700 ms, fixation cross 600 ms, then the stream).
- Results screen shows accuracy per condition. Students can download their data as a CSV file.
- Trials where the screen stuttered (a frame gap over 50 ms) are flagged in the CSV (`timing_ok = 0`).

Change the number of trials with a URL parameter: `https://your-app.vercel.app/?trials=20` (default: 40).
Change timing and lags in `lib/experiment.ts` (`SETTINGS`).

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Test on your iPhone (same Wi-Fi as your Mac)

```bash
npm run dev:phone
```

Find your Mac's IP address with `ipconfig getifaddr en0`, then open `http://<that-ip>:3000` in Safari on your iPhone.

## Deploy to Vercel

1. Push this folder to a new GitHub repository.
2. On vercel.com, click **Add New → Project**, import the repository and click **Deploy**.
3. From then on, every `git push` redeploys the site automatically.

You can also deploy without GitHub by running `npx vercel` (preview) or `npx vercel --prod` (production).
