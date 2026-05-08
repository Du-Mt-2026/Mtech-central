'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Check, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

interface WireGuardConfigDialogProps {
  chipId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WireGuardConfigDialog({
  chipId,
  open,
  onOpenChange,
}: WireGuardConfigDialogProps) {
  const [configString, setConfigString] = useState('')
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    if (!open) {
      setConfigString('')
      setQrCodeUrl('')
      setLoading(true)
      setCopied(false)
      return
    }

    async function fetchConfig() {
      try {
        const res = await fetch(`/api/wireguard/${chipId}`)
        if (!res.ok) {
          toast({ title: 'Erro ao carregar configuração WireGuard', variant: 'destructive' })
          return
        }
        const data = await res.json()
        const cfg = data.config as string
        setConfigString(cfg)

        // Generate QR code
        try {
          const url = await QRCode.toDataURL(cfg, {
            width: 300,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
          })
          setQrCodeUrl(url)
        } catch {
          toast({ title: 'Erro ao gerar QR Code', variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Erro ao carregar configuração WireGuard', variant: 'destructive' })
      } finally {
        setLoading(false)
      }
    }

    fetchConfig()
  }, [open, chipId, toast])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(configString)
      setCopied(true)
      toast({ title: 'Configuração copiada!' })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: 'Erro ao copiar', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configuração WireGuard</DialogTitle>
          <DialogDescription>
            Configure o chip para rotear mensagens via conexão 4G
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
          </div>
        ) : (
          <Tabs defaultValue="qrcode" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="qrcode" className="flex-1">QR Code</TabsTrigger>
              <TabsTrigger value="config" className="flex-1">Configuração</TabsTrigger>
              <TabsTrigger value="tutorial" className="flex-1">Passo a Passo</TabsTrigger>
            </TabsList>

            {/* QR Code Tab */}
            <TabsContent value="qrcode" className="mt-4">
              <div className="flex flex-col items-center gap-4">
                {qrCodeUrl ? (
                  <div className="bg-white p-4 rounded-xl">
                    <img
                      src={qrCodeUrl}
                      alt="QR Code WireGuard"
                      className="w-64 h-64"
                    />
                  </div>
                ) : (
                  <div className="w-64 h-64 bg-muted rounded-xl flex items-center justify-center">
                    <p className="text-sm text-muted-foreground">Erro ao gerar QR Code</p>
                  </div>
                )}
                <div className="text-center space-y-2">
                  <p className="text-sm font-medium">Escaneie com o app WireGuard</p>
                  <p className="text-xs text-muted-foreground">
                    Abra o app WireGuard no celular → Toque em <strong>+</strong> →{' '}
                    <strong>Escanear QR Code</strong>
                  </p>
                </div>
              </div>
            </TabsContent>

            {/* Config Tab */}
            <TabsContent value="config" className="mt-4">
              <div className="space-y-4">
                <div className="relative">
                  <pre className="bg-zinc-900 text-zinc-100 p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono border border-zinc-700">
                    {configString}
                  </pre>
                </div>
                <Button
                  onClick={handleCopy}
                  variant="outline"
                  className="w-full"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-2 text-emerald-500" />
                      Copiado!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-2" />
                      Copiar Config
                    </>
                  )}
                </Button>
                <div className="text-center space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Cole esta configuração em <code className="bg-muted px-1 py-0.5 rounded text-xs">/etc/wireguard/wg0.conf</code> no celular
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Ou salve como arquivo <code className="bg-muted px-1 py-0.5 rounded text-xs">.conf</code> e importe no app WireGuard
                  </p>
                </div>
              </div>
            </TabsContent>

            {/* Tutorial Tab */}
            <TabsContent value="tutorial" className="mt-4">
              <div className="space-y-5 text-sm">
                {/* Step 1 */}
                <div className="space-y-2">
                  <h4 className="font-semibold text-base flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-bold">1</span>
                    No Servidor (VPS)
                  </h4>
                  <div className="ml-8 space-y-1 text-muted-foreground">
                    <p>• Instale o WireGuard: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">apt install wireguard</code></p>
                    <p>• Cole a config do servidor em <code className="bg-muted px-1.5 py-0.5 rounded text-xs">/etc/wireguard/wg0.conf</code></p>
                    <p>• Ative: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">wg-quick up wg0</code></p>
                    <p>• Habilite IP forwarding: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">sysctl -w net.ipv4.ip_forward=1</code></p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="space-y-2">
                  <h4 className="font-semibold text-base flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-bold">2</span>
                    No Celular — WireGuard
                  </h4>
                  <div className="ml-8 space-y-1 text-muted-foreground">
                    <p>• Instale o app WireGuard (Play Store / App Store)</p>
                    <p>• Abra o app e toque no botão <strong>&quot;+&quot;</strong></p>
                    <p>• Escolha <strong>&quot;Escanear QR Code&quot;</strong> ou &quot;Criar a partir de arquivo&quot;</p>
                    <p>• Escaneie o QR Code desta tela</p>
                    <p>• Ative o túnel WireGuard (chave liga/desliga)</p>
                    <p>• Verifique se conectou (deve mostrar tempo de conexão)</p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="space-y-2">
                  <h4 className="font-semibold text-base flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-bold">3</span>
                    No Celular — Every Proxy
                  </h4>
                  <div className="ml-8 space-y-1 text-muted-foreground">
                    <p>• Instale o app Every Proxy (Play Store)</p>
                    <p>• Abra o Every Proxy</p>
                    <p>• Vá na aba <strong>&quot;SOCKS5&quot;</strong> (pode estar junto com HTTP)</p>
                    <p>• Ligue o switch do SOCKS5 (é só ligar, não tem configuração!)</p>
                    <p>• O app vai mostrar o IP local (ex: 10.13.37.X) e porta 1080</p>
                    <p>• Pronto! O proxy SOCKS5 está rodando no chip</p>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="space-y-2">
                  <h4 className="font-semibold text-base flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-bold">4</span>
                    Teste a Conexão
                  </h4>
                  <div className="ml-8 space-y-1 text-muted-foreground">
                    <p>
                      • No servidor, teste com:{' '}
                      <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                        curl --socks5 10.13.37.X:1080 http://ifconfig.me
                      </code>
                    </p>
                    <p>• Deve retornar o IP do 4G do chip</p>
                    <p>• Se retornou, está tudo funcionando! ✅</p>
                  </div>
                </div>

                {/* Troubleshooting */}
                <div className="mt-6 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <h4 className="font-semibold text-amber-400 mb-2">⚠️ Problemas Comuns:</h4>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>• <strong>WireGuard não conecta:</strong> Verifique se a porta 51820/UDP está aberta no firewall</p>
                    <p>• <strong>Proxy não funciona:</strong> Confirme que o WireGuard está conectado ANTES de ligar o Every Proxy</p>
                    <p>• <strong>IP errado no curl:</strong> Reinicie o Every Proxy após conectar o WireGuard</p>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
