---
Task ID: 1
Agent: Main Agent
Task: Stabilize Evolution Go, implement parallel chips, fix chip duplicates, improve reconnection

Work Log:
- Analyzed full codebase: sending-engine.ts (v5.0 already has parallel chip architecture), process/route.ts, webhook/route.ts, chips/route.ts, process-all/route.ts
- Found root cause of "only 1 chip sends" bug: process route breaks loop on chip-specific issues AND waits full per-chip delay
- Found root cause of chip duplicate bug: webhook ignores events when chip has no evolutionInstance; auto-import creates new chip instead of linking existing
- Fixed process/route.ts: changed to time-based while loop, don't break on chip-specific issues, don't wait per-chip delay after successful send (just 1-3s stagger)
- Fixed webhook/route.ts: auto-link chips by phone number when evolutionInstance not found
- Fixed chips/route.ts (GET): link existing unlinked chips by phone before creating duplicates
- Fixed process-all/route.ts: always run health check on every tick (not just when queue empty)
- Build succeeded after changes
- Docker memory limit already applied via `docker update`

Stage Summary:
- 4 files modified: process/route.ts, webhook/route.ts, chips/route.ts, process-all/route.ts
- Critical fixes: parallel chip sending, chip duplicate prevention, instant disconnection detection
- Evolution Go memory already increased to 1g (docker update)
- Need user to: find evolution-go docker-compose for persistent memory, enable WireGuard on boot, rebuild app
