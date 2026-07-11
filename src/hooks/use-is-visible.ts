'use client'

import { useState, useEffect } from 'react'

export function useIsVisible() {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const handler = () => setIsVisible(!document.hidden)
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  return isVisible
}
