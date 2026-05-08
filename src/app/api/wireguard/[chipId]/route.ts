import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getServerPublicKey, getServerEndpoint } from '@/lib/wireguard'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ chipId: string }> }
) {
  try {
    const { chipId } = await params
    const chip = await db.chip.findUnique({ where: { id: chipId } })

    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    if (!chip.wireguardIp || !chip.wireguardPrivKey) {
      return NextResponse.json(
        { error: 'WireGuard não configurado para este chip' },
        { status: 400 }
      )
    }

    const serverPubKey = getServerPublicKey()
    const serverEndpoint = getServerEndpoint()

    const config = `[Interface]
PrivateKey = ${chip.wireguardPrivKey}
Address = ${chip.wireguardIp}/24
DNS = 1.1.1.1, 8.8.8.8

[Peer]
PublicKey = ${serverPubKey}
Endpoint = ${serverEndpoint}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25`

    return NextResponse.json({
      config,
      chip: {
        id: chip.id,
        name: chip.name,
        wireguardIp: chip.wireguardIp,
        wireguardPubKey: chip.wireguardPubKey,
        socksPort: chip.socksPort,
      },
    })
  } catch (error) {
    console.error('Wireguard GET error:', error)
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}
