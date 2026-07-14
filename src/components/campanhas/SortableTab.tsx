'use client'

import React, { CSSProperties } from 'react'
import { GripVertical, Clock, X } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'

export function SortableTab({ id, idx, isActive, canClose, onClick, onClose, isFollowUp, delayLabel }: {
  id: string; idx: number; isActive: boolean; canClose: boolean; onClick: () => void; onClose: () => void;
  isFollowUp?: boolean; delayLabel?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : 1,
  }

  // All steps use the same browser-tab style
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="shrink-0 group"
    >
      <div
        className={`flex items-center gap-0.5 pl-2 pr-0.5 py-1.5 text-sm font-medium rounded-md transition-colors ${
          isActive
            ? 'bg-background text-emerald-600 ring-1 ring-emerald-200 dark:ring-emerald-800 shadow-sm'
            : 'text-muted-foreground hover:text-foreground bg-muted/30 hover:bg-muted/50'
        }`}
      >
        {/* Drag handle */}
        <span
          className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground mr-0.5"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3" />
        </span>
        {/* Tab label - clicking switches tab */}
        <button type="button" className="flex items-center gap-1.5" onClick={onClick}>
          <span className="flex items-center justify-center size-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold">{idx + 1}</span>
          <span className="whitespace-nowrap">Mensagem {idx + 1}</span>
          {delayLabel && (
            <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded-full">
              <Clock className="size-2.5" />{delayLabel}
            </span>
          )}
        </button>
        {/* Close X button */}
        {canClose && (
          <button
            type="button"
            className="ml-0.5 flex items-center justify-center size-4 rounded-sm text-muted-foreground/50 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors opacity-0 group-hover:opacity-100"
            onClick={(e) => { e.stopPropagation(); onClose() }}
            title="Fechar mensagem"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
    </div>
  )
}
