import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

function generateWireGuardKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const privBuf = privateKey.export({ type: 'pkcs8', format: 'der' });
  const pubBuf = publicKey.export({ type: 'spki', format: 'der' });
  return {
    privateKey: privBuf.slice(-32).toString('base64'),
    publicKey: pubBuf.slice(-32).toString('base64'),
  };
}

async function main() {
  // Create sample chips
  const chip1Keys = generateWireGuardKeypair();
  const chip1 = await prisma.chip.create({
    data: {
      name: 'Chip Claro',
      phoneNumber: '11999990001',
      wireguardIp: '10.13.37.2',
      wireguardPrivKey: chip1Keys.privateKey,
      wireguardPubKey: chip1Keys.publicKey,
      socksPort: 1080,
      status: 'disconnected',
    },
  });

  const chip2Keys = generateWireGuardKeypair();
  const chip2 = await prisma.chip.create({
    data: {
      name: 'Chip Vivo',
      phoneNumber: '11999990002',
      wireguardIp: '10.13.37.3',
      wireguardPrivKey: chip2Keys.privateKey,
      wireguardPubKey: chip2Keys.publicKey,
      socksPort: 1081,
      status: 'disconnected',
    },
  });

  // Create sample contact list
  const contactList = await prisma.contactList.create({
    data: { name: 'Lista de Contatos Teste' },
  });

  // Create sample contacts linked to the contact list
  const contacts = [
    { name: 'João Silva', phone: '11988880001', chipId: chip1.id, contactListId: contactList.id },
    { name: 'Maria Santos', phone: '11988880002', chipId: chip1.id, contactListId: contactList.id },
    { name: 'Pedro Lima', phone: '11988880003', chipId: chip2.id, contactListId: contactList.id },
    { name: 'Ana Costa', phone: '11988880004', chipId: chip2.id, contactListId: contactList.id },
  ];
  for (const c of contacts) {
    await prisma.contact.create({ data: c });
  }

  // Create sample campaign with SequenceStep (replaces old messageVariations)
  const campaign = await prisma.campaign.create({
    data: {
      name: 'Campanha Black Friday',
      status: 'draft',
      sendIntervalMin: 30,
      sendIntervalMax: 90,
      contactListId: contactList.id,
      antiBanEnabled: true,
      warmingMode: 'normal',
      chips: {
        create: [
          { chipId: chip1.id },
          { chipId: chip2.id },
        ],
      },
      sequenceSteps: {
        create: [
          {
            stepOrder: 1,
            content: 'Olá {nome}! Temos uma oferta especial pra você!',
            delayMinutes: 0,
            variations: JSON.stringify([
              { content: 'Olá {nome}! Temos uma oferta especial pra você!' },
              { content: 'Ei {nome}, não perca nossa promoção exclusiva!' },
            ]),
          },
          {
            stepOrder: 2,
            content: 'Acesse agora e garanta seu desconto, {nome}!',
            delayMinutes: 60,
            variations: '[]',
          },
        ],
      },
    },
  });

  console.log('Seed completed!', { chip1: chip1.id, chip2: chip2.id, contactList: contactList.id, campaign: campaign.id });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
