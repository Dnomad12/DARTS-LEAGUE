DARTS-LEAGUE — GitHub Pages client-side OCR scaffold

This repo now contains a minimal static web app (in /docs) that performs client-side OCR using Tesseract.js. It is intended as a free GitHub Pages-hosted MVP so you can upload screenshots and extract scores entirely in the browser.

Files added
- docs/index.html — main static UI (upload, OCR progress, parsed results, local leaderboard)
- docs/app.js — JavaScript that handles image preprocessing, Tesseract.js OCR, heuristic parsing, and localStorage-based matches/leaderboard
- docs/styles.css — basic styles

How to publish on GitHub Pages (project site)
1. In your repository, go to Settings → Pages.
2. Under "Source", select Branch: master and Folder: /docs.
3. Save. GitHub will publish the site at: https://<your-username>.github.io/DARTS-LEAGUE/

Usage
- Open the published Pages site or open docs/index.html locally.
- Upload or drag an image screenshot of a darts score.
- The site will run OCR locally in your browser (via Tesseract.js) and show raw text.
- Click "Parse Scores" to run a heuristic parser. Edit parsed values if necessary.
- Click "Save Match" to save the parsed match to localStorage. The leaderboard aggregates saved matches locally.

Notes & next steps
- This is a browser-only MVP. It keeps all data in localStorage (no server or user accounts yet).
- Parsing is heuristic — please upload 2–5 representative screenshots so I can refine parsing rules for your screenshot layout.
- If you later want server-side persistence, authentication, or improved parsing using Python/OpenCV/EasyOCR, we can add a backend and switch to Option B.

If you want me to tweak parsing for your screenshots now, upload 2–5 samples and I will update the parser and UI accordingly.
