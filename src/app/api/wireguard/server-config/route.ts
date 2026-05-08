import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const chips = await db.chip.findMany({ orderBy: { wireguardIp: 'asc' } });
    const serverPrivKey = process.env.WIREGUARD_SERVER_PRIV_KEY || '';
    const subnet = process.env.WIREGUARD_SUBNET || '10.13.37';
    const serverPort = process.env.WIREGUARD_SERVER_PORT || '51820';

    let peers = '';
    for (const chip of chips) {
      peers += `
# ${chip.name} (${chip.phoneNumber})
[Peer]
PublicKey = ${chip.wireguardPubKey}
AllowedIPs = ${chip.wireguardIp}/32
`;
    }

    const config = `[Interface]
PrivateKey = ${serverPrivKey}
Address = ${subnet}.1/24
ListenPort = ${serverPort}
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
${peers}`;

    return NextResponse.json({ config });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
