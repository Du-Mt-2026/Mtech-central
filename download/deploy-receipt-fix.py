#!/usr/bin/env python3
"""
Deploy Receipt Event Handler + Webhook Event Fix to VPS
========================================================
Patches the webhook handler and evolution-api.ts on the VPS:

1. Adds 'Receipt' case to webhook/route.ts (Evolution Go delivery tracking)
2. Adds 'RECEIPT' to DEFAULT_SUBSCRIBE_EVENTS in evolution-api.ts
3. Adds 'RECEIPT' to setWebhook() events in evolution-api.ts
4. Rebuilds the app
5. Reconfigures webhooks for all connected chips

Usage: python3 deploy-receipt-fix.py
"""

import subprocess
import sys
import time

VPS_HOST = "45.77.112.119"
VPS_USER = "root"
APP_PATH = "/opt/octupuszap"

def run_ssh(cmd, timeout=60):
    """Run command on VPS via SSH"""
    full_cmd = f"ssh {VPS_USER}@{VPS_HOST} {cmd}"
    print(f"  → Running: {cmd[:100]}...")
    try:
        result = subprocess.run(
            full_cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return result.stdout.strip(), result.stderr.strip(), result.returncode
    except subprocess.TimeoutExpired:
        return "", "TIMEOUT", -1

def main():
    print("\n🚀 Deploying Receipt Event Handler to VPS")
    print("=" * 50)

    # Step 1: Add 'RECEIPT' to DEFAULT_SUBSCRIBE_EVENTS
    print("\n[1/5] Adding RECEIPT to DEFAULT_SUBSCRIBE_EVENTS...")
    stdout, stderr, rc = run_ssh(f"""cd {APP_PATH} && python3 -c "
with open('src/lib/evolution-api.ts', 'r') as f:
    content = f.read()

# Add RECEIPT after READ_RECEIPT in DEFAULT_SUBSCRIBE_EVENTS
if \"'READ_RECEIPT',\\n    'RECEIPT',\" not in content:
    content = content.replace(
        \"'READ_RECEIPT',\\n    'PRESENCE',\",
        \"'READ_RECEIPT',\\n    'RECEIPT',\\n    'PRESENCE',\"
    )
    print('  ✓ Added RECEIPT to DEFAULT_SUBSCRIBE_EVENTS')
else:
    print('  ⚠ RECEIPT already in DEFAULT_SUBSCRIBE_EVENTS')

# Also add to setWebhook events
if \"'READ_RECEIPT',\\n    'RECEIPT',\\n    'PRESENCE',\" in content:
    # Count occurrences - should be in both places
    count = content.count(\"'RECEIPT',\")
    print(f'  ✓ RECEIPT appears {count} times in file')
else:
    # setWebhook might not have it yet
    # Find the second occurrence of READ_RECEIPT and add RECEIPT after it
    parts = content.split(\"'READ_RECEIPT',\", 2)
    if len(parts) >= 3:
        # Second occurrence - add RECEIPT after it
        if \"'RECEIPT',\" not in parts[2][:50]:
            content = parts[0] + \"'READ_RECEIPT',\" + parts[1] + \"'READ_RECEIPT',\\n    'RECEIPT',\" + parts[2]
            print('  ✓ Added RECEIPT to setWebhook events')

with open('src/lib/evolution-api.ts', 'w') as f:
    f.write(content)
print('  ✓ File saved')
" """)
    print(stdout)
    if stderr and "Error" in stderr:
        print(f"  ⚠ {stderr}")

    # Step 2: Add Receipt case to webhook handler
    print("\n[2/5] Adding Receipt case to webhook/route.ts...")
    
    # The Receipt handler code to inject
    receipt_handler = r'''
      // ===== Receipt Event (Evolution Go format) =====
      // Evolution Go (Go version) sends "Receipt" events instead of
      // "SEND_MESSAGE_ACK" / "READ_RECEIPT" (which are Evolution API v3 Node.js format).
      // The Receipt event contains the same ack-based status tracking:
      //   ack 3 = DELIVERED (double tick), ack 4 = READ (blue ticks)
      case 'Receipt': {
        try {
          const msgId = data?.Info?.ID || data?.key?.id || data?.id || null
          const ackValue = data?.Info?.Status ?? data?.Status ?? data?.ack ?? data?.info?.status ?? null

          if (!msgId) break

          const ack = ackValue !== null && ackValue !== undefined ? Number(ackValue) : null
          const STATUS_ORDER: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: -1 }
          const ackToStatus = (a: number): string => a >= 4 ? 'read' : a >= 3 ? 'delivered' : a >= 1 ? 'sent' : 'pending'

          if (ack !== null) {
            const candidateStatus = ackToStatus(ack)

            // === Update Campaign Message (Message table) ===
            const message = await db.message.findFirst({
              where: { evolutionMessageId: msgId },
            })

            if (message) {
              let newStatus = message.status
              let deliveredAt = message.deliveredAt
              let readAt = message.readAt

              if (ack >= 4 && message.status !== 'read') {
                newStatus = 'read'
                deliveredAt = deliveredAt || new Date()
                readAt = new Date()
              } else if (ack >= 3 && message.status !== 'read' && message.status !== 'delivered') {
                newStatus = 'delivered'
                deliveredAt = new Date()
              }

              if (newStatus !== message.status) {
                await db.message.update({
                  where: { id: message.id },
                  data: { status: newStatus, deliveredAt, readAt },
                })
                console.log(`[Webhook] Receipt: Campaign Message ${msgId} → ${newStatus} (ack=${ack})`)
              }

              try {
                broadcastToChip(message.chipId, 'status_update', {
                  messageId: msgId, status: newStatus, ack, timestamp: Date.now(),
                })
              } catch { /* non-critical */ }
            }

            // === Update InboxMessage ===
            try {
              const inboxMsg = await db.inboxMessage.findUnique({
                where: { evolutionMsgId: msgId },
              })
              if (inboxMsg && (STATUS_ORDER[candidateStatus] ?? 0) > (STATUS_ORDER[inboxMsg.status] ?? 0)) {
                await db.inboxMessage.update({
                  where: { id: inboxMsg.id },
                  data: {
                    ack,
                    status: candidateStatus,
                    ...(candidateStatus === 'delivered' || candidateStatus === 'read' ? { deliveredAt: inboxMsg.deliveredAt || new Date() } : {}),
                    ...(candidateStatus === 'read' ? { readAt: new Date() } : {}),
                  },
                })
                console.log(`[Webhook] Receipt: InboxMessage ${msgId} → ${candidateStatus} (ack=${ack})`)
                try {
                  broadcastToChip(inboxMsg.chipId || '', 'status_update', {
                    messageId: msgId, status: candidateStatus, ack, timestamp: Date.now(),
                  })
                } catch { /* non-critical */ }
              }
            } catch (inboxErr: any) {
              console.error('[Webhook] Receipt: Error updating inbox message:', inboxErr.message)
            }
          }
        } catch (err: any) {
          console.error('[Webhook] Error processing Receipt:', err.message)
        }
        break
      }
'''

    # Write the handler to a temp file on the VPS, then inject it
    # We need to insert it before "case 'Message':"
    stdout, stderr, rc = run_ssh(f"""cd {APP_PATH} && python3 << 'PYEOF'
with open('src/app/api/whatsapp/webhook/route.ts', 'r') as f:
    content = f.read()

# Check if Receipt handler already exists
if "case 'Receipt':" in content:
    print('  ⚠ Receipt handler already exists in webhook')
else:
    # Insert before the Message case
    receipt_code = '''      // ===== Receipt Event (Evolution Go format) =====
      // Evolution Go (Go version) sends "Receipt" events for delivery tracking.
      // ack 3 = DELIVERED (double tick), ack 4 = READ (blue ticks)
      case 'Receipt': {
        try {
          const msgId = data?.Info?.ID || data?.key?.id || data?.id || null
          const ackValue = data?.Info?.Status ?? data?.Status ?? data?.ack ?? data?.info?.status ?? null

          if (!msgId) break

          const ack = ackValue !== null && ackValue !== undefined ? Number(ackValue) : null
          const STATUS_ORDER: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: -1 }
          const ackToStatus = (a: number): string => a >= 4 ? 'read' : a >= 3 ? 'delivered' : a >= 1 ? 'sent' : 'pending'

          if (ack !== null) {
            const candidateStatus = ackToStatus(ack)

            // === Update Campaign Message ===
            const message = await db.message.findFirst({ where: { evolutionMessageId: msgId } })
            if (message) {
              let newStatus = message.status
              let deliveredAt = message.deliveredAt
              let readAt = message.readAt

              if (ack >= 4 && message.status !== 'read') { newStatus = 'read'; deliveredAt = deliveredAt || new Date(); readAt = new Date() }
              else if (ack >= 3 && message.status !== 'read' && message.status !== 'delivered') { newStatus = 'delivered'; deliveredAt = new Date() }

              if (newStatus !== message.status) {
                await db.message.update({ where: { id: message.id }, data: { status: newStatus, deliveredAt, readAt } })
                console.log(\`[Webhook] Receipt: Campaign Message \${msgId} → \${newStatus} (ack=\${ack})\`)
              }

              try { broadcastToChip(message.chipId, 'status_update', { messageId: msgId, status: newStatus, ack, timestamp: Date.now() }) } catch {}
            }

            // === Update InboxMessage ===
            try {
              const inboxMsg = await db.inboxMessage.findUnique({ where: { evolutionMsgId: msgId } })
              if (inboxMsg && (STATUS_ORDER[candidateStatus] ?? 0) > (STATUS_ORDER[inboxMsg.status] ?? 0)) {
                await db.inboxMessage.update({
                  where: { id: inboxMsg.id },
                  data: {
                    ack, status: candidateStatus,
                    ...(candidateStatus === 'delivered' || candidateStatus === 'read' ? { deliveredAt: inboxMsg.deliveredAt || new Date() } : {}),
                    ...(candidateStatus === 'read' ? { readAt: new Date() } : {}),
                  },
                })
                console.log(\`[Webhook] Receipt: InboxMessage \${msgId} → \${candidateStatus} (ack=\${ack})\`)
                try { broadcastToChip(inboxMsg.chipId || '', 'status_update', { messageId: msgId, status: candidateStatus, ack, timestamp: Date.now() }) } catch {}
              }
            } catch (inboxErr: any) { console.error('[Webhook] Receipt inbox error:', inboxErr.message) }
          }
        } catch (err: any) { console.error('[Webhook] Error processing Receipt:', err.message) }
        break
      }

'''
    
    # Find the Message case and insert before it
    marker = "      // ===== Incoming/Outgoing Messages =====\n      case 'Message': {"
    if marker in content:
        content = content.replace(marker, receipt_code + marker)
        print('  ✓ Added Receipt handler to webhook')
    else:
        # Try alternate marker
        marker2 = "      case 'Message': {"
        if marker2 in content:
            content = content.replace(marker2, receipt_code + "\n      case 'Message': {")
            print('  ✓ Added Receipt handler to webhook (alternate marker)')
        else:
            print('  ❌ Could not find Message case in webhook handler')
    
    with open('src/app/api/whatsapp/webhook/route.ts', 'w') as f:
        f.write(content)
    print('  ✓ File saved')
PYEOF
""")
    print(stdout)
    if stderr and "Error" in stderr:
        print(f"  ⚠ {stderr}")

    # Step 3: Rebuild app
    print("\n[3/5] Rebuilding app...")
    stdout, stderr, rc = run_ssh(f"cd {APP_PATH} && docker compose up -d --build app", timeout=300)
    print(f"  Build exit code: {rc}")
    if rc == 0:
        print("  ✓ App rebuilt and restarted")
    else:
        print(f"  ⚠ Build may have issues")
        print(stderr[:500] if stderr else "")

    # Step 4: Wait for app to be ready
    print("\n[4/5] Waiting for app to be ready...")
    time.sleep(10)
    stdout, stderr, rc = run_ssh("docker exec octupuszap-app wget -qO- --timeout=5 http://localhost:3000/api/auth/session 2>/dev/null | head -c 50")
    if stdout:
        print("  ✓ App is responding")
    else:
        print("  ⚠ App may not be ready yet")

    # Step 5: Reconfigure webhooks using curl from the host
    print("\n[5/5] Reconfiguring webhooks for all chips...")
    
    # Get CRON_SECRET for the health check endpoint
    stdout, stderr, rc = run_ssh("docker exec octupuszap-app printenv CRON_SECRET 2>/dev/null")
    cron_secret = stdout.strip()
    
    # Use curl from the host to call the health check
    # This also fixes missing webhooks
    if cron_secret:
        stdout, stderr, rc = run_ssh(f"curl -s -X POST http://localhost:3000/api/cron/health-check -H 'Authorization: Bearer {cron_secret}' | python3 -m json.tool 2>/dev/null | head -30")
    else:
        stdout, stderr, rc = run_ssh("curl -s -X POST http://localhost:3000/api/cron/health-check | python3 -m json.tool 2>/dev/null | head -30")
    
    print(stdout if stdout else "  (no output from health check)")

    # Also reconfigure webhooks individually using curl
    print("\n  Reconfiguring individual chip webhooks...")
    stdout, stderr, rc = run_ssh(f"""cd {APP_PATH} && python3 << 'PYEOF'
import subprocess, json

# Get chips
result = subprocess.run(['docker', 'exec', 'octupuszap-db', 'psql', '-U', 'octupuszap', '-d', 'octupuszap', '-t', '-c',
    'SELECT id, name, "evolutionInstance", status FROM "Chip" WHERE "evolutionInstance" IS NOT NULL'],
    capture_output=True, text=True)

for line in result.stdout.strip().split('\\n'):
    parts = [p.strip() for p in line.split('|')]
    if len(parts) >= 3 and parts[2]:
        chip_id = parts[0]
        chip_name = parts[1]
        status = parts[3] if len(parts) > 3 else ''
        
        # Use curl from the host
        result2 = subprocess.run(
            ['curl', '-s', '-X', 'POST', 'http://localhost:3000/api/whatsapp/setup-webhook',
             '-H', 'Content-Type: application/json',
             '-d', json.dumps({'chipId': chip_id})],
            capture_output=True, text=True, timeout=15
        )
        
        if 'success' in result2.stdout:
            print(f'  ✓ {chip_name} ({status})')
        else:
            print(f'  ✗ {chip_name}: {result2.stdout[:80]}')
PYEOF
""")
    print(stdout if stdout else "  (no output)")

    print("\n" + "=" * 50)
    print("✅ Receipt event handler deployed!")
    print()
    print("To verify, send a test message and watch logs:")
    print(f"  ssh {VPS_USER}@{VPS_HOST} 'cd {APP_PATH} && docker compose logs -f app 2>&1 | grep -i Receipt'")
    print()

if __name__ == "__main__":
    main()
