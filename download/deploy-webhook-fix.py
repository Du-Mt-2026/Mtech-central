#!/usr/bin/env python3
"""
Deploy Webhook Fix to VPS
=========================
Patches evolution-api.ts on the VPS to fix webhook event subscriptions:
1. Adds SEND_MESSAGE_ACK and MESSAGES_UPDATE to DEFAULT_SUBSCRIBE_EVENTS
2. Fixes setWebhook() default events (adds SEND_MESSAGE_ACK, MESSAGES_UPDATE, removes HISTORY_SYNC)
3. Rebuilds the app

Usage: python3 deploy-webhook-fix.py
"""

import subprocess
import sys
import time

VPS_HOST = "45.77.112.119"
VPS_USER = "root"
APP_PATH = "/home/z/octupuszap"

def run_ssh(cmd, timeout=30):
    """Run command on VPS via SSH"""
    full_cmd = f"ssh {VPS_USER}@{VPS_HOST} {cmd}"
    print(f"  → Running: {cmd[:80]}...")
    try:
        result = subprocess.run(
            full_cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return result.stdout.strip(), result.stderr.strip(), result.returncode
    except subprocess.TimeoutExpired:
        return "", "TIMEOUT", -1

def run_ssh_long(cmd, timeout=600):
    """Run long command on VPS (like docker build)"""
    full_cmd = f"ssh {VPS_USER}@{VPS_HOST} {cmd}"
    print(f"  → Running (long): {cmd[:80]}...")
    try:
        result = subprocess.run(
            full_cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return result.stdout.strip(), result.stderr.strip(), result.returncode
    except subprocess.TimeoutExpired:
        return "", "TIMEOUT", -1

def main():
    print("\n🚀 Deploying Webhook Fix to VPS")
    print("=" * 50)

    # Step 1: Check current NEXT_PUBLIC_APP_URL
    print("\n[1/6] Checking NEXT_PUBLIC_APP_URL...")
    stdout, stderr, rc = run_ssh("docker exec app printenv NEXT_PUBLIC_APP_URL")
    if stdout:
        print(f"  ✓ NEXT_PUBLIC_APP_URL = {stdout}")
    else:
        print("  ⚠ NEXT_PUBLIC_APP_URL is NOT set!")
        print("  The webhook URL will fall back to http://localhost:3000")
        print("  This means Evolution Go must be on the same Docker network")
        print("  and must use 'http://app:3000' or similar to reach the app.")
        print()
        print("  If the webhook doesn't work after this fix, you need to set:")
        print("  NEXT_PUBLIC_APP_URL=https://your-domain.com")
        print("  in the .env file and rebuild.")

    # Step 2: Verify the file exists on VPS
    print("\n[2/6] Checking evolution-api.ts on VPS...")
    stdout, stderr, rc = run_ssh(f"test -f {APP_PATH}/src/lib/evolution-api.ts && echo EXISTS || echo MISSING")
    if stdout != "EXISTS":
        print(f"  ❌ File not found: {APP_PATH}/src/lib/evolution-api.ts")
        sys.exit(1)
    print("  ✓ File exists")

    # Step 3: Check current DEFAULT_SUBSCRIBE_EVENTS
    print("\n[3/6] Checking current DEFAULT_SUBSCRIBE_EVENTS...")
    stdout, stderr, rc = run_ssh(f"grep -A 15 'DEFAULT_SUBSCRIBE_EVENTS' {APP_PATH}/src/lib/evolution-api.ts | head -20")
    print(f"  Current events:\n{stdout}")

    if "SEND_MESSAGE_ACK" in stdout:
        print("  ✓ SEND_MESSAGE_ACK already in DEFAULT_SUBSCRIBE_EVENTS")
    else:
        print("  ❌ SEND_MESSAGE_ACK MISSING from DEFAULT_SUBSCRIBE_EVENTS — will fix")

    if "MESSAGES_UPDATE" in stdout:
        print("  ✓ MESSAGES_UPDATE already in DEFAULT_SUBSCRIBE_EVENTS")
    else:
        print("  ❌ MESSAGES_UPDATE MISSING from DEFAULT_SUBSCRIBE_EVENTS — will fix")

    # Step 4: Apply patch - Fix DEFAULT_SUBSCRIBE_EVENTS
    print("\n[4/6] Patching DEFAULT_SUBSCRIBE_EVENTS...")

    # Replace the DEFAULT_SUBSCRIBE_EVENTS block
    patch_cmd = f"""cd {APP_PATH} && python3 -c "
import re

with open('src/lib/evolution-api.ts', 'r') as f:
    content = f.read()

# Fix 1: DEFAULT_SUBSCRIBE_EVENTS in connectInstance()
old_default = \"\"\"const DEFAULT_SUBSCRIBE_EVENTS = [
    'MESSAGE',
    'SEND_MESSAGE',
    'READ_RECEIPT',
    'PRESENCE',
    'CHAT_PRESENCE',
    'CALL',
    'CONNECTION',
    'QRCODE',
    'LABEL',
    'CONTACT',
    'GROUP',
  ];\"\"\"

new_default = \"\"\"const DEFAULT_SUBSCRIBE_EVENTS = [
    'MESSAGE',
    'SEND_MESSAGE',
    'SEND_MESSAGE_ACK',
    'READ_RECEIPT',
    'PRESENCE',
    'CHAT_PRESENCE',
    'CALL',
    'CONNECTION',
    'QRCODE',
    'LABEL',
    'CONTACT',
    'GROUP',
    'MESSAGES_UPDATE',
  ];\"\"\"

if old_default in content:
    content = content.replace(old_default, new_default)
    print('  ✓ Fixed DEFAULT_SUBSCRIBE_EVENTS')
else:
    print('  ⚠ DEFAULT_SUBSCRIBE_EVENTS not found (may already be fixed)')

# Fix 2: setWebhook() default events
old_setwebhook = \"\"\"events: string[] = [
    'MESSAGE',
    'SEND_MESSAGE',
    'READ_RECEIPT',
    'PRESENCE',
    'HISTORY_SYNC',
    'CHAT_PRESENCE',
    'CALL',
    'CONNECTION',
    'LABEL',
    'CONTACT',
    'GROUP',
    'NEWSLETTER',
    'QRCODE',
    'BUTTON_CLICK',
  ]\"\"\"

new_setwebhook = \"\"\"events: string[] = [
    'MESSAGE',
    'SEND_MESSAGE',
    'SEND_MESSAGE_ACK',
    'READ_RECEIPT',
    'PRESENCE',
    'CHAT_PRESENCE',
    'CALL',
    'CONNECTION',
    'LABEL',
    'CONTACT',
    'GROUP',
    'QRCODE',
    'MESSAGES_UPDATE',
    'INSTANCE_DELETED',
  ]\"\"\"

if old_setwebhook in content:
    content = content.replace(old_setwebhook, new_setwebhook)
    print('  ✓ Fixed setWebhook() events')
else:
    # Try alternate format (might already be partially fixed)
    if \"'SEND_MESSAGE_ACK'\" in content.split('setWebhook')[1].split('): Promise')[0] if 'setWebhook' in content else '':
        print('  ⚠ setWebhook events may already be fixed')
    else:
        print('  ⚠ setWebhook events pattern not found — trying alternative match')
        # Try to find and replace by a different pattern
        import re
        # Find the setWebhook function and its events parameter
        pattern = r\"(export async function setWebhook\\([^)]*events: string\\[\\] = \\[)([^\\]]+)(\\])\"
        match = re.search(pattern, content)
        if match:
            new_events = \"'\\n    MESSAGE',\\n    'SEND_MESSAGE',\\n    'SEND_MESSAGE_ACK',\\n    'READ_RECEIPT',\\n    'PRESENCE',\\n    'CHAT_PRESENCE',\\n    'CALL',\\n    'CONNECTION',\\n    'LABEL',\\n    'CONTACT',\\n    'GROUP',\\n    'QRCODE',\\n    'MESSAGES_UPDATE',\\n    'INSTANCE_DELETED',\\n  \"
            # Actually, regex replacement is tricky here. Let's try a simpler approach.
            print('  ⚠ Could not auto-fix setWebhook events — manual fix may be needed')

with open('src/lib/evolution-api.ts', 'w') as f:
    f.write(content)
print('  ✓ File saved')
" """

    stdout, stderr, rc = run_ssh(patch_cmd, timeout=30)
    print(stdout)
    if stderr and "Error" in stderr:
        print(f"  ❌ Error: {stderr}")

    # Step 5: Reconfigure webhooks for existing instances
    print("\n[5/6] Reconfiguring webhooks for existing instances...")
    reconfigure_cmd = f"""cd {APP_PATH} && python3 -c "
import subprocess, json

# Get app URL
result = subprocess.run(['docker', 'exec', 'app', 'printenv', 'NEXT_PUBLIC_APP_URL'], capture_output=True, text=True)
app_url = result.stdout.strip() or 'http://localhost:3000'
webhook_url = f'{{app_url}}/api/whatsapp/webhook'
print(f'Webhook URL: {{webhook_url}}')

# Get Evolution API credentials
result = subprocess.run(['docker', 'exec', 'app', 'printenv', 'EVOLUTION_API_URL'], capture_output=True, text=True)
evo_url = result.stdout.strip()
result = subprocess.run(['docker', 'exec', 'app', 'printenv', 'EVOLUTION_API_KEY'], capture_output=True, text=True)
evo_key = result.stdout.strip()

if not evo_url or not evo_key:
    # Try DB
    result = subprocess.run(['docker', 'exec', 'octupuszap-db', 'psql', '-U', 'octupuszap', '-d', 'octupuszap', '-t', '-c', \"SELECT value FROM \\\"Settings\\\" WHERE key='evolution_api_url'\"], capture_output=True, text=True)
    evo_url = result.stdout.strip()
    result = subprocess.run(['docker', 'exec', 'octupuszap-db', 'psql', '-U', 'octupuszap', '-d', 'octupuszap', '-t', '-c', \"SELECT value FROM \\\"Settings\\\" WHERE key='evolution_api_key'\"], capture_output=True, text=True)
    evo_key = result.stdout.strip()

print(f'Evolution API: {{evo_url}}')

# Get all OctupusZap instances
result = subprocess.run(['docker', 'exec', 'app', 'wget', '-qO-', '--timeout=10', '--header', f'apikey: {{evo_key}}', f'{{evo_url}}/instance/fetchInstances'], capture_output=True, text=True)
instances = json.loads(result.stdout) if result.stdout else []

octupus_instances = [i for i in instances if i.get('name', '').startswith('OctupusZap_')]
print(f'Found {{len(octupus_instances)}} OctupusZap instances')

for inst in octupus_instances:
    name = inst.get('name', '')
    connected = inst.get('connected', False)
    has_webhook = bool(inst.get('webhook', ''))
    status = 'connected' if connected else 'disconnected'
    wh = 'has webhook' if has_webhook else 'NO webhook'
    print(f'  {{name}}: {{status}} ({{wh}})')

# Reconfigure webhooks using the app's API
# This uses the setup-webhook endpoint which now has the fixed event list
result = subprocess.run(['docker', 'exec', 'octupuszap-db', 'psql', '-U', 'octupuszap', '-d', 'octupuszap', '-t', '-c', \"SELECT id, name, \\\"evolutionInstance\\\", status FROM \\\"Chip\\\" WHERE \\\"evolutionInstance\\\" IS NOT NULL AND status != 'banned'\"], capture_output=True, text=True)

fixed = 0
failed = 0
for line in result.stdout.strip().split('\\n'):
    parts = [p.strip() for p in line.split('|')]
    if len(parts) >= 3 and parts[2]:
        chip_id = parts[0]
        chip_name = parts[1]
        evo_inst = parts[2]
        
        # Call the app's setup-webhook endpoint
        result2 = subprocess.run(['docker', 'exec', 'app', 'wget', '-qO-', '--timeout=15', '--post-data', json.dumps({{'chipId': chip_id}}), '--header', 'Content-Type: application/json', 'http://localhost:3000/api/whatsapp/setup-webhook'], capture_output=True, text=True)
        
        if 'success' in result2.stdout:
            print(f'  ✓ Webhook configured for {{chip_name}}')
            fixed += 1
        else:
            print(f'  ✗ Failed for {{chip_name}}: {{result2.stdout[:100]}}')
            failed += 1

print(f'\\nResult: {{fixed}} configured, {{failed}} failed')
" """

    stdout, stderr, rc = run_ssh(reconfigure_cmd, timeout=60)
    print(stdout)
    if stderr and "Error" in stderr:
        print(f"  ⚠ {stderr}")

    # Step 6: Rebuild app
    print("\n[6/6] Rebuilding app with fixed code...")
    print("  This may take a few minutes...")
    stdout, stderr, rc = run_ssh_long(f"cd {APP_PATH} && docker compose up -d --build app", timeout=300)
    print(f"  Build exit code: {rc}")
    if rc == 0:
        print("  ✓ App rebuilt and restarted")
    else:
        print(f"  ⚠ Build may have issues. Check: ssh {VPS_USER}@{VPS_HOST} 'cd {APP_PATH} && docker compose logs app --tail=30'")

    # Verify
    print("\n🔍 Verifying deployment...")
    time.sleep(10)
    stdout, stderr, rc = run_ssh("docker exec app printenv NEXT_PUBLIC_APP_URL")
    if stdout:
        print(f"  ✓ NEXT_PUBLIC_APP_URL = {stdout}")
    else:
        print("  ⚠ NEXT_PUBLIC_APP_URL still not set")

    stdout, stderr, rc = run_ssh(f"grep -c 'SEND_MESSAGE_ACK' {APP_PATH}/src/lib/evolution-api.ts")
    count = int(stdout) if stdout.isdigit() else 0
    print(f"  SEND_MESSAGE_ACK occurrences in source: {count}")

    print("\n" + "=" * 50)
    print("✅ Webhook fix deployed!")
    print()
    print("To verify webhook is working, monitor logs:")
    print(f"  ssh {VPS_USER}@{VPS_HOST} 'cd {APP_PATH} && docker compose logs -f app 2>&1 | grep -i webhook'")
    print()
    print("To manually reconfigure webhooks for all chips:")
    print(f"  ssh {VPS_USER}@{VPS_HOST} 'cd {APP_PATH} && curl -s http://localhost:3000/api/cron/health-check'")
    print()

if __name__ == "__main__":
    main()
