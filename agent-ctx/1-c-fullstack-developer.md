# Task 1-c: Full-Stack Developer Work Record

## Task: Media sending API + Inbox API + Edit/Delete contacts + Edit templates + Resend failed messages

### Work Completed:

1. **Prisma Schema Changes**:
   - Added `mediaUrl` (String?) and `mediatype` (String?) to `SequenceStep` model
   - Added `mediaUrl` (String?) and `mediatype` (String?) to `Message` model
   - Added `InboxMessage` model (id, instanceName, remoteJid, fromMe, messageContent, messageType, pushName, evolutionMsgId @unique, createdAt)
   - Ran `db:push` successfully — all tables and columns created in Neon PostgreSQL

2. **Media Sending API** (`/api/whatsapp/send-media/route.ts`):
   - POST endpoint accepting FormData with instanceName, number, mediatype, media (File), caption (optional), delay (optional)
   - Converts uploaded file to base64 data URI (`data:{mimetype};base64,{base64data}`)
   - Calls `sendMediaMessage()` from evolution-api
   - Validates mediatype is one of: image, document, video, audio

3. **Sending Engine Media Support** (`/src/lib/sending-engine.ts`):
   - Imported `sendMediaMessage` from evolution-api
   - `startCampaign()`: now copies `mediaUrl` and `mediatype` from first SequenceStep to each Message
   - `processNextMessage()`: if message has `mediaUrl` and `mediatype`, uses `sendMediaMessage` with content as caption; otherwise falls back to `sendTextMessage`

4. **Webhook Inbox Storage** (`/api/whatsapp/webhook/route.ts`):
   - `MESSAGES_UPSERT` handler now saves incoming messages to `InboxMessage` table
   - Extracts content from various message types: text, extendedText, image (caption), video (caption), audio, document (caption), sticker, contact, location
   - Uses `upsert` with `evolutionMsgId` as unique key to prevent duplicates
   - Only saves messages where `fromMe` is false (incoming)

5. **Inbox API** (`/api/inbox/route.ts`):
   - GET: paginated inbox messages ordered by createdAt desc
   - Query params: page (default 1), limit (default 50), instanceName (filter), search (insensitive text search on messageContent or pushName)
   - Returns messages, total, page, limit, totalPages

6. **Contacts [id] API** (`/api/contacts/[id]/route.ts`):
   - GET: single contact with contactList and chip relations
   - PATCH: update name and/or phone (whitelist validation, unique constraint handling)
   - DELETE: delete contact with associated messages

7. **Templates [id] API** (`/api/templates/[id]/route.ts`):
   - PATCH: update name, content, and/or category (whitelist validation)
   - DELETE: delete template

8. **Resend Failed Message** (`/api/messages/[id]/resend/route.ts`):
   - POST: resets a single failed message to pending, clears error and sentAt

9. **Resend All Failed** (`/api/messages/resend-all-failed/route.ts`):
   - POST: resets all failed messages to pending, optionally filtered by campaignId

### Lint: passes clean with zero errors
