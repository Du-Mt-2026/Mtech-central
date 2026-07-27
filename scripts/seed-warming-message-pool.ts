/**
 * Seed: Warming Message Pool
 * ==========================
 * Popula a tabela WarmingMessagePool com ~555 mensagens categorizadas
 * para uso na estratégia "ai_bot" do Warming Engine.
 *
 * Categorias (8):
 *   - saudacao          (49 mensagens)
 *   - emoji_unico       (84 mensagens)
 *   - emoji_combo       (65 mensagens)
 *   - pergunta_geral    (69 mensagens)
 *   - declaracao_casual (70 mensagens)
 *   - produto_mtech     (78 mensagens)
 *   - info_pedido       (66 mensagens)
 *   - conversa_fiada    (74 mensagens)
 *
 * Uso:
 *   npx tsx scripts/seed-warming-message-pool.ts
 *
 * Idempotente: se já existem mensagens na pool, perguntará antes de resetar.
 */

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

interface PoolEntry {
  category: string
  content: string
  weight: number
}

// ============================================================
// SAUDACAO (50)
// ============================================================
const SAUDACAO: string[] = [
  'Oi, tudo bem?', 'Opa, bom dia!', 'E aí, como vai?', 'Fala! Tudo certo?',
  'Oi, sumido! Tudo bem?', 'Bom diaaa', 'Oiee, tudo tranquilo?', 'Fala mano, firmeza?',
  'Opa, e aí!', 'Eii, como que tá?', 'Oi! Como estão as coisas?', 'Bom dia, tudo certo?',
  'E aí, peace?', 'Opa, tranquilo?', 'Oi, dormiu bem?', 'Boa tarde! Tudo bem?',
  'E aí meu parceiro, tudo certo?', 'Fala amigo, como vai?', 'Oi, como tá o dia?',
  'Opa, e aí, novidades?', 'Bom dia, acordou cedo hoje em', 'E aí, tudo em riba?',
  'Oi! Tudo bem por aí?', 'Fala, tranquilo?', 'Bom dia, cheguei!', 'Opa, oi!',
  'E aí, como tá a semana?', 'Oi, tudo certo contigo?', 'Fala cara, beleza?',
  'Bom dia, descansou?', 'Oie, sumido!', 'E aí, mais um dia né', 'Oi,tranquilo?',
  'Bom dia, bora que', 'Fala, tudo na paz?', 'Oi! Como tá a família?', 'E aí, saúde!',
  'Boa, e aí?', 'Opa, cheguei', 'E aí, dormiu legal?', 'Bom dia, frio hoje em',
  'Oi, bom te ver por aqui', 'Fala, tudo joia?', 'E aí, como tá o trampo?',
  'Opa, boa!', 'Oi, tudo na régua?', 'Bom dia, segunda-feira já', 'Fala, Sobrevivendo?',
  'Opa, e aí, vamos!',
]

// ============================================================
// EMOJI_UNICO (78)
// ============================================================
const EMOJI_UNICO: string[] = [
  '👍', '👋', '😄', '🤔', '😅', '😎', '🙏', '💪', '🔥', '✨',
  '👏', '🙌', '😊', '😉', '🤝', '💯', '👀', '😴', '🤣', '😭',
  '❤️', '🥰', '😘', '😍', '🤩', '🥳', '😋', '🤗', '😱', '🤯',
  '🥺', '😏', '😬', '🤫', '🤥', '🤡', '👻', '💀', '🤠', '🐱',
  '🐶', '🦄', '🌈', '☕', '🍕', '🍔', '🍟', '🌮', '🍦', '🍩',
  '🍪', '🍫', '🍿', '🍺', '🍷', '🍹', '🎸', '🎮', '⚽', '🏀',
  '🚗', '✈️', '🌴', '🏖️', '⭐', '🌟', '💫', '💥', '💦', '💨',
  '💤', '🎉', '🎁', '🏆', '🥇', '💰', '💳', '📱', '💻', '⏰',
  '📌', '✅', '❌', '❓',
]

// ============================================================
// EMOJI_COMBO (65)
// ============================================================
const EMOJI_COMBO: string[] = [
  '😂😂😂', '🤣🤣', '🔥🔥', '👍👍', '👏👏👏', '🙌🙌', '💀💀', '😭😭',
  '😍😍', '🥰🥰', '😱😱', '🤯🤯', '🥺🥺', '😎😎', '🤔🤔', '😅😅',
  '😴😴😴', '👀👀', '💯💯', '✨✨✨', '💪💪', '🙏🙏', '🤝🤝', '👋👋',
  '😄😄', '😉😉', '😏😏', '🤫🤫', '🤡🤡', '👻👻', '🦄🦄', '🌈🌈',
  '☕☕', '🍕🍕', '🍔🍔', '🍟🍟', '🌮🌮', '🍦🍦', '🍩🍩', '🍪🍪',
  '🍺🍺', '🍷🍷', '🎸🎸', '🎮🎮', '⚽⚽', '🏀🏀', '🚗🚗', '✈️✈️',
  '🌴🌴', '⭐⭐', '🌟🌟', '💫💫', '💥💥', '💦💦', '💤💤', '🎉🎉',
  '🎁🎁', '🏆🏆', '💰💰', '📱📱', '💻💻', '⏰⏰', '✅✅', '❓❓',
  '👍😂🔥',
]

// ============================================================
// PERGUNTA_GERAL (71)
// ============================================================
const PERGUNTA_GERAL: string[] = [
  'Como tá o clima aí?', 'Vai chover hoje?', 'Sabe se o jogo vai passar?',
  'Que horas são aí?', 'Já almoçou?', 'Vai sair hoje?', 'Tem planos pro finde?',
  'Como tá o trânsito?', 'Sabe a senha do wifi?', 'Já viu o video que mandei?',
  'Curtiu o link?', 'Tá com fome?', 'Que horas você sai?', 'Vai na academia hoje?',
  'Tá trabalhando?', 'Como tá o trampo?', 'E a família, tudo bem?',
  'Os pais tão bem?', 'Cachorro tá bem?', 'Já viu o cachorro novo do vizinho?',
  'Sabe a nota do Enem?', 'Vai viajar no fim do ano?', 'Já comprou as passagens?',
  'Quanto custou a passagem?', 'Sabe onde fica a rua tal?', 'Tem o número do João?',
  'Vai na festa sábado?', 'Que horas começa a reunião?', 'Já leu o e-mail?',
  'Tá com o relatório pronto?', 'Sabe o CEP daqui?', 'Tem pix?', 'Qual o seu pix?',
  'Vai no mercado?', 'Pode me trazer café?', 'Tem água aí?', 'Tá com o carro?',
  'Já abasteci, quer ir?', 'Sabe o preço da gasolina?', 'Vai de Uber ou busão?',
  'Que dia é hoje?', 'Que dia cai o feriado?', 'Sabe se é feriado amanhã?',
  'Vai ter reunião?', 'Tá pronto pra reunião?', 'Sabe o nome do chefe novo?',
  'Como se chama o novo?', 'Já conheceu a turma nova?', 'Tá gostando do novo?',
  'Sabe me dizer onde fica?', 'Tem como me ajudar?', 'Pode me explicar de novo?',
  'Tá entendendo?', 'Sabe a resposta?', 'Tem dúvida?', 'Posso te perguntar uma coisa?',
  'Tá ocupado agora?', 'Pode conversar?', 'Tem 5 minutos?', 'Já terminou aquele projeto?',
  'Como tá saindo o projeto?', 'Vai dar conta do prazo?', 'Sabe a data de entrega?',
  'Já mandou o e-mail pro cliente?', 'Tá no aguardo do cliente?', 'Vai almoçar onde?',
  'Quer pedir algo?', 'Vai no delivery?', 'Tem cupom?',
]

// ============================================================
// DECLARACAO_CASUAL (75)
// ============================================================
const DECLARACAO_CASUAL: string[] = [
  'Cara, que calor hoje em', 'Mano, que dia longo', 'To precisando de férias',
  'Que semana corrida viu', 'To morto de cansaço', 'Acordei cedo hoje',
  'Dormi tarde ontem', 'To sem café em casa', 'Esqueci o celular em casa',
  'Passei no mercado, tava lotado', 'O trânsito tava um caos', 'Vi uma notícia absurda',
  'To gostando do novo app', 'Achei um restaurante legal', 'To lendo um livro bom',
  'Vi um filme ontem, muito bom', 'To viciado nessa série', 'Não consigo parar de ouvir essa música',
  'Achei uma promoção boa', 'Comprei um presente pro Pedro', 'To organizando as coisas aqui',
  'Arrumei o quarto hoje', 'Lavei a louça toda', 'To fazendo um bolo',
  'Passei o dia em casa', 'Saí pra caminhar', 'Fui na praça hoje',
  'Encontrei um amigo antigo', 'To conversando com o João', 'Marquei de sair sábado',
  'Vou num aniversário hoje', 'To indo pra casa', 'Cheguei agora',
  'Bati o ponto, tô de folga', 'To de boa aqui', 'To sem nada pra fazer',
  'Não sei o que fazer hoje', 'To entediado', 'Quero ver um filme',
  'Tava pensando em viajar', 'Será que chove amanhã?', 'To com preguiça',
  'Bom demais esse dia', 'Tô feliz hoje', 'Acordou bem hoje',
  'Que dia bonito', 'To agradecido por hoje', 'Tô numa vibe boa',
  'Tá tudo certo por aqui', 'To no fluxo', 'Deixa comigo',
  'Tranquilo, dá pra fazer', 'Fechou, vou fazer', 'Beleza, combinado',
  'Tá anotado', 'Vou sim, pode mandar', 'Combinado então',
  'Já tô sabendo', 'Tô por dentro', 'Tô por dentro do assunto',
  'Já vi isso', 'Conheço essa parada', 'Sei de quem você tá falando',
  'Tô ouvindo falar muito disso', 'Andei lendo sobre isso',
  'Tava lendo um artigo sobre isso', 'Vi um video sobre isso outro dia',
  'Curti essa ideia', 'Boa, vou pensar', ' Faz sentido isso',
]

// ============================================================
// PRODUTO_MTECH (81)
// ============================================================
const PRODUTO_MTECH: string[] = [
  'Você já usou o Mtech CRM?', 'Tô testando o Mtech, gostei bastante',
  'Achei o Mtech bem intuitivo', 'Mtech tem integração com WhatsApp?',
  'O suporte do Mtech responde rápido?', 'Mtech tem versão gratuita?',
  'Como faço pra assinar o Mtech?', 'Mtech tem app pro celular?',
  'O Mtech funciona bem no PC?', 'Mtech é melhor que concorrente?',
  'Mtech tem automação?', 'Mtech tem disparo em massa?',
  'Como funciona o aquecimento no Mtech?', 'Mtech tem gestão de chips?',
  'Mtech controla quantos chips?', 'Mtech tem relatório de envios?',
  'Mtech gera métricas por chip?', 'Mtech tem dashboard?',
  'Mtech tem integração com Evolution?', 'Mtech usa Evolution API?',
  'Como instalo o Mtech?', 'Mtech precisa de VPS?',
  'Mtech roda em Docker?', 'Mtech é self-hosted?',
  'Mtech tem cloud?', 'Mtech tem backup automático?',
  'Mtech tem auditoria de logs?', 'Mtech tem controle de usuários?',
  'Mtech tem permissões por role?', 'Mtech tem login com 2FA?',
  'Mtech tem API pra integrar?', 'Mtech tem webhook?',
  'Mtech tem integração com n8n?', 'Mtech tem integração com Zapier?',
  'Mtech tem integração com Make?', 'Mtech envia imagem?',
  'Mtech envia áudio?', 'Mtech envia documento?',
  'Mtech tem template de mensagem?', 'Mtech tem variáveis dinâmicas?',
  'Mtech tem personalização por nome?', 'Mtech tem fila de envio?',
  'Mtech tem agendamento?', 'Mtech tem campanha recorrente?',
  'Mtech tem split A/B?', 'Mtech tem teste de mensagem?',
  'Mtech tem validação de número?', 'Mtech detecta bloqueio?',
  'Mtech tem anti-ban?', 'Mtech tem warm-up de chip?',
  'Mtech tem cooldown configurável?', 'Mtech tem limite diário?',
  'Mtech tem limite por fase?', 'Mtech tem fases de chip?',
  'Mtech tem berçário?', 'Mtech tem pré-aquecido?',
  'Mtech tem chip pronto pra uso?', 'Mtech tem janela de envio?',
  'Mtech tem pausa de almoço?', 'Mtech tem typing simulation?',
  'Mtech tem presence simulation?', 'Mtech tem delay gaussiano?',
  'Mtech tem intervalo configurável?', 'Mtech tem intervalo aleatório?',
  'Mtech tem fallback de chip?', 'Mtech tem redistribuição?',
  'Mtech tem retry automático?', 'Mtech tem fila de reenvio?',
  'Mtech tem relatório de bounces?', 'Mtech tem blacklist?',
  'Mtech tem opt-out?', 'Mtech tem respeito ao LGPD?',
  'Mtech tem compliance com ANPD?', 'Mtech tem logs auditáveis?',
  'Mtech tem exportação de dados?', 'Mtech tem importação de contatos?',
  'Mtech tem template de campanha?', 'Mtech tem segmentação de público?',
]

// ============================================================
// INFO_PEDIDO (69)
// ============================================================
const INFO_PEDIDO: string[] = [
  'Meu pedido já saiu?', 'Já despachou meu pedido?', 'Sabe quando chega?',
  'Quanto tempo leva em média?', 'Tem previsão de entrega?', 'Já passou o transportador?',
  'Recebi notificação de postagem', 'O código de rastreio funcionou',
  'Não consigo rastrear o pedido', 'O rastreio parou no mesmo lugar',
  'Tem como me passar o rastreio?', 'Já postou na transportadora?',
  'Vai chegar essa semana?', 'Pode chegar antes do feriado?',
  'Tenho urgência, tem como adiantar?', 'Tem entrega expressa?',
  'Quanto custa o frete expresso?', 'Tem retirada no local?',
  'Posso retirar pessoalmente?', 'Em qual endereço fica?',
  'Qual o horário de atendimento?', 'Atende sábado?', 'Atende domingo?',
  'Tem estacionamento?', 'É fácil chegar de busão?', 'Tem ponto de ônibus perto?',
  'Tem metrô perto?', 'Tem bicicletário?', 'Tem acesso pra cadeirante?',
  'Posso pagar no pix?', 'Aceita cartão?', 'Aceita dinheiro?',
  'Tem maquininha na entrega?', 'Tem boleto?', 'Tem carnê?',
  'Tem parcelamento sem juros?', 'Em quantas vezes posso parcelar?',
  'Tem desconto pra vista?', 'Tem desconto no pix?', 'Tem cupom de desconto?',
  'Tem promoção rolando?', 'Tem black friday esse ano?', 'Tem cashback?',
  'Tem programa de pontos?', 'Tem fidelidade?', 'Tem indicação de amigo?',
  'Posso trocar o produto?', 'Qual a política de troca?', 'E se eu não gostar?',
  'Tem garantia?', 'Quanto tempo de garantia?', 'A garantia cobre o quê?',
  'Tem nota fiscal?', 'Vem com nota?', 'É produto original?',
  'É produto licenciado?', 'Tem certificado Anatel?', 'Tem selo do Inmetro?',
  'Vem com manual?', 'Tem suporte em português?', 'Tem suporte técnico?',
  'O suporte é 24h?', 'Tem WhatsApp de suporte?', 'Tem e-mail de suporte?',
  'Tem chat de suporte?', 'Tem base de conhecimento?',
]

// ============================================================
// CONVERSA_FIADA (79)
// ============================================================
const CONVERSA_FIADA: string[] = [
  'Pior que é mesmo', 'Concordo totalmente', 'Faz sentido',
  'Boa essa', 'kkkkk verdade', 'Pior que sim', 'Boa, não tinha pensado assim',
  'Sério mesmo?', 'Nossa, sério?', 'Não sabia disso', 'Interessante isso',
  'Boa dica', 'Vou anotar', 'Depois me conta como foi', 'Pode mandar mais',
  'Manda mais detalhes', 'Quero saber mais', 'Contou pra alguém?',
  'Já compartilhei com o pessoal', 'Vou compartilhar', 'Boa demais essa',
  'Salvei aqui', 'Já favoritei', 'Curti muito', 'Ri muito com isso',
  'Meu Deus que isso', 'Surreal isso', 'Cara, como assim',
  'Como que ninguém pensou nisso antes', 'Brilhante', 'Gênio',
  'Você é bom hein', 'Boa, vou usar essa', 'Vou roubar essa ideia',
  'Pode me ensinar?', 'Como você faz isso?', 'Qual seu segredo?',
  'Você estuda o quê?', 'De onde você é?', 'Mora aqui há quanto tempo?',
  'Já morou fora?', 'Já viajou pra onde?', 'Pra onde quer ir?',
  'Pra onde vai nas férias?', 'Qual destino dos sonhos?', 'Qual comida preferida?',
  'O que gosta de fazer no livre?', 'Qual hobby?', 'Qual esporte?',
  'Qual time?', 'Torce pra quem?', 'Vai no estádio?',
  'Já foi num show esse ano?', 'Qual a última vez que viajou?',
  'Já fez sushi em casa?', 'Sabe cozinhar o quê?', 'Qual prato que domina?',
  'Faz bolo de que?', 'Tem receita pra mandar?', 'Manda a receita depois',
  'Tá com fome agora?', 'Vamos pedir algo?', 'Topo uma pizza',
  'Bora pedir um lanche', 'Bora marcar um café', 'Quando você pode?',
  'Tá livre quando?', 'Qual dia te funciona?', 'Bora marcar',
  'Pode ser essa semana?', 'No fim de semana melhor?', 'Sábado de manhã?',
  'Domingo à tarde?', 'Agente aí, depois confirmo',
]

// ============================================================
// MONTA POOL
// ============================================================
function buildPool(): PoolEntry[] {
  const entries: PoolEntry[] = []
  const addAll = (category: string, messages: string[], weight: number = 1.0) => {
    for (const content of messages) {
      entries.push({ category, content, weight })
    }
  }

  addAll('saudacao', SAUDACAO, 1.2)        // saudações são importantes pra iniciar conversa
  addAll('emoji_unico', EMOJI_UNICO, 0.8)  // emojis leves
  addAll('emoji_combo', EMOJI_COMBO, 0.6)  // combos são pesados, usar com moderação
  addAll('pergunta_geral', PERGUNTA_GERAL, 1.1)
  addAll('declaracao_casual', DECLARACAO_CASUAL, 1.0)
  addAll('produto_mtech', PRODUTO_MTECH, 0.9)
  addAll('info_pedido', INFO_PEDIDO, 0.9)
  addAll('conversa_fiada', CONVERSA_FIADA, 1.0)

  return entries
}

async function main() {
  const pool = buildPool()
  console.log(`[Seed] WarmingMessagePool: ${pool.length} mensagens`)
  console.log(`[Seed] Distribuição por categoria:`)
  const counts: Record<string, number> = {}
  for (const e of pool) counts[e.category] = (counts[e.category] || 0) + 1
  for (const [cat, n] of Object.entries(counts)) {
    console.log(`  ${cat}: ${n}`)
  }

  // Verifica se já existe
  const existing = await (db as any).warmingMessagePool.count()
  if (existing > 0) {
    console.log(`[Seed] Aviso: já existem ${existing} mensagens na pool.`)
    if (process.env.FORCE_RESET !== 'true') {
      const shouldReset = process.argv.includes('--force')
      if (!shouldReset) {
        console.log(`[Seed] Use --force para deletar e recriar. Abortando.`)
        return
      }
    }
    console.log(`[Seed] Deletando pool existente...`)
    await (db as any).warmingMessagePool.deleteMany({})
  }

  // Insere em batches de 50
  const BATCH_SIZE = 50
  let inserted = 0
  for (let i = 0; i < pool.length; i += BATCH_SIZE) {
    const batch = pool.slice(i, i + BATCH_SIZE)
    await (db as any).warmingMessagePool.createMany({
      data: batch,
      skipDuplicates: true,
    })
    inserted += batch.length
    process.stdout.write(`\r[Seed] Inserido: ${inserted}/${pool.length}`)
  }
  console.log('')

  const final = await (db as any).warmingMessagePool.count()
  console.log(`[Seed] ✅ Concluído. Total na pool: ${final}`)
}

main()
  .catch((e) => {
    console.error('[Seed] ❌ Erro:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
