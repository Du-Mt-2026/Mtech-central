import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  try {
    const body = await req.json();
    const campaign = await db.campaign.update({
      where: { id: campaignId },
      data: body,
      include: { chips: { include: { chip: true } } },
    });
    return NextResponse.json(campaign);
  } catch {
    return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  try {
    await db.campaign.delete({ where: { id: campaignId } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 });
  }
}
