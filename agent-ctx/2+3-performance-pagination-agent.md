# Task 2+3: N+1 Query Fix & Pagination

## Summary
Fixed performance and pagination issues in the campaigns and messages APIs.

## Changes Made

### 1. N+1 Query Fix — `src/app/api/campaigns/route.ts`
- **Before**: Used `Promise.all(campaigns.map(async c => db.message.groupBy(...)))` — 1 + N queries
- **After**: Single `db.message.groupBy({ by: ['campaignId', 'status'] })` query, then builds a `statusMap` lookup. Now only 2 queries total.

### 2. Pagination — Campaigns API
- Added `page` and `limit` query params (defaults: page=1, limit=50, max=200)
- When `page` param present: returns `{ data: [...], pagination: { page, limit, total, totalPages } }`
- When `page` absent: returns plain array (backward compatible)
- Uses `db.campaign.count()` for total when paginated

### 3. Pagination — Messages API  
- Same approach: `page`/`limit` params with backward compatibility
- Preserves existing filters: `campaignId`, `chipId`, `status`
- Paginated: `{ data, pagination }`; non-paginated: plain array with `take: 200`

### 4. Error Response Fix — Both APIs
- **Before**: `NextResponse.json([], { status: 500 })` — empty array masks errors
- **After**: `NextResponse.json({ error: 'Erro ao buscar campanhas/mensagens' }, { status: 500 })`

## Files Modified
- `src/app/api/campaigns/route.ts`
- `src/app/api/messages/route.ts`
