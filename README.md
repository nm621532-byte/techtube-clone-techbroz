# TechTube 🎬 — YouTube-style video app (PWA)

TechTube ek **original** YouTube-style clone hai: home feed, search, watch page, likes, comments, subscribe, watch later, history, Shorts (vertical swipe), apni video upload (phone se, offline chalegi), dark/light mode, aur Creator Studio (demo). Koi YouTube ka code ya logo nahi hai — sab naye code aur apne logo se bana hai.

Live: https://techtube-live.sites.tab.bot/

## Kya-kya hai (features)

- **Home feed**: video cards (thumbnail, title, channel, views, kitna purana), category chips (Coding, Music, Travel, Gaming, News, Sports, Uploads).
- **Search**: title, description, channel par search; filter (videos / your uploads / channels) aur sort (views / newest).
- **Watch page**: asli HTML5 `<video>` player, 👍 / 👎, Subscribe, Share, Watch later, Delete (sirf apni upload), comments (add/delete, har account ke comments per-user save), related videos.
- **Watch history** (Library mein), **Watch later** (Library mein).
- **Shorts**: full-screen vertical feed, swipe karo, tap karo unmute ke liye.
- **Upload**: phone se video chuno (MP4/WebM/MOV, 200 MB tak). Thumbnail apne-aap ban jaata hai. Video IndexedDB mein store hoti hai, to offline bhi chalti hai.
- **Dark / light mode**: Settings mein.
- **Creator Studio**: apne channel ke stats, monetization page (practice thresholds: 1K subscribers, 4K watch hours). Earnings **demo coins** hain, asli paisa nahi. Asli payout ke liye payment gateway aur KYC chahiye — ye build mein connected nahi hai.
- **Responsive**: phone par bottom nav, desktop par sidebar aur do-column watch page.
- **Installable PWA**: home screen par app ki tarah chalti hai, service worker se app shell aur sample videos offline.
- **Accounts**: local account (naam + password). Password PBKDF2-SHA256 (200k iterations) se hash hota hai, plain text kahin save nahi hota.

## Phone par install kaise karein (Android, Chrome)

1. Chrome mein TechTube ka link kholo (https://techtube-live.sites.tab.bot/).
2. Upar right ke ⋮ (three dots) menu par tap karo.
3. **"Install app"** (ya "Add to Home screen") par tap karo.
4. Home screen par TechTube ka icon aa jaayega — usse kholo, app ki tarah chalegi.

Settings → "Install TechTube" button bhi dikhega jab Chrome allow kare.

## Phone par chalana (zip se, bina internet ke bhi)

- Release se `techtube-v1.0.zip` download karo, unzip karo.
- Phone par koi bhi static host use karo (ya Chrome mein `https` wali jagah par upload). Local file open karne se service worker aur login kaam nahi karenge — `https://` ya `localhost` chahiye.
- Laptop par test: `cd techtube && python3 -m http.server 8080` phir `http://localhost:8080` kholo.

## Code structure

```
index.html          app shell (sirf structure)
styles.css          dark/light theme, responsive layout
app.js              router, accounts, feed, watch, shorts, upload, studio (vanilla JS)
sw.js               service worker: offline shell + sample media, range requests
manifest.webmanifest  PWA install info
icons/              logo (SVG) + PNG icons (normal + maskable)
media/videos/       6 chhote sample clips (8 sec each, ffmpeg se generate kiye)
media/thumbs/       unki thumbnails
tests/smoke.py      Playwright smoke test (20 checks)
```

Koi build step nahi hai. Koi framework nahi, koi npm dependency nahi.

## Data kahan save hota hai (privacy)

- Accounts, likes, comments, history, watch later, subscriptions: **is phone ke browser (localStorage) mein**, har account ke alag key ke saath.
- Uploads: **IndexedDB** mein, is phone par.
- Kuch bhi server par nahi jaata. Ye ek device-local app hai, isliye "account" ka matlab hai is phone par aap kaun ho.
- Settings → "Delete my data on this phone" se aapka account, history, comments aur aapki uploads hata di jaati hain.

## Tests

```bash
pip install playwright && python -m playwright install chromium
python3 tests/smoke.py http://127.0.0.1:8080/
```

Smoke test: signup, feed, category, search, watch, like/dislike, comment add/delete, watch later, subscribe, upload + blob playback, Shorts, theme persist, sign out, wrong password, desktop layout. Sab 20 checks pass hone chahiye.

## Limits / jo abhi nahi hai (honest list)

- Sample clips generated hain (test pattern + text), koi real CC footage nahi. Asli videos apni upload se daal sakte ho.
- Accounts device-local hain: ek phone par ek account ka data doosre phone par nahi aata. Koi cloud sync nahi.
- Comments aur uploads isi phone par dikhte hain (sab accounts ko, kyunki sab kuch local hai).
- Monetization sirf demo hai. Real payout nahi.
- APK nahi hai. Android par PWA install hi tareeka hai.
- Recommendation algorithm nahi — "related" sirf category aur date se sort hota hai.

## License

MIT — see LICENSE. Code original hai; koi YouTube asset use nahi hua.
