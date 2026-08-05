/**
 * Reconfigura o webhook de TODOS os chips com instancia Evolution.
 *
 * SELF-CONTAINED: nao depende de @/lib/* — instancia Prisma direto e faz
 * chamadas HTTP diretas ao Evolution Go. Pode rodar dentro do container
 * standalone do Next.js.
 *
 * Adiciona ?token=<EVOLUTION_API_KEY> na URL do webhook para que o
 * Evolution Go envie o token de volta (necessario apos patch P1.1 fail-closed).
 *
 * Uso:
 *   docker compose exec app tsx scripts/setup-all-webhooks.ts
 */

import { PrismaClient } from '@prisma/client'
import * as readline from 'readline'

const db = new PrismaClient()

// Eventos que o Evolution Go deve enviar via webhook
const WEBHOOK_EVENTS = [
  'MESSAGE',
  'SEND_MESSAGE',
  'SEND_MESSAGE_ACK',
  'READ_RECEIPT',
  'RECEIPT',
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
]

interface EvolutionInstance {
  id: string
  name: string
  token?: string
}

async function getCredentials(): Promise<{ apiUrl: string; apiKey: string }> {
  // Tenta pegar do DB primeiro (Settings table)
  let apiUrl = ''
  let apiKey = ''

  try {
    const settings = await db.settings.findMany({
      where: { key: { in: ['evolution_api_url', 'evolution_api_key'] } },
    })
    const map = new Map(settings.map(s => [s.key, s.value]))
    apiUrl = map.get('evolution_api_url') || ''
    apiKey = map.get('evolution_api_key') || ''
  } catch (err) {
    console.warn('[Creds] Aviso: nao foi possivel ler Settings da DB, usando env vars')
  }

  // Fallback para env vars
  if (!apiUrl) apiUrl = process.env.EVOLUTION_API_URL || ''
  if (!apiKey) apiKey = process.env.EVOLUTION_API_KEY || ''

  return { apiUrl, apiKey }
}

async function listInstances(apiUrl: string, apiKey: string): Promise<EvolutionInstance[]> {
  const url = `${apiUrl}/instance/all`
  const response = await fetch(url, {
    headers: {
      'apikey': apiKey,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`GET /instance/all falhou (${response.status}): ${text.substring(0, 200)}`)
  }

  const data = await response.json()
  // Evolution Go pode retornar em formatos diferentes — tratar ambos
  const instances = Array.isArray(data) ? data : (data.instances || data.data || [])
  return instances
}

async function setWebhook(
  apiUrl: string,
  apiKey: string,
  instance: EvolutionInstance,
  webhookUrl: string,
): Promise<void> {
  // POST /instance/connect com webhookUrl
  // Se ja conectado, atualiza a config do webhook sem re-conectar
  const url = `${apiUrl}/instance/connect`

  // Para instancias scoped, precisa do token da instancia (nao da apikey global)
  const effectiveApiKey = instance.token || apiKey

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': effectiveApiKey,
  }
  if (instance.id) {
    headers['instanceId'] = instance.id
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      webhookUrl,
      subscribe: WEBHOOK_EVENTS,
      immediate: true,
    }),
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`)
  }
}

async function main() {
  console.log('=== Setup Webhook para todos os chips ===\n')

  const { apiUrl, apiKey } = await getCredentials()

  if (!apiUrl || !apiKey) {
    console.error('ERRO: EVOLUTION_API_URL ou EVOLUTION_API_KEY nao configurados.')
    console.error('Configure no .env OU na tabela Settings do banco.')
    process.exit(1)
  }

  console.log(`Evolution API URL: ${apiUrl}`)
  console.log(`Evolution API Key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const webhookUrl = `${appUrl}/api/whatsapp/webhook?token=${apiKey}`
  console.log(`Webhook URL alvo: ${webhookUrl.replace(apiKey, '<TOKEN>')}\n`)

  // Buscar lista de instancias do Evolution Go
  console.log('Buscando lista de instancias do Evolution Go...')
  let instances: EvolutionInstance[]
  try {
    instances = await listInstances(apiUrl, apiKey)
    console.log(`Encontradas ${instances.length} instancias no Evolution Go.`)
  } catch (err: any) {
    console.error('Falha ao listar instancias:', err.message)
    process.exit(1)
  }

  // Indexar por nome para lookup rapido
  const instancesByName = new Map<string, EvolutionInstance>()
  for (const inst of instances) {
    if (inst.name) instancesByName.set(inst.name, inst)
  }

  // Buscar chips do banco que tem instancia Evolution vinculada
  const chips = await db.chip.findMany({
    where: { evolutionInstance: { not: null } },
    select: { id: true, name: true, phoneNumber: true, evolutionInstance: true, status: true },
  })

  console.log(`Encontrados ${chips.length} chips com instancia Evolution no banco.\n`)

  if (chips.length === 0) {
    console.log('Nenhum chip para configurar. Saindo.')
    process.exit(0)
  }

  // Confirmacao
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise<string>(resolve => {
    rl.question(`Reconfigurar webhook para ${chips.length} chips? (yes/no): `, resolve)
  })
  rl.close()

  if (answer.toLowerCase() !== 'yes') {
    console.log('Abortado.')
    process.exit(0)
  }

  console.log('')
  let success = 0
  let failed = 0
  const failures: Array<{ chip: string; error: string }> = []

  for (const chip of chips) {
    const idx = success + failed + 1
    process.stdout.write(`  [${idx}/${chips.length}] ${chip.name} (${chip.phoneNumber}) - ${chip.evolutionInstance}... `)

    try {
      // Resolver instancia pelo nome para pegar o token
      const inst = instancesByName.get(chip.evolutionInstance!)
      if (!inst) {
        throw new Error(`instancia "${chip.evolutionInstance}" nao encontrada no Evolution Go`)
      }

      await setWebhook(apiUrl, apiKey, inst, webhookUrl)
      console.log('OK')
      success++
    } catch (err: any) {
      console.log(`FALHOU: ${err.message?.substring(0, 100) || err}`)
      failures.push({ chip: chip.evolutionInstance || chip.name, error: err.message || String(err) })
      failed++
    }

    // Pequeno delay para nao sobrecarregar
    await new Promise(r => setTimeout(r, 200))
  }

  console.log('\n=== Resumo ===')
  console.log(`Sucesso: ${success}`)
  console.log(`Falha:   ${failed}`)
  console.log(`Total:   ${chips.length}`)

  if (failures.length > 0) {
    console.log('\nFalhas detalhadas:')
    for (const f of failures) {
      console.log(`  - ${f.chip}: ${f.error.substring(0, 200)}`)
    }
  }

  console.log('\nProximos passos:')
  console.log('1. Aguarde 1-2 minutos para o Evolution Go comecar a enviar eventos com o token')
  console.log('2. Verifique os logs: docker compose logs --tail=50 app | grep Webhook')
  console.log('3. Voce deve ver "Event: ..." em vez de "Rejected - no apikey provided"')

  await db.$disconnect()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Script failed:', err)
  process.exit(1)
})
