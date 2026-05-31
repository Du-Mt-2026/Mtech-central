#!/usr/bin/env node
/**
 * Query DB for Chip Proxy Configurations
 * 
 * Usage:
 *   DATABASE_URL="postgresql://user:pass@host:5432/dbname?sslmode=require" node scripts/query-proxy-config.js
 * 
 * Or set DATABASE_URL in .env and run from project root:
 *   node scripts/query-proxy-config.js
 */

const { PrismaClient } = require('@prisma/client')

async function main() {
  const db = new PrismaClient()

  try {
    console.log('\n' + '='.repeat(80))
    console.log('CHIP PROXY CONFIGURATION REPORT')
    console.log('Generated at:', new Date().toISOString())
    console.log('='.repeat(80))

    // ─────────────────────────────────────────────────────────────
    // 1. ALL CHIPS with proxy-related fields
    // ─────────────────────────────────────────────────────────────
    console.log('\n\n📋 1. CHIPS — Proxy-Related Fields\n')
    console.log('-'.repeat(80))

    const chips = await db.chip.findMany({
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        status: true,
        evolutionInstance: true,
        wireguardIp: true,
        proxyMode: true,
        socks5Host: true,
        socks5Port: true,
        socks5User: true,
        socks5Pass: true,
        socksPort: true,
        wireguardPubKey: true,
        warmingPhase: true,
        warmingEnabled: true,
        dailyLimit: true,
        sentToday: true,
        hourlySent: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    if (chips.length === 0) {
      console.log('  (no chips found)')
    } else {
      for (const chip of chips) {
        console.log(`\n  Chip: ${chip.name} (${chip.phoneNumber})`)
        console.log(`    ID:               ${chip.id}`)
        console.log(`    Status:           ${chip.status}`)
        console.log(`    Evolution Inst:   ${chip.evolutionInstance || '(none)'}`)
        console.log(`    WireGuard IP:     ${chip.wireguardIp || '(none)'}`)
        console.log(`    WireGuard PubKey: ${chip.wireguardPubKey ? chip.wireguardPubKey.substring(0, 20) + '...' : '(none)'}`)
        console.log(`    Socks Port (DB):  ${chip.socksPort}`)
        console.log(`    ─── Proxy Config ───`)
        console.log(`    proxyMode:        ${chip.proxyMode}`)
        console.log(`    socks5Host:       ${chip.socks5Host || '(empty)'}`)
        console.log(`    socks5Port:       ${chip.socks5Port || '(0)'}`)
        console.log(`    socks5User:       ${chip.socks5User || '(empty)'}`)
        console.log(`    socks5Pass:       ${chip.socks5Pass ? '••••••' : '(empty)'}`)
        console.log(`    ─── Warming/Anti-Ban ───`)
        console.log(`    warmingPhase:     ${chip.warmingPhase}`)
        console.log(`    warmingEnabled:   ${chip.warmingEnabled}`)
        console.log(`    dailyLimit:       ${chip.dailyLimit}`)
        console.log(`    sentToday:        ${chip.sentToday}`)
        console.log(`    hourlySent:       ${chip.hourlySent}`)

        // Resolve effective proxy (mirrors resolveChipProxy logic)
        let effectiveProxy = '❌ NO PROXY'
        if (chip.proxyMode === 'socks5' && chip.socks5Host && chip.socks5Port && chip.socks5Pass) {
          effectiveProxy = `✅ SOCKS5: ${chip.socks5Host}:${chip.socks5Port} (user=${chip.socks5User || 'none'})`
        } else if (chip.wireguardIp) {
          effectiveProxy = `✅ WireGuard Auto: ${chip.wireguardIp}:8084 (user=${chip.socks5User || 'none'}, pass=${chip.socks5Pass ? 'set' : 'none'})`
        }
        console.log(`    ➡️  Effective Proxy: ${effectiveProxy}`)
      }
    }

    console.log(`\n  Total chips: ${chips.length}`)

    // ─────────────────────────────────────────────────────────────
    // 2. Settings table — global proxy configuration
    // ─────────────────────────────────────────────────────────────
    console.log('\n\n📋 2. SETTINGS — Global Proxy Configuration\n')
    console.log('-'.repeat(80))

    const proxyKeys = [
      'default_socks5_host',
      'default_socks5_port',
      'default_socks5_user',
      'default_socks5_pass',
    ]

    const settings = await db.settings.findMany({
      where: { key: { in: proxyKeys } },
    })

    const settingsMap = new Map(settings.map(s => [s.key, s.value]))

    for (const key of proxyKeys) {
      const value = settingsMap.get(key)
      if (value) {
        const display = key.includes('pass') ? '••••••' : value
        console.log(`  ${key}: ${display}`)
      } else {
        console.log(`  ${key}: (not set)`)
      }
    }

    const host = settingsMap.get('default_socks5_host') || ''
    const port = settingsMap.get('default_socks5_port') || ''
    const pass = settingsMap.get('default_socks5_pass') || ''
    if (host && port && pass) {
      console.log(`\n  ➡️  Global proxy ACTIVE: ${host}:${port}`)
    } else if (host || port) {
      console.log(`\n  ⚠️  Global proxy INCOMPLETE (needs host, port, AND password)`)
    } else {
      console.log(`\n  ➡️  Global proxy: NOT CONFIGURED`)
    }

    // Also show ALL settings for context
    const allSettings = await db.settings.findMany()
    if (allSettings.length > 0) {
      console.log('\n  All Settings keys:')
      for (const s of allSettings) {
        const display = s.key.includes('pass') || s.key.includes('key') || s.key.includes('secret')
          ? '••••••' : s.value.substring(0, 80)
        console.log(`    ${s.key}: ${display}`)
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. AntiBanSettings — autoRejectCalls and related
    // ─────────────────────────────────────────────────────────────
    console.log('\n\n📋 3. ANTI-BAN SETTINGS — Call Rejection & Related\n')
    console.log('-'.repeat(80))

    let antiban = await db.antiBanSettings.findFirst()
    if (!antiban) {
      console.log('  (no anti-ban settings found — will use defaults on first access)')
      console.log('  Defaults from schema:')
      console.log('    autoRejectCalls: true')
      console.log('    autoRejectCallMessage: "Desculpa, não posso atender agora."')
      console.log('    evolutionApiTimeoutMs: 15000')
    } else {
      console.log(`  ID: ${antiban.id}`)
      console.log(`  ─── Call Rejection ───`)
      console.log(`  autoRejectCalls:        ${antiban.autoRejectCalls}`)
      console.log(`  autoRejectCallMessage:  "${antiban.autoRejectCallMessage}"`)
      console.log(`  ─── Evolution API ───`)
      console.log(`  evolutionApiTimeoutMs:  ${antiban.evolutionApiTimeoutMs}ms`)
      console.log(`  ─── Sending Window ───`)
      console.log(`  sendingWindowStart:     ${antiban.sendingWindowStart} (${Math.floor(antiban.sendingWindowStart / 60)}:${String(antiban.sendingWindowStart % 60).padStart(2, '0')})`)
      console.log(`  sendingWindowEnd:       ${antiban.sendingWindowEnd} (${Math.floor(antiban.sendingWindowEnd / 60)}:${String(antiban.sendingWindowEnd % 60).padStart(2, '0')})`)
      console.log(`  timezone:               ${antiban.timezone}`)
      console.log(`  ─── Limits ───`)
      console.log(`  dailyLimitPerChip:      ${antiban.dailyLimitPerChip}`)
      console.log(`  hourlyLimit:            ${antiban.hourlyLimit}`)
      console.log(`  ─── Intervals ───`)
      console.log(`  messageIntervalMin:     ${antiban.messageIntervalMin}s`)
      console.log(`  messageIntervalMax:     ${antiban.messageIntervalMax}s`)
      console.log(`  typingMinDelay:         ${antiban.typingMinDelay}ms`)
      console.log(`  typingMaxDelay:         ${antiban.typingMaxDelay}ms`)
      console.log(`  ─── Cooldown ───`)
      console.log(`  cooldownMinutes:        ${antiban.cooldownMinutes}-${antiban.cooldownMinutesMax} min`)
      console.log(`  cooldownAfterMessages:  ${antiban.cooldownAfterMessages}-${antiban.cooldownAfterMessagesMax} msgs`)
      console.log(`  ─── Human Behavior ───`)
      console.log(`  humanBehaviorEnabled:   ${antiban.humanBehaviorEnabled}`)
      console.log(`  ─── Ban Detection ───`)
      console.log(`  banCodes:               ${antiban.banCodes}`)
      console.log(`  stopOnWarning:          ${antiban.stopOnWarning}`)
      console.log(`  ─── Reconnection ───`)
      console.log(`  reconnectMaxConcurrent: ${antiban.reconnectMaxConcurrent}`)
      console.log(`  reconnectMaxAttempts:   ${antiban.reconnectMaxAttempts}`)
    }

    // ─────────────────────────────────────────────────────────────
    // Summary
    // ─────────────────────────────────────────────────────────────
    console.log('\n\n' + '='.repeat(80))
    console.log('SUMMARY')
    console.log('='.repeat(80))

    const chipsWithProxy = chips.filter(c =>
      (c.proxyMode === 'socks5' && c.socks5Host && c.socks5Port && c.socks5Pass) ||
      c.wireguardIp
    )
    const chipsWithoutProxy = chips.filter(c =>
      !(c.proxyMode === 'socks5' && c.socks5Host && c.socks5Port && c.socks5Pass) &&
      !c.wireguardIp
    )
    const globalProxyActive = !!(host && port && pass)

    console.log(`\n  Total chips:              ${chips.length}`)
    console.log(`  Chips WITH proxy:         ${chipsWithProxy.length}`)
    console.log(`  Chips WITHOUT proxy:      ${chipsWithoutProxy.length}`)
    console.log(`  Global proxy configured:  ${globalProxyActive ? 'YES' : 'NO'}`)
    console.log(`  Auto-reject calls:        ${antiban?.autoRejectCalls ?? 'true (default)'}`)

    if (chipsWithoutProxy.length > 0 && !globalProxyActive) {
      console.log(`\n  ⚠️  ${chipsWithoutProxy.length} chips have NO proxy and no global proxy is configured!`)
      console.log('     These chips connect to WhatsApp without any IP masking.')
    }

    if (chipsWithoutProxy.length > 0 && globalProxyActive) {
      console.log(`\n  ℹ️  ${chipsWithoutProxy.length} chips have no per-chip proxy but will use the global proxy.`)
    }

    console.log('\n')

  } catch (error) {
    console.error('Error querying database:', error)
    process.exit(1)
  } finally {
    await db.$disconnect()
  }
}

main()
