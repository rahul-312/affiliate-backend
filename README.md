# Affiliate Hub: backend

The single API behind the Affiliate Hub v1: affiliate sign-up and approval, commission tracking and release, and payouts for the finance team. This README is the main one for the whole project. The other two repos link here.

| Repo | What it is | Stack |
| --- | --- | --- |
| **affiliate-backend** (this repo) | The one API and every business rule | Node.js 22, Express 5, MongoDB (Mongoose), zod, JWT |
| [affiliate-dashboard](../affiliate-dashboard) | Internal tool for the ops (affiliate) and finance teams | Next.js 16 (App Router), TypeScript |
| [affiliate-mobile](../affiliate-mobile) | Affiliate-facing app, shipped as an Android APK | React Native, Expo SDK 58, Expo Router |

---

## 1. Overview

**The problem.** The program needs more affiliate sign-ups. The affiliate team can't reliably track and release commissions, and finance struggles to pay people.

**The v1.** One commission lifecycle, working end to end across all three teams:

```
Landing pitch ─► sign up ─► "application received" ─► ops approves ─► referral link goes live
  (mobile)       (mobile)        (mobile)              (dashboard)          (mobile)
                                                                               │
                                                                               ▼
 mobile shows "paid" ◄─ finance confirms ◄─ finance batches ◄─ ops approves ◄─ sale recorded
                         with reference      + exports CSV      commission      (pending)
```

**Acceptance criterion.** A reviewer installs the APK and registers an affiliate. They approve that affiliate in the dashboard, simulate a sale and approve the commission. They then create and export a payout, confirm the payment with a reference, and see the resulting status in the app. Everything runs against one deployed backend, with no manual database edits.

### Architecture

```
 ┌─────────────────────┐   HTTPS / JSON, Authorization: Bearer <JWT>
 │ affiliate-mobile    │──────────┐
 │ Expo → Android APK  │          ▼
 └─────────────────────┘   ┌──────────────────────┐   Mongoose   ┌───────────────────┐
 External store ──────────►│ affiliate-backend    │◄────────────►│ MongoDB           │
 (x-api-key webhook)       │ Express: ONE API     │              │ replica set       │
                           └──────────────────────┘              └───────────────────┘
 ┌─────────────────────┐          ▲
 │ affiliate-dashboard │──────────┘
 │ Next.js (ops+fin)   │
 └─────────────────────┘
```

The backend tells callers apart by the **role** stored on the user (`affiliate`, `ops` or `finance`), not by running separate servers. The external store is authenticated with a server-side API key.

---

## 2. How the repos connect

| | Base URL (local) | Env var that points at the backend | Who calls the backend |
| --- | --- | --- | --- |
| Backend | `http://localhost:4000/api` | n/a | n/a |
| Dashboard | `http://localhost:3000` | `NEXT_PUBLIC_API_URL=http://localhost:4000/api` | the browser (so the backend's `CORS_ORIGINS` must list the dashboard origin) |
| Mobile | Expo dev server / APK | `EXPO_PUBLIC_API_URL=http://10.0.2.2:4000/api` (emulator) or the deployed `https://…/api` (APK) | the phone (CORS doesn't apply to native apps) |

**Startup order**

1. **MongoDB as a replica set.** Transactions need one. Atlas clusters already are one. Locally:
   ```bash
   docker run -d -p 27017:27017 --name mongo mongo:7 --replSet rs0
   docker exec mongo mongosh --eval "rs.initiate()"
   ```
2. **Backend** (this repo): see below, then check `GET http://localhost:4000/api/health` → `{"status":"ok","db":"up"}`.
3. **Dashboard**: `npm install && cp .env.example .env.local && npm run dev` → http://localhost:3000.
4. **Mobile**: `npm install && cp .env.example .env && npx expo start`, or install the APK.

---

## 3. Install, configure, run (backend)

Requires Node.js ≥ 20.11 (22 recommended, see `.nvmrc`).

```bash
npm install
cp .env.example .env
npm run gen:secrets      # prints JWT_SECRET, CONVERSION_API_KEY and PAYOUT_DETAILS_KEY: paste them into .env
npm run seed             # resets the DB to the demo state below
npm run dev              # http://localhost:4000/api
npm test                 # 108 tests, in-memory MongoDB replica set (no setup needed)
npm run lint
```

The server **refuses to start** if `MONGODB_URI`, `JWT_SECRET`, `CONVERSION_API_KEY` or `PAYOUT_DETAILS_KEY` is missing, or if a secret is still a `change-me` placeholder. It also refuses a `JWT_SECRET` under 32 characters and non-https CORS origins in production. The error names the offending variable.

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | ✔ | Must point at a replica set (`?replicaSet=rs0` locally) |
| `JWT_SECRET` | ✔ | ≥ 32 chars. Signs access tokens (HS256, issuer/audience pinned) |
| `CONVERSION_API_KEY` | ✔ | Shared with the store calling `POST /api/conversions` |
| `PAYOUT_DETAILS_KEY` | ✔ | 64 hex chars. AES-256-GCM key for bank/UPI details at rest |
| `CORS_ORIGINS` | | Comma-separated dashboard origin(s) |
| `DEMO_MODE` | | `true` enables `POST /api/admin/demo/simulate-sale` (ops only) |
| `REFERRAL_BASE_URL` | | Prefix for shareable links (`…?ref=CODE`) |
| `TRUST_PROXY` | | Number of proxies in front (Render: `1`), used for per-IP rate limits |
| `JWT_EXPIRES_IN`, `LOG_LEVEL`, `AUTH_RATE_LIMIT_MAX`, `API_RATE_LIMIT_MAX`, `PORT` | | Have sensible defaults |

### Deploying (Render + Atlas)

`render.yaml` is a Render Blueprint. Create a free Atlas cluster and allow Render's egress IPs (or `0.0.0.0/0` for the demo). Create the Blueprint, then fill in `MONGODB_URI`, `PAYOUT_DETAILS_KEY` and `CORS_ORIGINS` (the Vercel dashboard URL). Seed once from your machine with the production URI: `MONGODB_URI=… npm run seed -- --allow-production`. Render's free tier sleeps, so **the first request can take ~30 s**. Both clients allow for that with a 45 s timeout and a "waking up" hint.

### Demo accounts (password `demo1234` for all)

| Role | Email | Seeded state |
| --- | --- | --- |
| Ops | `ops@demo.com` | |
| Finance | `finance@demo.com` | |
| Affiliate (active) | `affiliate@demo.com` | UPI saved. Commissions in every status, and one paid batch (`PB-0001`, ref `UTR998877`) |
| Affiliate (no payout details) | `nodetails@demo.com` | ₹750 approved and waiting. Shows under "missing payout details" |
| Affiliate (pending) | `pending@demo.com` | Awaiting approval |

> `DEMO_MODE=true` stays on for the reviewer demo. In a real deployment it would be off, and sales would only arrive through the API-key webhook.

### Walking the acceptance test

1. Install the APK and sign up. The app shows "application received" with the referral link greyed out.
2. Dashboard as **ops** → Affiliates → approve. In the app, pull to refresh: the link is live, and Share opens the native share sheet.
3. Dashboard as **ops** → Commissions → *Simulate sale* with the new code, ₹5,000. A ₹500.00 pending commission appears at 10%.
4. Approve it. The app shows the banner "You've earned ₹500.00. Add payout details…". Finance sees the affiliate under "Owed but missing payout details".
5. App → add a UPI ID. The banner disappears.
6. Dashboard as **finance** → Payouts → *Create payout batch* → *Download CSV* → *Confirm payment* with `UTR123456`.
7. The app shows the commission as paid, and Payouts lists the batch with its reference.
8. Negative checks: re-send the same order ID and amount (nothing new is created). Send a different amount (`409`). Approve the paid commission again (`409`). Confirm the batch again (`409`).

The same flow is covered by the API tests. A shell version against a running server was used during development.

---

## 4. API

Base path `/api`. Errors are always `{ "error": { "code", "message", "details?" } }`.

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | public | Uptime + DB check |
| GET | `/program` | public | Landing pitch and terms (rate, minimum payout, rules, steps) |
| POST | `/auth/signup` | public, rate-limited | Affiliate application. Strict whitelist: server sets role, status and referral code |
| POST | `/auth/login` | public, rate-limited | JWT + user |
| GET | `/me` | any | Current user (payout details masked) |
| GET | `/me/summary` | affiliate | Balances in paise + `needsPayoutDetails` / `belowMinimum` |
| PUT | `/me/payout-method` | active affiliate | UPI or bank (validated UPI/IFSC), stored encrypted |
| GET | `/me/commissions`, `/me/payouts` | affiliate | Own commissions, own successful payouts with reference |
| POST | `/conversions` | `x-api-key` | Store webhook: `201` new, `200` identical retry, `409` conflicting retry |
| POST | `/admin/demo/simulate-sale` | ops, `DEMO_MODE` | Same pipeline as the webhook |
| GET | `/admin/stats` | ops, finance | Overview numbers |
| GET | `/admin/affiliates?status=` | ops, finance | List (masked details) |
| POST | `/admin/affiliates/:id/approve` · `/reject` | ops | Reject requires `{ reason }` |
| GET | `/admin/commissions?status=` | ops, finance | Queue |
| POST | `/admin/commissions/approve` · `/reject` | ops | `{ ids }` / `{ ids, reason }`. All-or-nothing |
| POST / GET | `/admin/payouts` | finance | Create batch (transaction) / list |
| GET | `/admin/payouts/missing-details` | finance | Owed, but no payout details |
| GET | `/admin/payouts/:id` | finance | Batch with items |
| GET | `/admin/payouts/:id/export.csv` | finance | Bank CSV. The only place full details appear. Marks the batch `exported` |
| POST | `/admin/payouts/:id/confirm` | finance | `{ paymentReference, failedItems?: [{ affiliateId, reason }] }` |
| POST | `/admin/payouts/:id/cancel` | finance | Draft batches only |

### Payout CSV

This simulates a generic bulk-transfer upload. It isn't claimed to match any specific bank's format.

```
batch_no,affiliate_id,beneficiary_name,method,upi_id,account_number,ifsc,amount_inr,commission_count,narration
PB-0002,6ae0…b325,Asha Verma,upi,asha.verma@okhdfc,,,600.00,1,Affiliate payout PB-0002
```

Amounts are rupees with two decimals, converted from paise only at export. Cells that a spreadsheet would execute (`= + - @`) are neutralised.

---

## 5. What I built for v1, and why

**One lifecycle across three teams, done properly**, rather than many half-features. Each of the three problems gets the smallest thing that actually fixes it:

| Problem | v1 answer |
| --- | --- |
| **Too few sign-ups** | A pitch screen driven by `GET /program` (rate, minimum payout, what qualifies, how payouts work). Sign-up is under a minute: name, email, password and where you'll promote. **No bank details up front**: asking a stranger for them before they've earned anything is friction and erodes trust. You get instant "application received" feedback, then a shareable link (native share sheet) the moment you're approved. |
| **Ops can't track and release commissions** | Every commission has a server-enforced status, a **snapshotted rate** and a full history (who, what, when, why). It moves with one click or in bulk. Rejections need a reason. Any illegal transition returns `409`. |
| **Finance struggles to pay** | Approved commissions are **reserved** into a batch. Finance downloads a documented CSV for the bank and marks it paid only after confirming with a **payment reference**. Failed transfers are recorded per affiliate with a reason and retried automatically next run. Affiliates without payout details are surfaced, not silently dropped. |

## 6. Key decisions and tradeoffs

- **One backend, role-based access.** Mobile and dashboard are thin clients of the same API, so rules exist in exactly one place. Next.js is used purely as a frontend: no API routes or server actions with business logic.
- **Commissions are the source of truth.** A batch only groups and reconciles. Its totals can always be recomputed from the commissions that point at it. `originalTotalPaise` is fixed at creation. At confirm, `paidPaise + failedPaise = originalTotalPaise` is checked inside the transaction.
- **Integer money.** Paise and basis points, half-up rounding implemented once (`src/utils/money.js`, BigInt-exact) and unit-tested. The rate is snapshotted on each commission, so changing the program rate never rewrites history.
- **Transactional, single-open-batch payouts.** Every open batch carries `openBatchKey: 'OPEN'` under a partial unique index, so a second open batch (draft *or* exported) is impossible even with concurrent clicks. It's tested with parallel requests. All updates are status-guarded with modified-count checks. An empty batch rolls back and leaves no lock. Drafts can be cancelled. Exported batches can't be, because money may have moved: they're closed via confirm with failed items instead.
- **Payload-aware idempotency for sales.** The same `orderId` with the same payload is a safe retry (`200`). The same `orderId` with a different amount or code is a conflict (`409`, naming the differing fields), never silently treated as a duplicate. Conversion + commission + audit entry are written in one transaction. A concurrent duplicate is resolved outside the aborted transaction.
- **CSV + manual confirmation instead of a payment gateway.** This is honest for v1: finance can operate it today, and the reference + per-item failure model maps cleanly onto a gateway later.
- **Referral link activates only on approval.** Sign-up stays frictionless, while unvetted accounts can't earn: conversions for non-active affiliates are refused.
- **Payout details after approval, not at sign-up.** A shorter form converts better, and sensitive data is only requested once there's a reason to give it.
- **Security posture** (beyond the plan's baseline):
  - Bank/UPI details are **encrypted at rest (AES-256-GCM)**. Only a masked form (`UPI: ra***@okhdfc`, `Bank: ****4821`) is stored in clear or ever returned. Full details are decrypted in exactly one place: the finance CSV export.
  - Strict zod schemas on every input (unknown fields → `400`), so role escalation or operator injection via JSON can't reach a query.
  - bcrypt (cost 12) with timing-equalised login. JWT with pinned algorithm/issuer/audience. Role and status are re-read from the DB on every request, so a revoked user loses access immediately.
  - Constant-time API-key comparison. `helmet`, a CORS allow-list, per-IP rate limits on auth and on the whole API, a 50 kB body limit.
  - Redacted structured logs (pino). A central error handler: no stack traces or Mongo errors ever reach a client.
  - Fail-fast config validation. The release APK refuses non-https API URLs. The JWT is kept in the Android Keystore (SecureStore). The dashboard ships a strict CSP and `frame-ancestors 'none'`.
- **Expo + EAS** for a reliable signed APK without a local Android toolchain. **Next.js on Vercel** for the internal dashboard.

**Deliberate cuts** (would come next): real gateway payouts, click tracking and attribution windows, fraud scoring, refund holding period, tiered rates, email/push notifications, tax/KYC, multi-currency (INR only).

## 7. What I'd do next

1. **HMAC-signed webhooks** with timestamp + replay window, replacing the static API key.
2. **Reconciliation for exported batches**: import the bank statement, auto-match by reference and amount, and flag mismatches.
3. **Refund holding period**: commissions become approvable only after the return window, with clawbacks on refunds.
4. **Gateway payouts** (RazorpayX / Stripe Connect) driven by the same batch model, with webhooks updating item status.
5. **Click tracking and attribution windows**, a per-affiliate conversion funnel, and **fraud signals** (self-referral, velocity, coupon sites).
6. **Notifications**: push/email on approval, commission approved and payout sent.
7. **Session hardening**: httpOnly-cookie sessions for the dashboard, refresh-token rotation, staff 2FA, and key rotation for `PAYOUT_DETAILS_KEY` (the ciphertext is already versioned `v1.`).
8. Editable program settings in the dashboard, tiered or per-product rates, and an audit-log viewer.

## Project layout

```
src/
  app.js                 Express app factory (no side effects: used by server and tests)
  server.js              Config validation → DB connect → listen, graceful shutdown
  config/env.js          zod-validated, frozen configuration (fail fast)
  db/connect.js          Connection + up-front collection/index creation
  models/                6 collections + shared enums
  middleware/            auth/roles, API key, validation, rate limits, error handler
  modules/<feature>/     routes · service · schemas per feature
    auth  program  me  conversions  affiliates  commissions  payouts  stats  demo  audit
  modules/serializers.js The only response shapes (secrets can't leak by accident)
  utils/                 money, field encryption, masking, CSV, transactions, logger
scripts/seed.js          Demo data created through the real services
tests/                   unit/ + integration/ (Jest + Supertest + mongodb-memory-server replica set)
```
