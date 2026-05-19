import { NextRequest, NextResponse } from 'next/server'

// Generate and serve the contact template CSV
export async function GET(req: NextRequest) {
  const format = new URL(req.url).searchParams.get('format') || 'csv'

  if (format === 'csv') {
    const csv = `Empresa,Nome,Telefone,Vendedor,Nota
Tech Corp,João Silva,11999990001,Renato,VIP
Info Ltda,Maria Santos,21988880002,Carlos,
Digital Inc,Pedro Lima,31977770003,Ana,Premium
Mega Sistemas,Carla Oliveira,41966660004,Renato,
Alpha Tech,Lucas Ferreira,51955550005,Carlos,Prioridade`

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="modelo_contatos_octupuszap.csv"',
      },
    })
  }

  return NextResponse.json({ error: 'Formato não suportado. Use ?format=csv' }, { status: 400 })
}
