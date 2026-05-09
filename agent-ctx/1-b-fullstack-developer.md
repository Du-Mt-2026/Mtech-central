# Task 1-b: Authentication + Pause/Resume Campaign + Campaign Scheduling

## Work Summary

### 1. Authentication System
- Added `AdminUser` model to Prisma schema (id, username @unique, password bcrypt, timestamps)
- Pushed schema changes to Neon PostgreSQL
- Created `/src/lib/auth.ts` — auth utility with:
  - JWT creation/verification using `jose` library (HS256, 7-day expiry)
  - Password hashing with `bcryptjs`
  - Session cookie management (httpOnly, secure in production, sameSite lax)
  - `getSession()` helper for server-side session retrieval
- Created `/src/app/api/auth/login/route.ts`:
  - POST: validates username/password against AdminUser table
  - Auto-creates admin on first login attempt using ADMIN_USERNAME/ADMIN_PASSWORD env vars (defaults: admin/admin123)
  - Returns JWT as httpOnly cookie
- Created `/src/app/api/auth/session/route.ts`:
  - GET: returns current session info (authenticated true/false + user details)
- Created `/src/app/api/auth/logout/route.ts`:
  - POST: clears the session cookie (maxAge: 0)
- Created `/src/middleware.ts`:
  - Checks for auth cookie on all `/api/*` routes EXCEPT `/api/auth/*`
  - Verifies JWT token validity
  - Returns 401 for unauthenticated or expired sessions

### 2. Pause/Resume Campaign
- Modified `/src/app/api/campaigns/[campaignId]/route.ts` PATCH handler:
  - Added status transition validation (VALID_TRANSITIONS map)
  - `draft` → `scheduled` (requires scheduledAt)
  - `draft`/`scheduled` → `running` (calls startCampaign)
  - `running` → `paused`
  - `paused` → `running` (resume)
  - Any → `cancelled` (marks pending messages as failed)
  - Added ALLOWED_FIELDS whitelist for non-status updates
- Created `/src/app/api/campaigns/[campaignId]/pause/route.ts`:
  - POST: pauses a running campaign (validates status is 'running')
- Created `/src/app/api/campaigns/[campaignId]/resume/route.ts`:
  - POST: resumes a paused campaign (validates status is 'paused')
- Modified `/src/lib/sending-engine.ts`:
  - Added paused campaign check at start of `processNextMessage()`
  - If campaign status is 'paused', returns immediately without processing

### 3. Campaign Scheduling — Auto-start
- Modified `/src/app/api/campaigns/process-all/route.ts`:
  - Added logic to check for scheduled campaigns whose `scheduledAt` ≤ now
  - Auto-starts each scheduled campaign via `startCampaign()`
  - Returns `startedScheduled` count and `startedCampaigns` details in response
  - Handles errors gracefully (logs but continues processing)

## Dependencies Installed
- `jose` — JWT creation/verification
- `bcryptjs` + `@types/bcryptjs` — password hashing

## Lint Status
- `bun run lint` passes clean with zero errors
