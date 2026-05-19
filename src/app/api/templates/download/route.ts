import { NextRequest, NextResponse } from 'next/server'

// Generate and serve the contact template CSV
export async function GET(req: NextRequest) {
  const format = new URL(req.url).searchParams.get('format') || 'csv'

  if (format === 'csv') {
    const csv = `Nome,WhatsApp,Empresa,Vendedora
Maria Silva,5511999990001,Tech Corp,Ana
Julia Santos,5521988880002,Info Ltda,Carla
Pedro Lima,5531977770003,Digital Inc,Fernanda
Carla Oliveira,5541966660004,Mega Sistemas,Patricia
Lucas Ferreira,5551955550005,Alpha Tech,Renata`

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="modelo_contatos_octupuszap.csv"',
      },
    })
  }

  return NextResponse.json({ error: 'Formato não suportado. Use ?format=csv' }, { status: 400 })
}
