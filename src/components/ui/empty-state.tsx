import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

interface EmptyStateAction {
  label: string
  onClick: () => void
  icon?: LucideIcon
}

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: EmptyStateAction
  children?: ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, children, className }: EmptyStateProps) {
  const ActionIcon = action?.icon ?? Plus
  return (
    <Card
      className={cn(
        "flex flex-col items-center justify-center py-16 px-6 text-center border-dashed",
        className
      )}
    >
      <div className="flex size-16 items-center justify-center rounded-full bg-muted mb-4">
        <Icon className="size-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-4">{description}</p>
      )}
      {action && (
        <Button onClick={action.onClick} className="gap-2 mb-3">
          <ActionIcon className="size-4" />
          {action.label}
        </Button>
      )}
      {children && <div className="flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </Card>
  )
}
