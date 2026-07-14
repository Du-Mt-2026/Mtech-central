'use client'

// Extracted verbatim from src/app/page.tsx (P2.1-split-4).
// ===== Visibility Hook =====
import { useState, useEffect } from 'react'

export function useIsVisible() {
  const [isVisible, setIsVisible] = useState(true)
  useEffect(() => {
    const handleVisibility = () => setIsVisible(!document.hidden)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])
  return isVisible
}
