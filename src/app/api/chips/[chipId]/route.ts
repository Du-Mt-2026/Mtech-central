import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ chipId: string }> }) {
  const { chipId } = await params;
  try {
    await db.chip.delete({ where: { id: chipId } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ chipId: string }> }) {
  const { chipId } = await params;
  try {
    const body = await req.json();
    const chip = await db.chip.update({
      where: { id: chipId },
      data: body,
    });
    return NextResponse.json(chip);
  } catch {
    return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 });
  }
}
