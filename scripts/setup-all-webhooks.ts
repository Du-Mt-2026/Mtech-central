/**
 * Reconfigura o webhook de TODOS os chips com instancia Evolution.
 *
 * Executa direto no container (sem HTTP), chamando setWebhook() para cada chip.
 * Adiciona ?token=<EVOLUTION_API_KEY> na URL do webhook para que o Evolution Go
 * envie o token de volta (necessario apos o patch P1.1 fail-closed).
 *
 * Uso:
 *   docker exec octupuszap-app bun run scripts/setup-all-webhooks.ts
 *
 * Ou via docker compose:
 *   docker compose exec app bun run scripts/setup-all-webhooks.ts
 */

import { db } from '../src/lib/db'
import { setWebhook } from '../src/lib/evolution-router'

async function main() {
  console.log('=== Setup Webhook para todos os chips ===\n')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const webhookToken = process.env.EVOLUTION_API_KEY || ''

  if (!webhookToken) {
    console.error('ERRO: EVOLUTION_API_KEY nao configurada no ambiente.')
    console.error('Configure no .env e reinicie o container antes de rodar este script.')
    process.exit(1)
  }

  const webhookUrl = `${appUrl}/api/whatsapp/webhook?token=${webhookToken}`
  console.log(`Webhook URL alvo: ${webhookUrl.replace(webhookToken, '<TOKEN>')}\n`)

  // Lista todos os chips com instancia Evolution
  const chips = await db.chip.findMany({
    where: { evolutionInstance: { not: null } },
    select: { id: true, name: true, phoneNumber: true, evolutionInstance: true, status: true },
  })

  console.log(`Encontrados ${chips.length} chips com instancia Evolution.\n`)

  if (chips.length === 0) {
    console.log('Nenhum chip para configurar. Saindo.')
    process.exit(0)
  }

  let success = 0
  let failed = 0
  const failures: Array<{ chip: string; error: string }> = []

  for (const chip of chips) {
    process.stdout.write(`  [${success + failed + 1}/${chips.length}] ${chip.name} (${chip.phoneNumber}) - ${chip.evolutionInstance}... `)

    try {
      await setWebhook(chip.evolutionInstance!, webhookUrl)
      console.log('OK')
      success++
    } catch (err: any) {
      console.log(`FALHOU: ${err.message?.substring(0, 100) || err}`)
      failures.push({ chip: chip.evolutionInstance || chip.name, error: err.message || String(err) })
      failed++
    }

    // Pequeno delay para nao sobrecarregar a API do Evolution
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

  console.log('\nPróximos passos:')
  console.log('1. Aguarde 1-2 minutos para o Evolution Go comecar a enviar eventos com o token')
  console.log('2. Verifique os logs: docker compose logs --tail=50 app | grep Webhook')
  console.log('3. Voce deve ver "Event: ..." em vez de "Rejected — no apikey provided"')

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Script failed:', err)
  process.exit(1)
})
