// API Route: /api/warming/message-pool/seed
// POST — Populates the pool with the default 568 messages across 8 categories.
//
// Body: { reset?: boolean }
//   reset=true → delete ALL existing pool messages before seeding
//   reset=false (default) → only add messages for categories that are empty
//
// Returns: { seeded: number, skipped: number, total: number }

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Inline import do seed data — mantém o source of truth no script TSX que
// pode ser executado manualmente (npx tsx scripts/seed-warming-message-pool.ts)
// Para a API, replicamos aqui a lista completa para evitar dependência de
// execução de script TSX em runtime (Next.js standalone).
//
// ATENÇÃO: Se adicionar mensagens ao script seed-warming-message-pool.ts,
// atualize também este array para manter consistência.
const SEED_DATA: Record<string, string[]> = {
  saudacao: [
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
  ],
  emoji_unico: [
    '😀', '😂', '🤣', '😊', '😍', '🥰', '😎', '🤔', '🤩', '😴',
    '🥱', '😅', '🙃', '😉', '🤗', '🤭', '😇', '🥳', '🤓', '😺',
    '🤝', '👍', '👏', '🙌', '🙏', '💪', '🔥', '✨', '⭐', '🌟',
    '💫', '💯', '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '👑', '💎',
    '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💖',
    '💗', '💓', '💞', '💕', '💘', '💝', '☕', '🍺', '🍷', '🥂',
    '🍕', '🍔', '🌮', '🍣', '🍜', '🍝', '🍦', '🍫', '🍪', '🍩',
    '⚽', '🏀', '🏐', '🎾', '🏈', '🎱', '🎯', '🎮', '🎸', '🎧',
    '☀️', '🌙', '⛅', '🌧️',
  ],
  emoji_combo: [
    '😀❤️', '😂🤣', '😍🔥', '😎👍', '🤔🤷', '🤩🎉', '😴💤', '🥱☕',
    '😅🙃', '😉🤗', '🤭😂', '😇🙏', '🥳🎂', '🤓📚', '😺❤️', '🤝💪',
    '👍👏', '🙌🔥', '🙏❤️', '💪✨', '🔥⭐', '✨🌟', '⭐💫', '💯🔥',
    '🎉🎊', '🎈🎁', '🏆👑', '🥇🏆', '👑💎', '💎🔥', '❤️💕', '🧡💛',
    '💚💙', '💙💜', '💜🖤', '🤍💖', '🤎💗', '💖💝', '💗💘', '💓💞',
    '☕📖', '🍺🍕', '🍷🧀', '🥂🎉', '🍕🥤', '🍔🍟', '🌮🍺', '🍣🍶',
    '🍜🥢', '🍝🍷', '🍦🍫', '🍪🥛', '🍩☕', '⚽🏟️', '🏀🔥', '🏐💪',
    '🎾🏆', '🏈🎯', '🎱🍻', '🎯🎮', '🎸🎤', '🎧🎵', '☀️😎', '🌙💤',
    '🌧️☕', '⛅😊', '🌹❤️', '🌻☀️', '🌳🍃', '🌊🌴', '❄️⛄',
  ],
  pergunta_geral: [
    'Cê viu o jogo ontem?', 'Como tá o tempo aí?', 'Que horas são?', 'Que dia é hoje?',
    'Você viu a noticia?', 'Tá trabalhando muito?', 'Como tá a familia?', 'Tudo bem no trampo?',
    'Cê almoçou já?', 'Vai sair hoje?', 'Que horas você sai?', 'Tá com fome?',
    'E aí, vai pra onde?', 'Cê tem o link disso?', 'Como faço pra chegar aí?', 'Vai chover hoje?',
    'Tá quente aí?', 'Cê tem o número dele?', 'Como ele tá?', 'Vai ter reunião hoje?',
    'Cê sabe que horas são?', 'Tá acordado a quanto tempo?', 'Cê tá ouvindo?', 'Já terminou aquilo?',
    'Vai demorar muito?', 'Tá pronto?', 'Cê ouviu o que aconteceu?', 'Tá com pressa?',
    'Como tá o trânsito?', 'Vai dar pra fazer hoje?', 'Cê lembra de mim?', 'Tá ocupado agora?',
    'Posso ligar?', 'Cê tem um minuto?', 'Já chegou lá?', 'Como foi o dia?',
    'Tá melhor hoje?', 'Cê tem planos pro fds?', 'Vai ter festa sábado?', 'Cê vai na festa?',
    'Que dia você volta?', 'Vai viajar quando?', 'Já voltou?', 'Tá em casa?',
    'Cê viu o Pedro hoje?', 'Como a gente faz?', 'Tá dando certo?', 'Cê pensou melhor?',
    'Vai dar certo né?', 'Tá no caminho?', 'Cê tá a fim de sair?', 'Que dia você pode?',
    'Tá longe daí?', 'Cê tem como me ajudar?', 'Como tá o projeto?', 'Já terminou tudo?',
    'Tá sobrando tempo?', 'Vai dar conta?', 'Cê vai na academia hoje?', 'Tá musgando?',
    'Cê viu o video que mandei?', 'Já ouviu a música nova?', 'Que hours você chega?',
    'Tá resolvido isso?', 'Cê sabe como funciona?', 'Tá tudo certo aí?', 'E a família, como tá?',
    'Cê tá ganhando bem?', 'Já fez as contas?', 'Tá dando pra economizar?',
  ],
  declaracao_casual: [
    'Que calor hoje em', 'Tô com sono', 'Tá difícil acordar', 'Que dia longo',
    'Tô precisando de férias', 'Que trânsito ruim', 'Tá tudo caro', 'Que vida corrida',
    'Tô sem tempo pra nada', 'Que semana intensa', 'Tô cansado', 'Tá chovendo aqui',
    'Que frio hoje', 'Tô com fome', 'Tá na hora do almoço', 'Que preguiça',
    'Tô trabalhando muito', 'Que bagunça isso', 'Tá dando certo', 'Que alívio',
    'Tô feliz hoje', 'Que saudade', 'Tá tudo tranquilo', 'Que cansaço',
    'Tô sem paciência', 'Que coisa estranha', 'Tá complicado', 'Que bom te ver',
    'Tô animado', 'Que triste isso', 'Tá em cima da hora', 'Que coincidência',
    'Tô sem saber', 'Que dia bonito', 'Tá tudo bem agora', 'Que ótimo',
    'Tô indo dormir', 'Que beleza', 'Tá na hora de ir', 'Que legal isso',
    'Tô aqui parado', 'Que saco isso', 'Tá dando trabalho', 'Que novidade',
    'Tô sem graça', 'Que bênção', 'Tá indo bem', 'Que maravilha',
    'Tô a caminho', 'Que fera isso', 'Tá pronto pra hoje', 'Que bom demais',
    'Tô sem ideia', 'Que doideira', 'Tá tudo certo', 'Que alívio isso',
    'Tô voltando', 'Que errado isso', 'Tá ficando serio', 'Que brincadeira',
    'Tô aqui ainda', 'Que coisa boa', 'Tá no controle', 'Que lindo isso',
    'Tô indo embora', 'Que chato isso', 'Tá no fim do dia', 'Que pesado',
    'Tô refazendo', 'Que mudança boa', 'Tá no caminho', 'Que sucesso',
  ],
  produto_mtech: [
    'Você viu o produto novo da Mtech?', 'Tô usando o da Mtech, muito bom', 'A Mtech lançou coisa nova',
    'Cê conhece a linha Mtech?', 'O produto Mtech é top demais', 'Comprei o Mtech, recomendo',
    'A Mtech tem coisa boa', 'Vale a pena o produto Mtech', 'Tô pensando em pegar o Mtech',
    'A qualidade Mtech é boa', 'Cê já usou Mtech?', 'A Mtech tem garantia boa',
    'O atendimento Mtech é rápido', 'Pedi o Mtech, chegou rápido', 'A Mtech entregou antes do prazo',
    'O suporte da Mtech é bom', 'A Mtech tem preço justo', 'O produto Mtech vale o preço',
    'A Mtech tem variedade', 'Comprei da Mtech de novo', 'A Mtech nunca decepciona',
    'Cê viu o catálogo Mtech?', 'A Mtech tem coisa nova toda semana', 'O produto Mtech é durável',
    'A Mtech tem promoção boa', 'Peguei o Mtech na promoção', 'A Mtech sempre tem promoção',
    'Cê conhece alguém da Mtech?', 'A Mtech é confiável', 'O site da Mtech é fácil',
    'A Mtech tem app proprio', 'O app Mtech é bom', 'A Mtech tem frete grátis',
    'Comprei pela Mtech, sem erro', 'A Mtech tem ótimas avaliações', 'O produto Mtech superou expectativas',
    'A Mtech é referência', 'Cê conhece a Mtech a muito tempo?', 'A Mtech evoluiu muito',
    'A Mtech tem coisas pra todos', 'O produto Mtech é versátil', 'A Mtech pensa no cliente',
    'A Mtech tem assistência técnica', 'O pós-venda Mtech é top', 'A Mtech se importa',
    'O produto Mtech é design bonito', 'A Mtech capricha no acabamento', 'Cê já comprou Mtech?',
    'A Mtech é marca séria', 'O produto Mtech é uma boa compra', 'A Mtech tem site seguro',
    'Comprei Mtech pela primeira vez', 'A Mtech surpreendeu', 'O produto Mtech é moderno',
    'A Mtech tem opções pro dia a dia', 'A Mtech tem linha profissional', 'Cê indica Mtech?',
    'A Mtech é minha marca favorita', 'O produto Mtech é confiável', 'A Mtech tem ótimo custo-benefício',
    'A Mtech é uma das melhores', 'O produto Mtech é inovador', 'A Mtech sempre lança algo',
    'Cê já viu o canal Mtech?', 'A Mtech tem conteúdo legal', 'O produto Mtech é top de linha',
    'A Mtech tem opções baratas', 'Comprei mais barato na Mtech', 'A Mtech tem boas alternativas',
    'O produto Mtech superou a expectativa', 'A Mtech tem atendimento humano', 'Cê confia na Mtech?',
    'A Mtech é marca que entrega', 'O produto Mtech é robusto', 'A Mtech tem bom feedback',
    'A Mtech sempre traz novidade', 'O produto Mtech é prático',
  ],
  info_pedido: [
    'Como faço o pedido?', 'Quanto tempo pra entregar?', 'Tem como rastrear?', 'Já chegou meu pedido?',
    'Como funciona o frete?', 'Tem desconto no pedido?', 'Como faço a compra?', 'Tem estoque?',
    'Quanto custa o envio?', 'Tem prazo de entrega?', 'Como pago o pedido?', 'Tem parcelamento?',
    'Já despachou?', 'Como rastrear o pedido?', 'Tem nota fiscal?', 'Como cancelo o pedido?',
    'Tem como trocar?', 'Como faço a devolução?', 'Quanto demora a entrega?', 'Tem entrega no sábado?',
    'Tem retirada?', 'Onde fica a loja?', 'Tem horário de atendimento?', 'Como faço pra reclamar?',
    'Tem garantia no produto?', 'Quanto tempo de garantia?', 'Como aciono a garantia?', 'Tem suporte técnico?',
    'Tem assistência?', 'Como falo com atendente?', 'Tem WhatsApp pra contato?', 'Qual o horário de entrega?',
    'Entrega à noite?', 'Tem entrega expressa?', 'Quanto custa o expresso?', 'Tem frete grátis?',
    'Tem cupom de desconto?', 'Como uso o cupom?', 'Tem cashback?', 'Tem programa de pontos?',
    'Como faço o login?', 'Esqueci minha senha', 'Como cadastro?', 'Tem app pra celular?',
    'Onde baixo o app?', 'Como atualizo meus dados?', 'Como mudo o endereço?', 'Tem como alterar o pedido?',
    'Como adiciono mais itens?', 'Tem mínimo de compra?', 'Tem máximo por pedido?', 'Como imprimo a nota?',
    'Tem boleto?', 'Tem PIX?', 'Quais cartões aceitam?', 'Tem cartão Mtech?',
    'Como faço o reembolso?', 'Quanto tempo pra estornar?', 'Como solicitar troca?', 'Tem troca grátis?',
    'Quem paga o frete de troca?', 'Tem garantia estendida?', 'Como funciona a garantia?', 'Tem seguro?',
    'Como rastrear sem número?', 'Perdi o número de rastreio', 'Tem como reagendar a entrega?', 'Tem retirada na loja?',
    'Tem drive-thru?', 'Tem delivery?', 'Como peço pelo app?', 'Tem WhatsApp de pedidos?',
  ],
  conversa_fiada: [
    'Cê acredita em extraterrestre?', 'Tô lendo um livro muito bom', 'Cê gosta de filme?',
    'Que série cê tá vendo?', 'Tô viciado em série', 'Cê ouve podcast?', 'Que música cê gosta?',
    'Tô ouvindo música nova', 'Cê toca instrumento?', 'Qual é seu time?', 'Tô indo pro jogo sábado',
    'Cê pratica esporte?', 'Tô correndo toda manhã', 'Cê vai na academia?', 'Tô musgando ultimamente',
    'Cê tem animal de estimação?', 'Tô passeando com o cachorro', 'Cê gosta de cozinhar?', 'Fiz bolo ontem',
    'Cê tem horta em casa?', 'Plantei tomate, tá dando muito', 'Cê gosta de viajar?', 'Tô planejando uma viagem',
    'Cê já foi pro Nordeste?', 'Tô querendo ir pro Sul', 'Cê gosta de praia?', 'Tô na praia agora',
    'Cê gosta de serra?', 'Fui pra serra no feriado', 'Cê tem hobby?', 'Tô aprendendo a tocar violão',
    'Cê dança?', 'Fui numa festa ontem', 'Cê bebe?', 'Tô tomando uma cerveja', 'Cê fuma?',
    'Tô parado de fumar', 'Cê gosta de café?', 'Tô no segundo copo hoje', 'Cê tem irmãos?',
    'Falei com meu irmão ontem', 'Cê mora com quem?', 'Tô morando sozinho', 'Cê é de onde?',
    'Tô morando aqui há 2 anos', 'Cê fala outra língua?', 'Tô aprendendo inglês', 'Cê já viajou fora?',
    'Fui pra Argentina ano passado', 'Cê gosta de ler?', 'Tô lendo um livro ótimo', 'Cê escreve?',
    'Tô escrevendo um diário', 'Cê pinta?', 'Tô fazendo aula de pintura', 'Cê tira foto?',
    'Comprei uma câmera nova', 'Cê edita vídeo?', 'Tô editando um vídeo do fds', 'Cê tem canal no YouTube?',
    'Tô pensando em criar canal', 'Cê joga online?', 'Tô viciado no jogo novo', 'Cê tem console?',
    'Comprei um jogo na promo', 'Cê vai no show?', 'Vou ver minha banda favorita', 'Cê toca numa banda?',
    'Tô montando uma banda', 'Cê canta?', 'Tô cantando no chuveiro', 'Cê vai na church?',
    'Fui pras igreja ontem', 'Cê acredita em Deus?', 'Tô lendo a Bíblia', 'Cê reza?',
    'Tô rezando todos os dias', 'Cê tem fé?', 'Tô em paz ultimamente',
  ],
}

// POST — Seed the pool
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { reset = false } = body

    let seeded = 0
    let skipped = 0

    if (reset) {
      // Delete all and re-insert
      await db.warmingMessagePool.deleteMany({})
      const entries = Object.entries(SEED_DATA).flatMap(([category, messages]) =>
        messages.map(content => ({ category, content, weight: 1.0, active: true }))
      )
      const result = await db.warmingMessagePool.createMany({ data: entries })
      seeded = result.count
    } else {
      // Only insert into empty categories
      for (const [category, messages] of Object.entries(SEED_DATA)) {
        const count = await db.warmingMessagePool.count({ where: { category } })
        if (count === 0) {
          const result = await db.warmingMessagePool.createMany({
            data: messages.map(content => ({ category, content, weight: 1.0, active: true })),
          })
          seeded += result.count
        } else {
          skipped += messages.length
        }
      }
    }

    const total = await db.warmingMessagePool.count()

    return NextResponse.json({
      seeded,
      skipped,
      total,
      message: reset
        ? `Pool resetado com ${seeded} mensagens`
        : `${seeded} mensagens adicionadas, ${skipped} puladas (categorias já populadas)`,
    })
  } catch (error: any) {
    console.error('[MessagePool API] Error seeding pool:', error.message)
    return NextResponse.json(
      { error: 'Erro ao popular pool de mensagens: ' + error.message },
      { status: 500 }
    )
  }
}
