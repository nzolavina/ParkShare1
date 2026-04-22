# ParkShare

ParkShare is a parking-spot sharing web app with a static frontend and an Express API.

This project is now structured for:

1. Vercel hosting (frontend + serverless API)
2. Supabase Postgres (database)
3. Supabase Storage (listing images and payment receipts)
4. Postgres-backed sessions (so auth works on serverless)

## What changed

1. API routes moved into shared app file: app.js
2. Local server bootstrap kept for development: server.js
3. Vercel serverless entry added: api/[...path].js
4. Database moved from JSON files to Supabase tables
5. Uploads moved from local disk to Supabase Storage
6. Session store moved to Postgres when DATABASE_URL is set

## Folder highlights

1. app.js: Express app and all API routes
2. server.js: local start command (npm start)
3. api/[...path].js: Vercel API handler
4. supabase/schema.sql: run this in Supabase SQL editor
5. scripts/migrate-json-to-supabase.js: one-time JSON to Supabase migration
6. .env.example: required environment variables

## First-time setup (local)

1. Install dependencies.

   npm install

2. Create Supabase project.

3. Open Supabase SQL editor and run supabase/schema.sql.

4. Create Supabase Storage buckets:

   1. listing-images
   2. receipts

5. Copy .env.example to .env and fill values.

6. Start local server.

   npm start

7. Open app in browser.

   http://localhost:3000

## Environment variables

Set these for local .env and in Vercel Project Settings.

1. SUPABASE_URL
2. SUPABASE_SERVICE_ROLE_KEY
3. SUPABASE_LISTING_BUCKET (default: listing-images)
4. SUPABASE_RECEIPT_BUCKET (default: receipts)
5. DATABASE_URL (Supabase Postgres connection string)
6. SESSION_SECRET
7. ADMIN_EMAIL
8. ADMIN_PASSWORD
9. ADMIN_NAME

## One-time data migration from existing JSON

If you want to carry old local data into Supabase:

1. Confirm supabase/schema.sql already executed.
2. Confirm env vars are loaded.
3. Run:

   npm run migrate:data

This reads:

1. data/users.json
2. data/listings.json
3. data/reservations.json

And inserts them into Supabase tables.

## Deploy to Vercel

1. Push project to GitHub.
2. Import repository in Vercel.
3. Add all environment variables in Vercel Project Settings.
4. Deploy.
5. Verify these routes in production:

   1. / (index page)
   2. /login.html
   3. /signup.html
   4. /booking.html?listingId=1
   5. /payment.html?reservationId=1
   6. /my-bookings.html
   7. /api/health

## API endpoints

1. GET /api/health
2. GET /api/auth/me
3. POST /api/auth/register
4. POST /api/auth/login
5. POST /api/auth/logout
6. GET /api/listings
7. GET /api/listings/:id
8. GET /api/listings/:id/availability?date=YYYY-MM-DD
9. POST /api/listings (admin)
10. DELETE /api/listings/:id (admin)
11. POST /api/reservations
12. GET /api/reservations
13. GET /api/reservations/:id
14. POST /api/reservations/:id/receipt
15. GET /api/admin/reservations (admin)
16. POST /api/admin/reservations/:id/approve (admin)

## Notes

1. Default admin account is auto-created on first API start if missing.
2. Session data uses Postgres when DATABASE_URL exists; otherwise memory fallback is used.
3. Uploads are stored in Supabase Storage and returned as public URLs.
