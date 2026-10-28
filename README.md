# Affiliate Hub: backend

The API for Affiliate Hub. It handles affiliate sign-up and approval, commission tracking, and payouts. The dashboard and the mobile app both talk to this API, and all business rules live here.

Built with Node.js 22, Express 5, MongoDB (Mongoose), zod and JWT.

**Related repos:** [affiliate-frontend](https://github.com/rahul-312/affiliate-frontend) (dashboard for ops and finance) · [affiliate-mobile](https://github.com/rahul-312/affiliate-mobile) (Android app for affiliates)

---

## Before you start

Install these first:

| Tool | Version | Check it with |
| --- | --- | --- |
| Node.js | 22 (anything ≥ 20.11 works) | `node -v` |
| MongoDB | 7, **running as a replica set** (see step 2) | |

You need a replica set because the API uses MongoDB transactions. You can get one in either of two ways:

- **Docker** (easiest locally): install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and make sure it is running.
- **MongoDB Atlas** (free cloud database): every Atlas cluster is already a replica set, so you don't need any extra setup.

---

## Setup

Run every command from inside the `affiliate-backend` folder.

### Step 1: Install dependencies

```bash
npm install
```

### Step 2: Start MongoDB as a replica set

**With Docker**, run these two commands once:

```bash
docker run -d -p 27017:27017 --name mongo mongo:7 --replSet rs0
docker exec mongo mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})"
```

The second command should print `{ ok: 1 }`. After a restart, start the database again with `docker start mongo`.

**With Atlas**, create a free cluster, add a database user, and copy its connection string (`mongodb+srv://...`). Use it in step 3.

### Step 3: Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` and set `MONGODB_URI`:

- Docker: leave the default, `mongodb://localhost:27017/affiliate?replicaSet=rs0`
- Atlas: paste your connection string, with `/affiliate` as the database name

### Step 4: Generate the secrets

```bash
npm run gen:secrets
```

This prints three lines: `JWT_SECRET`, `CONVERSION_API_KEY` and `PAYOUT_DETAILS_KEY`. Copy them into `.env` in place of the three `change-me` values.

### Step 5: Load the demo data

```bash
npm run seed
```

This **wipes the database** and creates the demo accounts listed below. It ends with `Done. All demo accounts use the password "demo1234"`.

### Step 6: Start the server

```bash
npm run dev
```

Open <http://localhost:4000/api/health> in your browser. You should see:

```json
{"status":"ok","db":"up"}
```

The backend is running. You can now set up the [dashboard](https://github.com/rahul-312/affiliate-frontend) or the [mobile app](https://github.com/rahul-312/affiliate-mobile).

---

## Demo accounts

All accounts use the password **`demo1234`**.

| Email | Role | What's already set up for it |
| --- | --- | --- |
| `ops@demo.com` | Ops | |
| `finance@demo.com` | Finance | |
| `affiliate@demo.com` | Affiliate (active) | UPI saved, commissions in every status, and one paid batch (`PB-0001`, ref `UTR998877`) |
| `nodetails@demo.com` | Affiliate (active) | ₹750 approved but no payout details, so it shows under "missing payout details" |
| `pending@demo.com` | Affiliate (pending) | Waiting for approval |

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the server on port 4000 and restarts it when you change a file |
| `npm start` | Starts the server without auto-restart (used in production) |
| `npm run seed` | Wipes the database and loads the demo data |
| `npm run gen:secrets` | Prints fresh random secrets for `.env` |
| `npm test` | Runs all tests. They use their own in-memory MongoDB, so you don't need a database running |
| `npm run lint` | Checks code style |
| `npm run backfill:rates` | One-off migration: gives affiliates approved before per-affiliate rates existed a stored rate |

---

## Environment variables

The server **won't start** if a required variable is missing or still says `change-me`. The error message names the variable to fix.

| Variable | Required | What it's for |
| --- | --- | --- |
| `MONGODB_URI` | Yes | Database connection. Must be a replica set (`?replicaSet=rs0` locally) |
| `JWT_SECRET` | Yes | Signs login tokens. At least 32 characters |
| `CONVERSION_API_KEY` | Yes | Key the external store sends (as `x-api-key`) when it reports a sale |
| `PAYOUT_DETAILS_KEY` | Yes | 64 hex characters. Encrypts affiliates' bank and UPI details in the database |
| `CORS_ORIGINS` | | Dashboard URL(s) allowed to call the API, comma-separated. Locally: `http://localhost:3000` |
| `DEMO_MODE` | | `true` turns on the dashboard's "Simulate sale" button. Turn it off in a real deployment |
| `REFERRAL_BASE_URL` | | Start of each affiliate's referral link; the code is added to the end. Default: `https://shop.example.com/?ref=` |
| `TRUST_PROXY` | | Number of proxies in front of the server (`1` on Render). Needed for per-IP rate limits |
| `PORT`, `JWT_EXPIRES_IN`, `LOG_LEVEL`, `AUTH_RATE_LIMIT_MAX`, `API_RATE_LIMIT_MAX` | | Optional. The defaults in `.env.example` are fine |

---

## Common problems

| You see | Fix |
| --- | --- |
| `Refusing to start. Invalid environment configuration:` followed by a variable name | Run `npm run gen:secrets` and paste the values into `.env` (step 4) |
| `Transaction numbers are only allowed on a replica set` | MongoDB isn't running as a replica set. Redo step 2 and check that `MONGODB_URI` ends in `?replicaSet=rs0` |
| Server hangs on start, or `Server selection timed out` | MongoDB isn't running. Start it with `docker start mongo` |
| `docker: ... name "/mongo" is already in use` | The container already exists. Run `docker start mongo` instead of `docker run` |
| `EADDRINUSE: address already in use :::4000` | Another process is using port 4000. Stop it or set `PORT` in `.env` |
| The dashboard shows a CORS error | Add the dashboard's URL to `CORS_ORIGINS` in `.env` and restart the server |

---

## Deploying to Render + Atlas

1. Create a free Atlas cluster. Under **Network Access**, allow `0.0.0.0/0` (fine for a demo).
2. On Render, choose **New → Blueprint** and select this repo. Render reads `render.yaml` and generates `JWT_SECRET` and `CONVERSION_API_KEY` for you.
3. Fill in the three remaining values in the Render dashboard:
   - `MONGODB_URI`: your Atlas connection string
   - `PAYOUT_DETAILS_KEY`: the value from `npm run gen:secrets`
   - `CORS_ORIGINS`: your deployed dashboard URL, for example `https://affiliate-frontend.vercel.app`
4. Seed the production database once, from your computer:

   ```bash
   # Git Bash / macOS / Linux
   MONGODB_URI="<atlas connection string>" npm run seed -- --allow-production
   ```

   ```powershell
   # PowerShell
   $env:MONGODB_URI="<atlas connection string>"; npm run seed -- --allow-production
   ```

5. Open `https://<your-service>.onrender.com/api/health` and check that it returns `{"status":"ok","db":"up"}`.

Render's free tier sleeps when idle, so **the first request can take about 30 seconds**.

---

## API

Base path: `/api`. Errors always look like `{ "error": { "code", "message", "details?" } }`.

| Method | Route | Who can call it | What it does |
| --- | --- | --- | --- |
| GET | `/health` | anyone | Server and database check |
| GET | `/program` | anyone | Program details: rate, minimum payout, rules, how to join |
| POST | `/auth/signup` | anyone (rate-limited) | Apply as an affiliate. The server sets the role, status and referral code |
| POST | `/auth/login` | anyone (rate-limited) | Returns a JWT and the user |
| GET | `/me` | signed in | Current user (payout details masked) |
| GET | `/me/summary` | affiliate | Balances in paise, plus `needsPayoutDetails` and `belowMinimum` |
| PUT | `/me/payout-method` | active affiliate | Save UPI or bank details (validated, stored encrypted) |
| POST | `/me/pause` · `/me/resume` | affiliate | Pause or resume your own account (optional `{ reason }`). Can't undo a deactivation by ops. Max 20 changes an hour |
| GET | `/me/commissions` · `/me/payouts` | affiliate | Your commissions; your completed payouts with their payment reference |
| POST | `/conversions` | `x-api-key` | Store reports a sale. `201` new, `200` identical retry, `409` same order ID with different data |
| POST | `/admin/demo/simulate-sale` | ops, only when `DEMO_MODE=true` | Records a sale the same way `/conversions` does |
| GET | `/admin/stats` | ops, finance | Numbers for the overview page |
| GET | `/admin/affiliates?status=` | ops, finance | List affiliates (details masked) |
| POST | `/admin/affiliates/:id/approve` · `/reject` | ops | Approve takes an optional `{ rateBps }` (1%–50%, default is the program rate). Reject needs `{ reason }` |
| PATCH | `/admin/affiliates/:id/rate` | ops | `{ rateBps }`: change the rate for future sales. Logged in the audit trail |
| POST | `/admin/affiliates/:id/deactivate` · `/reactivate` | ops | Deactivate needs `{ reason }`: the link stops working, new sales are refused and payouts are held. Reactivate takes an optional `{ note }` |
| GET | `/admin/commissions?status=` | ops, finance | Commission queue |
| POST | `/admin/commissions/approve` · `/reject` | ops | `{ ids }` or `{ ids, reason }`. Either all succeed or none do |
| POST · GET | `/admin/payouts` | finance | Create a payout batch · list batches |
| GET | `/admin/payouts/missing-details` | finance | Affiliates who are owed money but have no payout details |
| GET | `/admin/payouts/:id` | finance | One batch with its items |
| GET | `/admin/payouts/:id/export.csv` | finance | Download the bank CSV (the only place full details appear). Marks the batch `exported` |
| POST | `/admin/payouts/:id/confirm` | finance | `{ paymentReference, failedItems?: [{ affiliateId, reason }] }` |
| POST | `/admin/payouts/:id/cancel` | finance | Cancel a batch that's still a draft |

### Payout CSV format

A generic bulk-transfer file. It doesn't follow any particular bank's format.

```csv
batch_no,affiliate_id,beneficiary_name,method,upi_id,account_number,ifsc,amount_inr,commission_count,narration
PB-0002,6ae0…b325,Asha Verma,upi,asha.verma@okhdfc,,,600.00,1,Affiliate payout PB-0002
```

Amounts are in rupees with two decimals. Cells starting with `= + - @` are escaped so spreadsheets don't run them as formulas.

---

## How it works

- **One API, roles on the user.** Each user is `affiliate`, `ops` or `finance`, and every route checks the role. The role and account status are read from the database on every request, so a deactivated user loses access straight away.
- **Commissions are the source of truth.** A payout batch only groups commissions. Its totals can always be recalculated from the commissions in it, and at confirm time `paid + failed = original total` is checked.
- **Money is stored as whole numbers.** Amounts are in paise and rates in basis points, so there are no floating-point errors. Rounding is done in one place (`src/utils/money.js`). Each commission keeps the rate it was created with, so changing an affiliate's rate never changes past commissions.
- **Only one open payout batch at a time.** A unique index enforces this, even if two people click "Create" at once. Draft batches can be cancelled. Exported batches can't, because the bank may already have sent money; finance closes them by confirming and marking any failed items.
- **Safe retries for sales.** Sending the same order twice with the same data does nothing (`200`). Sending the same order ID with a different amount or code is rejected (`409`).
- **Referral links only work after approval.** Sales for affiliates who aren't active are refused.
- **Pausing and deactivating.** An affiliate can pause their own account and resume later. Ops can deactivate an account with a reason, which also holds that affiliate's payouts. If a held affiliate was already in an exported batch, finance must say at confirm time whether the bank actually paid them.

### Security

- Bank and UPI details are encrypted in the database (AES-256-GCM). The API only returns a masked form like `UPI: ra***@okhdfc`. Full details appear only in the finance CSV.
- Every request body is validated with a strict zod schema. Unknown fields are rejected with `400`.
- Passwords are hashed with bcrypt (cost 12). JWTs have a fixed algorithm, issuer and audience.
- The API key is compared in constant time. The server also uses `helmet`, a CORS allow-list, per-IP rate limits and a 50 kB body limit.
- Logs are structured (pino) with secrets redacted. Clients never see stack traces or raw database errors.

---

## Key decisions and tradeoffs

| Decision | Why | Tradeoff |
| --- | --- | --- |
| **One API for both apps, with roles** | Rules live in one place, so the app and dashboard always agree | Every client depends on this one server |
| **Money stored as whole paise** | No rounding errors from decimals | Amounts must be converted for display and CSV |
| **Each commission keeps its own rate** | Changing a rate never changes past earnings | Slightly more data per commission |
| **Commissions are the source of truth** | Batch totals can always be recalculated and checked | Totals are recomputed instead of just read |
| **Only one open payout batch at a time** | Nobody can be paid twice by two overlapping batches | Finance must finish or cancel a batch before starting the next |
| **CSV + manual confirmation instead of a gateway** | Works with any bank today, no gateway contract needed | Finance uploads the file and types in the payment reference by hand |
| **Static API key for the store's sales webhook** | Simple for the store to set up | Weaker than a signed webhook if the key leaks |
| **MongoDB replica set required** | Transactions keep sales, commissions and payouts consistent | Local setup needs one extra command |

## What we'd add with more time

- **Payment gateway payouts** (RazorpayX or Stripe Connect), using the same batch model
- **Bank statement matching**: upload the statement and mark payments as confirmed automatically
- **Refund holding period**: commissions can be approved only after the return window ends
- **Signed webhooks** (HMAC with a timestamp) instead of the static API key
- **Click tracking and fraud checks** (self-referrals, sudden spikes)
- **Email and push notifications** when an affiliate is approved, earns a commission or gets paid
- **Tiered rates**: affiliates who sell more earn a higher rate
- **Saving payout details on the batch**, so the CSV uses the details finance reviewed

---

## Project layout

```text
src/
  app.js                 Builds the Express app (used by server.js and the tests)
  server.js              Checks config, connects to the database, starts listening
  config/env.js          Reads and validates environment variables
  db/connect.js          Database connection and index setup
  models/                The 6 MongoDB collections
  middleware/            Auth and roles, API key check, validation, rate limits, error handler
  modules/<feature>/     routes, service and schemas for each feature:
                         auth, program, me, conversions, affiliates, commissions, payouts, stats, demo, audit
  modules/serializers.js Shapes every API response, so secrets can't leak by accident
  utils/                 Money, encryption, masking, CSV, transactions, logger
scripts/                 seed, gen:secrets, backfill:rates
tests/                   unit/ and integration/ (Jest + Supertest + in-memory MongoDB)
```
