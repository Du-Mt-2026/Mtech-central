---
Task ID: 1
Agent: Main Agent
Task: Fix parallel chip sending in campaigns — bugs in sending-engine.ts causing messages to get stuck and blocking multi-chip campaigns

Work Log:
- Analyzed the full sending-engine.ts (3400+ lines), process/route.ts, process-all/route.ts, execute/route.ts
- Discovered v5.0 parallel chip support was already implemented (per-chip nextSendAt, chipReadyFilter)
- Found 5 critical bugs causing messages to get stuck in 'sending' status, blocking parallel chip operation
- Fixed all bugs and added skipContactIds mechanism for step_delay handling

Bug Fixes:
1. **step_delay doesn't release message claim** — Message stayed in 'sending' for 5 minutes, blocking that chip's messages. Fixed by releasing claim back to 'pending'.
2. **waiting_for_sending_step doesn't release claim** — Same issue. Fixed.
3. **waiting_for_previous_step doesn't release claim** — Same issue. Fixed.
4. **previous step failed doesn't update current message** — updateMany targeted only 'pending' status but current message was 'sending'. Fixed by updating the current message first, then remaining pending ones.
5. **whatsapp_warning_detected doesn't release claim** — Campaign paused but message left in 'sending'. Fixed by releasing claim before pausing.

New Feature:
6. **skipContactIds mechanism** — When a step_delay is detected, the contact is added to a skip set. Subsequent processNextMessage calls exclude these contacts from the query, allowing OTHER chips/contacts to be processed instead of being blocked by the same delayed message repeatedly.

7. **Step delay no longer blocks the loop** — Changed process/route.ts to use short stagger (0.5-1.5s) instead of waiting the full step delay. Other contacts/chips can send while waiting for step delays.

Stage Summary:
- All 5 claim-release bugs fixed in sending-engine.ts
- skipContactIds parameter added to processNextMessage
- All 3 callers updated (process/route.ts, process-all/route.ts, execute/route.ts)
- TypeScript compiles without errors
- Parallel chip sending should now work correctly: Chip A sends → goes to cooldown → Chip B sends immediately → both operate independently
