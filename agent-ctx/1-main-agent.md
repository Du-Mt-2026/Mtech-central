# Task: Implement 3 Features for OctupusZap (Mtech-central)

## Summary
All 3 features implemented successfully. Build passes.

## Feature 1: Login Error Message
- **route.ts** (`/src/app/api/auth/login/route.ts`): Complete rewrite with brute force protection (rate limiting by IP, 5 attempts / 5 min lockout), specific HTTP status codes (401 for wrong credentials, 429 for too many attempts, 503 for database errors, 500 for internal), and Portuguese error messages
- **page.tsx**: Added `loginError` and `loginErrorType` state variables, modified `handleLogin` to detect HTTP status codes, added colored error banner between CardDescription and form inputs (rose for credentials/internal, amber for locked, sky for database), clears error on input change

## Feature 2: Edit Campaign
- **page.tsx**: Added `editing`, `saving`, `editForm` state variables in CampanhasTab
- Added "Editar" button in detail dialog header (only shown for draft/paused/scheduled campaigns)
- Edit form includes: campaign name, send intervals, contact list, scheduling, chip selection, steps with variations and media, anti-ban settings
- Save via PATCH `/api/campaigns/[id]` with full step/chip replacement
- Cancel and Save buttons in edit mode
- Dialog resets editing state on close

## Feature 3: DDD 55 Phone Normalization
- **phone-utils.ts** already existed with correct `normalizePhone()` implementation
- **evolution-api.ts**: `formatPhoneNumber()` now delegates to `normalizePhone()` instead of buggy prefix-based logic
- **verifier/check/route.ts**: Uses `normalizePhone()` for phone formatting
- **verificar-section.tsx**: Uses `normalizePhone()` and `formatPhoneDisplay()` from phone-utils
- **contacts/route.ts**: Normalizes phone on create
- **contacts/[id]/route.ts**: Normalizes phone on update
- **contact-lists/[id]/contacts/route.ts**: Normalizes phone on add
- **contact-lists/[id]/import/route.ts**: Normalizes phone on import
- **sending-engine.ts**: Uses `formattedPhone` (via `formatPhoneNumber` → `normalizePhone`) for `setPresence` instead of raw phone

## Build Status
✅ `npx next build` passes successfully
✅ ESLint passes for all changed backend files
