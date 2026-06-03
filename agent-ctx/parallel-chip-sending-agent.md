# Parallel Chip Sending Engine Refactor (v5.0)

## Task
Modify the OctupusZap sending engine to support PARALLEL chip sending within a campaign. Previously only one chip could send at a time because of a campaign-level lock.

## Changes Made

### 1. `/home/z/my-project/src/lib/sending-engine.ts`

#### a) Removed campaign-level atomic slot claim (old lines 1722-1785)
- **Before**: `processNextMessage` used an atomic `UPDATE ... WHERE nextSendAt IS NULL OR < NOW()` to claim a campaign-level slot. This blocked ALL chips in the campaign until the slot expired.
- **After**: Removed entirely. Replaced with a comment block explaining the new v5.0 parallel architecture.

#### b) Changed message selection to filter for ready chips (old lines 1845-1849)
- **Before**: `db.message.findFirst({ where: { campaignId, status: 'pending' }, orderBy: { id: 'asc' } })` — picked the earliest pending message regardless of chip readiness.
- **After**: Added `chipReadyFilter` that checks:
  - `chip.status = 'connected'`
  - `chip.evolutionInstance IS NOT NULL`
  - `chip.nextSendAt IS NULL OR < NOW()` (when anti-ban enabled)
  - `chip.cooldownUntil IS NULL OR < NOW()` (when anti-ban enabled)
- Messages whose chips are NOT ready are skipped, allowing other chips' messages to be processed.

#### c) Added "no_ready_chip" handling
- When `earliestPending` is null but pending messages exist, the function now distinguishes between:
  - **No pending messages at all** → campaign completion logic (existing)
  - **Pending messages exist but no chips ready** → returns `{ reason: 'no_ready_chip' }` with a 1-minute campaign.nextSendAt throttle
- This prevents the DB from being hammered while all chips are in cooldown/interval.

#### d) Removed campaign.nextSendAt from chip-specific checks
All chip-specific blockers now release the message claim (set status back to 'pending') and return without blocking the campaign:
- **Hourly limit** (line ~2257): Releases claim, returns `hourly_limit_{chipName}`
- **Chip interval wait** (line ~2273): Releases claim, returns `chip_interval_wait_{chipName}`
- **Daily limit - reassigned** (line ~2330): Releases claim after reassignment, no campaign.nextSendAt
- **Daily limit - stuck** (line ~2340): Releases claim, returns `daily_limit_{chipName}`, no campaign.nextSendAt
- **Cooldown** (line ~2386): Releases claim, returns `cooldown_{chipName}`, no campaign.nextSendAt

#### e) Removed campaign.nextSendAt from after-send persistence (old lines 2903-2922)
- **Before**: Both `chip.nextSendAt` AND `campaign.nextSendAt` were set after each send.
- **After**: Only `chip.nextSendAt` is set. Campaign.nextSendAt is NOT updated, allowing other chips to send independently.

#### f) Removed campaign.nextSendAt from error handling (old lines 3052-3060)
- **Before**: On error, `campaign.nextSendAt` was set to the retry delay, blocking all chips.
- **After**: No campaign.nextSendAt update on error. Other chips can continue sending.

#### g) Kept campaign.nextSendAt for campaign-level state only
- **Sending window check**: Sets `campaign.nextSendAt` to 1 minute (avoid re-checking too often)
- **Break window check**: Sets `campaign.nextSendAt` until break ends
- **No ready chip**: Sets `campaign.nextSendAt` to 1 minute (throttle)
- **Campaign completion/pause**: Sets `campaign.nextSendAt` to null

#### h) Updated comments
- Updated `releaseStaleCampaignSlots` documentation to reflect v5.0 architecture
- Updated inline comments to reference "v5.0" and explain the parallel behavior

### 2. `/home/z/my-project/src/app/api/campaigns/process-all/route.ts`

- **Before**: Called `processNextMessage(campaignId)` ONCE per campaign per cron tick.
- **After**: Loops within each campaign, calling `processNextMessage` multiple times until:
  - A message is successfully processed (continue loop)
  - Campaign is completed (break)
  - Campaign is paused (break)
  - Outside sending window (break)
  - In a break window (break)
  - No ready chips (`no_ready_chip`) (break)
  - 3 consecutive chip-specific skips (break — safety limit)
  - Function timeout approaching (break — 5s margin)
- This allows multiple chips in the same campaign to send in one cron tick.

## Key Design Decisions

1. **Message claim release on chip-specific blocks**: When a chip-specific issue (hourly limit, cooldown, interval) is detected after claiming a message, the claim is released (status set back to 'pending'). This prevents messages from being stuck in 'sending' status.

2. **Consecutive skip limit**: The process-all loop stops after 3 consecutive chip-specific skips. This prevents infinite loops when all chips are busy, while still allowing a few retries to find a ready chip.

3. **Campaign.nextSendAt throttling for no_ready_chip**: When all chips are in cooldown/interval, a 1-minute campaign.nextSendAt is set to prevent the DB from being queried every few milliseconds.

4. **chipReadyFilter includes cooldownUntil**: The message selection query filters for chips where `cooldownUntil IS NULL OR < NOW()`, preventing messages from being selected for chips that are in cooldown. This is separate from `nextSendAt` which tracks the inter-message interval.

## Preserved Behaviors

- Anti-ban intervals per chip (each chip has its own safe interval via `chip.nextSendAt`)
- Message creation (round-robin assignment at start)
- `@@unique([campaignId, contactId, stepOrder])` constraint protection
- All safety checks (ban detection, daily limits, hourly limits, warming)
- Disconnected/banned chip message reassignment to other campaign chips
- Deduplication check
- Campaign auto-pause only when ALL chips are unavailable
- Contact-by-contact processing order (when chips are ready)
- Stuck message recovery (5-minute threshold)
- Stale campaign slot release (10-minute threshold)
