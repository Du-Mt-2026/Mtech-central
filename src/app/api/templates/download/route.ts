import { NextRequest, NextResponse } from 'next/server'

// Generate and serve the contact template CSV
export async function GET(req: NextRequest) {
  const format = new URL(req.url).searchParams.get('format') || 'csv'

  if (format === 'csv') {
    const csv = `Nome,Telefone,Codigo,Empresa,Vendedora,Whatsapp,Nota
Maria Silva,5511999990001,001,Tech Corp,Ana,5511999990001,
Julia Santos,5521988880002,002,Info Ltda,Carla,5521988880002,
Pedro Lima,5531977770003,003,Digital Inc,Fernanda,5531977770003,`

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="modelo_contatos_octupuszap.csv"',
      },
    })
  }

  return NextResponse.json({ error: 'Formato não suportado. Use ?format=csv' }, { status: 400 })
}
