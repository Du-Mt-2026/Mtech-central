'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Smartphone, Megaphone, Send, CheckCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Stats {
  totalChips: number
  connectedChips: number
  disconnectedChips: number
  activeCampaigns: number
  totalMessages: number
  deliveryRate: number
}

const defaultStats: Stats = {
  totalChips: 0,
  connectedChips: 0,
  disconnectedChips: 0,
  activeCampaigns: 0,
  totalMessages: 0,
  deliveryRate: 0,
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
}

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
}

export function DashboardSection() {
  const [stats, setStats] = useState<Stats>(defaultStats)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch('/api/stats')
        if (res.ok) {
          const data = await res.json()
          setStats(data)
        }
      } catch {
        // use default stats
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [])

  const statCards = [
    {
      title: 'Total de Chips',
      value: stats.totalChips,
      subtitle: `${stats.connectedChips} conectados · ${stats.disconnectedChips} desconectados`,
      icon: Smartphone,
      color: 'text-emerald-500',
      bgColor: 'bg-emerald-500/10',
    },
    {
      title: 'Campanhas Ativas',
      value: stats.activeCampaigns,
      subtitle: 'Em execução agora',
      icon: Megaphone,
      color: 'text-amber-500',
      bgColor: 'bg-amber-500/10',
    },
    {
      title: 'Mensagens Enviadas',
      value: stats.totalMessages.toLocaleString('pt-BR'),
      subtitle: 'Total de envios',
      icon: Send,
      color: 'text-sky-500',
      bgColor: 'bg-sky-500/10',
    },
    {
      title: 'Taxa de Entrega',
      value: `${stats.deliveryRate}%`,
      subtitle: 'Entregues com sucesso',
      icon: CheckCircle,
      color: 'text-violet-500',
      bgColor: 'bg-violet-500/10',
    },
  ]

  return (
    <div>
      <motion.div
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {statCards.map((card) => {
          const Icon = card.icon
          return (
            <motion.div key={card.title} variants={cardVariants}>
              <Card className="relative overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {card.title}
                  </CardTitle>
                  <div className={`p-2 rounded-lg ${card.bgColor}`}>
                    <Icon className={`w-4 h-4 ${card.color}`} />
                  </div>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="h-9 w-24 bg-muted animate-pulse rounded" />
                  ) : (
                    <>
                      <div className="text-3xl font-bold">{card.value}</div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {card.subtitle}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )
        })}
      </motion.div>
    </div>
  )
}
