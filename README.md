# Finance Tracker (iOS, local-first)

Screenshot a payment slip → it's detected automatically → Gemini Flash extracts amount / merchant / category / date as strict JSON → it waits in your **Inbox** for a 1-tap confirm → saved to local SQLite. The Dashboard shows this month's spend, a category breakdown and recent transactions.

The **Assistant** tab reviews your spending with Gemini (monthly review, tips, and a chat grounded in your own transactions), and **budgets** raise alerts when a category or your total is nearly used up (80%) or exceeded.

There is no manual photo picking. Receipts come in three ways:

1. **Screenshot watcher** (in the app) – when the app opens, it looks for screenshots added to Photos since you turned it on and imports them. Non-receipt screenshots are ignored by the AI check.
2. **Share-sheet Shortcut** (iOS Shortcuts, no native code) – share any image from Photos/Safari/banking apps straight to your backend; see below.
3. **Clipboard** – copy a slip, tap *Paste* in the Inbox.

```
backend/   FastAPI + SQLAlchemy (SQLite locally, Postgres when DATABASE_URL is set) + Gemini (google-genai)
frontend/  Expo SDK 57, Expo Router, TypeScript
```

## 1. Backend

Requires Python 3.11+ (macOS system `python3` is 3.9 — use Homebrew's).

```bash
cd backend
/opt/homebrew/bin/python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env          # then put your key in GEMINI_API_KEY (https://aistudio.google.com/apikey)
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Check it: <http://localhost:8000/api/health> · interactive docs: <http://localhost:8000/docs>

Data lives in `backend/finance.db` (git-ignored). **Receipt images are never stored**: they're read by Gemini in memory and discarded; only the extracted text fields (amount, merchant, category, date) are saved.

Upgrading from an older version that kept images in `backend/uploads/`? Run `python purge_legacy_images.py` (dry run) and then `python purge_legacy_images.py --yes` to delete the old files and the unused `image_path` column.

## 2. Frontend

```bash
cd frontend
npm install --legacy-peer-deps
cp .env.example .env          # set EXPO_PUBLIC_API_URL (see below)
npx expo start --ios          # opens the iOS Simulator
```

`EXPO_PUBLIC_API_URL`:
- iOS Simulator: `http://localhost:8000`
- Physical iPhone (Expo Go, same Wi-Fi): your Mac's LAN IP, e.g. `http://192.168.1.20:8000` (`ipconfig getifaddr en0`). Restart `expo start` after changing `.env`.

The Simulator has no camera — use "Choose from library" there (drag an image onto the Simulator to add it to Photos).

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/transactions/import` | multipart `file` → OCR in memory → stores only the extracted fields as a **pending** transaction for 1-tap confirmation. Image type is sniffed from the bytes; the same image twice (matched by a one-way hash, not stored pixels) returns the existing row; `422 not_a_receipt` if it isn't a receipt. Used by the app and the Shortcut |
| GET | `/api/transactions/pending` | items waiting for confirmation |
| POST | `/api/transactions/{id}/confirm` | confirm a pending item; optional JSON body with edits (`amount`, `merchant_name`, `category`, `transaction_date`). The response includes `impact`: how this slip moved the month's budget |
| DELETE | `/api/transactions/{id}` | delete a transaction (pending or saved) |
| GET / PUT | `/api/settings` | display currency `{"currency": "EUR"}` (default THB; also USD, EUR, GBP, JPY, CNY, KRW, INR, SGD, AUD, CAD, CHF, MMK). Changes symbols/formatting everywhere, including the text of advice and alerts. **Amounts are not converted between currencies** |
| GET | `/api/budgets` | all budget limits with spent / percent / status for the current month |
| PUT | `/api/budgets/{category}` | set a monthly limit (`{"monthly_limit": 150}`); `category` is `Total` or a spending category |
| DELETE | `/api/budgets/{category}` | remove a limit |
| GET | `/api/assistant/advice?ai=&refresh=` | monthly review `{headline, tips[], source: ai\|rules, ai_error}`. Cached per exact spending snapshot; `ai=false` never calls Gemini (cached AI advice or built-in rule-based tips); `refresh=true` forces a new review |
| POST | `/api/assistant/chat` | `{message, history[]}` → `{reply}`. Gemini gets the live financial context and can query your transactions with tools (see below) |
| POST | `/api/transactions/upload` | multipart `file` → OCR → returns `{amount, merchant_name, category, transaction_date}` and saves nothing |
| POST | `/api/transactions` | create a confirmed transaction directly (manual entry); response also includes `impact` |
| GET | `/api/transactions?limit=&offset=&month=YYYY-MM` | confirmed transactions, newest first; `month` limits to one month |
| PATCH | `/api/transactions/{id}` | correct a saved slip (any of `amount`, `merchant_name`, `category`, `transaction_date`); returns the budget `impact` |
| GET | `/api/transactions/search?q=&category=&limit=` | smart search → `{results[], interpretation[]}`; understands categories (incl. aliases and Burmese), amounts (`over 200`, `>500`, `<=100`, `1.5k`, exact `85`), dates (`today`, `last week`, `this month`, `august`, `2026-09`) and merchant text |
| GET | `/api/summary?month=YYYY-MM` | month total, income, per-category totals/percent, per-category and total budget progress, and `alerts[]` (defaults to current month) |
| GET | `/api/health` | liveness |

Categories: Food, Groceries, Transport, Shopping, Entertainment, Bills, Health, Income, Other. "Income" is excluded from "spent" totals.

## Share-sheet Shortcut (optional, works from any app)

Needs the backend reachable from the phone (same Wi-Fi, `EXPO_PUBLIC_API_URL`-style LAN address).

1. Shortcuts app → **+** → name it *Add to Finance*.
2. Tap the **ⓘ** (details) → enable **Show in Share Sheet** → Share Sheet Types: **Images**.
3. Add action **Get Contents of URL**
   - URL: `http://<your-mac-ip>:8000/api/transactions/import`
   - Method: **POST**, Request Body: **Form**, add field → type **File**, key `file`, value **Shortcut Input**
   - (if you set `API_TOKEN`) Headers: `X-API-Token: <token>`
4. Add **Show Notification** ("Added to your Inbox").

Now Share → *Add to Finance* from Photos, a banking app, Safari, etc. The receipt lands in the app's Inbox.

## Design

A tactile, "VisionOS-meets-neumorphism" UI built with `react-native-reanimated` (spring physics, layout animations), `react-native-gesture-handler` (touch tracking), `expo-blur` (frosted glass) and `react-native-svg` (radial lighting, progress rings). Everything runs on the UI thread and respects iOS **Reduce Motion**.

- **3D tilt cards** (`components/fx/TiltCard.tsx`): the summary card, budget progress cards and pending slips tilt toward your finger in real perspective, cast layered shadows that shift with the tilt, catch a moving highlight, and float their content at different depths (`ParallaxLayer`). The gesture only *observes* touches, so scrolling is never blocked.
- **Neumorphic category badges** (`components/fx/NeuBadge.tsx`): round floating badges with a raised face, light and dark outer shadows, a concave tinted dish and an embossed icon (fork/knife for Food, controller for Games, car for Transport, bag for Shopping, bolt for Utilities...). Resolved in one place: `theme/categories.ts`.
- **Glass and light:** frosted `GlassView` tiles on the hero card and toast, SVG radial glows (`RadialGlow`) and an ambient lit backdrop (`AmbientBackground`), a blurred tab bar.
- **Spring everything:** buttons squash and bounce (`SpringPressable`), bottom sheets spring up and can be dragged away (`SpringSheet`), list rows spring in, out and into new positions, budget rings spring to new values.
- **Smart search + filters:** category chips filter the slips feed; the search box understands things like `food over 200 last month`, `uber >500 august`, `games under 1.5k this week`, `85`, and Burmese words/digits. The backend parses it (`backend/search.py`, `GET /api/transactions/search?q=&category=`) and the app shows how it was interpreted.
- Dark and light themes follow the system setting. Tokens live in `theme/colors.ts` and `theme/fx.ts`.

## Not built yet

- **Recurring expenses** (e.g. rent, subscriptions generated automatically).
- **Per-transaction multi-currency / exchange rates** (the currency setting is display-only).

## AI assistant & budgets

- Built-in insights (budget status, pace vs. budget, week-over-week jumps, last-month comparison, savings rate) are computed from your SQLite data in `backend/insights.py` and always work, even offline.
- Gemini then writes the personalised review from those verified numbers; if it's unavailable (no key, quota, network) the app silently falls back to the built-in tips and says so.
- Set limits from **Dashboard → Edit monthly budgets**. Alerts appear on the Dashboard and in the Assistant.
- Chat history is kept on the phone (last 30 messages, "Clear" to reset); nothing about your chats is stored on the backend.

### Burmese (မြန်မာ) conversations

Chat with the assistant in Burmese and it answers in Burmese. Nothing else about your data changes: amounts, budgets and history stay in standard formats in SQLite and are read exactly as before.

- **Detection** (`backend/language.py`): the backend looks at the message's Unicode script, so the reply language isn't left to chance. Mixed Burmese + English ("Starbucks မှာ ဘယ်လောက်သုံးခဲ့လဲ") counts as Burmese, and a short follow-up like "5000?" or "👍" keeps the conversation's language. English (or any other language) is mirrored as before.
- **Prompt rules:** understand Myanmar Unicode *and* Zawgyi (reply is always Unicode), polite spoken register (…ပါတယ်) without gendered particles, Western digits for all figures so numbers match the app, Burmese digits and quantity words understood (၂ သောင်း ၅ ထောင် = 25,000; သိန်း, သန်း), time words (ဒီလ, ပြီးခဲ့တဲ့အပတ်, မနေ့က) turned into exact dates, and a glossary of preferred financial terms.
- **Tools stay English:** dates and category names sent to the database tools are canonical English; Burmese category names are accepted as aliases as a safety net.
- **Display:** the app uses a taller line height for Burmese text so stacked vowel/tone marks aren't clipped.
- **Not localised yet:** the app's own labels and the Assistant tab's monthly review (headline and tips) are still English; only the chat replies follow your language.

### How the assistant "remembers" your money

You never retell your purchases. On every advice/chat request the backend rebuilds the assistant's picture from SQLite (`backend/memory.py`), so a slip saved a second ago is already known:

- **Injected context:** this month and last month, 6 months of history, 6 rolling weeks, top merchants (90 days), budgets, **affordability** numbers (budget left overall and per category, days left, safe daily spend) and your 30 latest slips.
- **Query tools:** for anything more specific Gemini calls `get_spending(start, end, category, merchant)` and `list_transactions(...)`, which run real SQL. That's how "food this month compared to last week" or "how much at Starbucks in August" get exact answers (one call per period). Category aliases like *games* and *utilities* are understood.
- **Immediate update:** saving a slip returns an `impact` (shown as a toast in the app, e.g. "Games: ฿1,299 of ฿1,500 (87%). Getting close to your limit."), the Dashboard re-reads the summary/alerts, and the next advice request is regenerated because the data changed.

## Gemini reliability

Google's free tier is generous but unpredictable: models are sometimes overloaded (`503`) and each model has a small **daily** allowance (about 20 requests per model per day on the free tier; one chat message can use several because each lookup is a round trip). The backend copes with this in `ai_service.py`:

- **Retries:** an overloaded model is retried once after a short pause; a per-minute rate limit waits (capped at 10 s) and retries.
- **Fallback models:** if a model keeps failing, is out of daily quota, or isn't offered to your key (404), the next one is tried. Order: `GEMINI_MODEL` (default `gemini-flash-latest`), then `GEMINI_FALLBACK_MODELS` (default `gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.1-flash-lite`). Both go in `backend/.env`; model names change over time, unknown ones are skipped automatically.
- **Memory of failures:** an exhausted model is skipped until its quota resets (the time Google reports), a briefly failing one for 30 s, so later requests don't waste time or quota on it.
- **Fails fast when retrying can't help:** a bad key (`400/401/403`) or no internet raises immediately instead of cycling through models. The total wait is capped at about 45 s.
- **Clear errors:** e.g. "Gemini is busy right now. Please try again in a minute." or "Gemini's free daily limit is used up on every model I can try; it resets in about 5h 40m."
- **Plain text, consistent numbers:** replies are stripped of markdown (`**bold**`, bullets, headings) and Burmese digits are converted to 0-9 so every number matches the app. The Burmese rules are only sent for Burmese chats; English chats get an explicit "answer in English only".
- If a lookup tool ever fails, the assistant is told to say so instead of guessing a number.

For heavier use, enable billing on your Google AI Studio project to lift the free-tier limits.

## Fixing mistakes and browsing months

- **Tap any slip** in *Recent slips* to open the editor: change the amount, merchant, date or category, or delete the slip (with a confirmation). The totals, budgets and alerts update straight away.
- **Arrows on the month pill** of the hero card move to earlier months (and back, never past the current one). The summary, budgets, categories, slips list and insights all follow the month; search stays inside the month you're viewing unless your query names its own dates (e.g. `cafe august`).

## Free hosting: Render + Neon ($0, no credit card)

Render's free web service has a temporary disk, so a SQLite file there would be erased on every restart. The fix that costs nothing: keep the **app server on Render (free)** and the **data in Neon's free Postgres**. The backend uses Postgres automatically when `DATABASE_URL` is set; with no `DATABASE_URL` it keeps using the local SQLite file (`backend/finance.db`), so nothing changes for local development.

**1. Database (Neon)**
1. Sign up at neon.tech (free plan) and create a project.
2. Copy the **connection string** (the "pooled" one is fine). It looks like `postgresql://user:password@ep-xxxx-pooler.<region>.aws.neon.tech/neondb?sslmode=require`.
3. Nothing else to do: the tables are created on first start.

**2. Server (Render)**
1. Put the project in a **private** GitHub repository (free). `.env`, `finance.db` and `node_modules` are already in `.gitignore`: check that no key is committed.
2. Render → New → Web Service → pick the repo. Settings: Root directory `backend`, Runtime Python, Build `pip install -r requirements.txt`, Start `uvicorn main:app --host 0.0.0.0 --port $PORT`, Instance type **Free**, Health check path `/api/health`.
3. Environment variables:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | the Neon connection string |
   | `GEMINI_API_KEY` | your key |
   | `API_TOKEN` | a long random string. **Required on the public internet**, otherwise anyone who finds the URL can read and edit your finances |
   | `PYTHON_VERSION` | `3.11.9` (or any 3.11+) |

**3. The app** (`frontend/.env`): `EXPO_PUBLIC_API_URL=https://<your-service>.onrender.com` and `EXPO_PUBLIC_API_TOKEN=<the same token>`, then restart `npx expo start`.

**Good to know**
- **Cold starts:** the free server sleeps after 15 minutes idle and takes 30-60 s to wake (Neon wakes in about a second). The app waits up to 45 s per request, so the first open after a break is slow but works. To avoid it, point a free uptime pinger (e.g. UptimeRobot or cron-job.org) at `https://<your-service>.onrender.com/api/health` every 5-10 minutes; one always-on free service fits inside Render's monthly free hours.
- **Limits:** Neon's free plan has a small storage cap (plenty for years of slips); check the current terms of both services, they change.
- **Backups:** Neon's free plan keeps only a short restore window. For a copy of your data, use Neon's export / `pg_dump` now and then.
- **Starting fresh:** the hosted database starts empty. (If you ever need to move old SQLite data over, ask and I'll write a one-off copy script.)
- **Not verified here:** I ran the full backend test suite on a real local PostgreSQL 16, but I could not create Neon or Render accounts, so the deployment steps themselves are untested.
- **The phone still needs the app's JavaScript from somewhere:** in Expo Go that is `npx expo start` on your Mac. To use the app away from the Mac you need a standalone build (Apple's $99/year program, or a free Xcode build that must be reinstalled every 7 days).

**Paid alternative:** Render Starter with a persistent disk (about $7/month) works with plain SQLite: `FINANCE_DB_URL=sqlite:////var/data/finance.db`, disk mounted at `/var/data`.

## Privacy

Receipt images are held in memory just long enough to be sent to Gemini; they are not written to your Mac's disk, kept in the database, or copied on your phone. Only a one-way SHA-256 hash of each imported image is kept so re-sending the same image doesn't create a duplicate.

Every screenshot the watcher examines is checked by sending it to your backend, which sends it to Google's Gemini API. The Assistant also sends your spending totals, merchants and recent transactions to Gemini to write advice and answer chat questions. The watcher only looks at screenshots taken after you tap **Turn on**, and you can turn it off any time in the Inbox. Grant **full** Photos access (not "Selected photos") or new screenshots can't be seen.

Set `API_TOKEN` in `backend/.env` (and `EXPO_PUBLIC_API_TOKEN` in `frontend/.env`) to require an `X-API-Token` header, so other devices on your Wi-Fi can't spend your Gemini quota.

## Limits

- iOS doesn't let apps run in the background on every screenshot, so detection happens when you open the app (and while it's open). The Shortcut is the instant path.
- Screenshot detection and the Photos permission need a real device or Simulator with Photos access granted; it does not work in a web build.

## Testing

Both suites run offline: no network, no Gemini key, no running backend, and nothing touches your real data.

### Backend (pytest)

```bash
cd backend
source .venv/bin/activate
pip install -r requirements-dev.txt     # pytest, pytest-asyncio, pytest-mock, httpx
pytest                                  # everything (~1 second)
pytest tests/test_api.py -v             # one file
pytest -k "confirm or upload"           # by name
```

| File | What it covers |
| --- | --- |
| `tests/test_ai_service.py` | **Unit.** Gemini is faked: receipt bytes → the four-field JSON schema (`amount`, `merchant_name`, `category`, `transaction_date`), request contents (image bytes, strict-JSON settings), category/date/amount normalisation, non-receipts, malformed output, API failures; advice parsing; chat prompt |
| `tests/test_api.py` | **Integration** (httpx `AsyncClient` against the real app + a temp SQLite file): `/upload`, `/import` → pending → `/confirm`, proof that **no temp files or upload folder are ever created** (checked with a >1 MB upload that forces spooling), `GET /transactions`, `GET /summary` breakdowns and budget alerts, the API token, and the **AI advisor chat prompt containing the user's real transaction history** (and picking up a slip saved a moment earlier) |
| `tests/test_ai_resilience.py` | retries, model fallback, cooldowns, quota vs overload vs bad-key handling, friendly errors, markdown stripping |
| `tests/test_budgets_advice.py` | budgets, status thresholds, currency setting, advice fallback / AI path / caching |
| `tests/test_memory.py` | the assistant's context, query tools (incl. SDK schema validity) and budget impact |
| `tests/test_search.py` | smart-search parser and endpoint |
| `tests/test_language.py` | Burmese / Zawgyi detection, prompt rules, Burmese data round-trips |
| `tests/test_database.py` | startup migration of older databases, legacy-image purge script, which database URL is chosen (SQLite vs Postgres) |

How it stays safe: `tests/conftest.py` sets `FINANCE_DB_URL` to a throwaway database *before* the app is imported, blanks `GEMINI_API_KEY` / `API_TOKEN`, resets the tables for every test, and swaps `ai_service._client` for a `FakeGemini` that records each request.

**Run the same tests on a real Postgres** (what Neon runs), no account needed:

```bash
pip install pgserver              # a pip-installable PostgreSQL, used only for this
python tests/run_on_postgres.py   # starts a throwaway Postgres, runs the whole suite on it, stops it
```

### Frontend (Jest + React Native Testing Library)

```bash
cd frontend
npm install --legacy-peer-deps
npm test                    # run everything once
npm run test:watch          # re-run on change
npm run test:coverage       # with a coverage report in frontend/coverage
npx jest __tests__/api.test.ts    # one file
```

| File | What it covers |
| --- | --- |
| `__tests__/api.test.ts` | `fetch` mocked: every route the app calls (URLs, methods, JSON bodies, query encoding), error messages, timeouts, the hand-built multipart image upload (screenshot file and clipboard `data:` URI) |
| `__tests__/components/SummaryCard.test.tsx`, `TiltCard.test.tsx`, `BudgetCards.test.tsx` | the 3D hero card, tilt/parallax primitives and neumorphic badges, budget progress cards |
| `__tests__/components/PendingCard.test.tsx` | the **1-tap confirmation card**: confirm with no edits, edited fields only, invalid input blocked, discard, failure alert, category picker |
| `__tests__/components/RecentSlips.test.tsx`, `Toast.test.tsx` | day grouping, expand/collapse, debounced smart search, category filter, empty and error states; the "saved" toast |
| `__tests__/screens/Dashboard.test.tsx`, `Inbox.test.tsx` | whole screens with the stores mocked: overview, alerts, pending banner, empty/error states, chip filtering; Inbox review flow, permission states, clipboard paste, manual entry |
| `__tests__/store.test.tsx` | `TransactionsContext`: loading, failure handling, confirm → notice → auto-clear |
| `__tests__/utils.test.ts` | category icon mapping, baht/yen/kyat formatting, dates, Burmese line height, colour helpers |

Native-only modules (Reanimated worklets, blur, haptics, gradients, key-value storage, file system) are replaced in `jest.setup.tsx`; the real animation/gesture behaviour (tilt following a finger, springs) needs a device or Simulator.

## Notes

- If OCR fails (no key, quota, unreadable image) the app shows the error and lets you enter the transaction manually.
- Override the model with `GEMINI_MODEL` in `backend/.env`.
- Currency is USD (`frontend/utils/format.ts`).
