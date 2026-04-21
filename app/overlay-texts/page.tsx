'use client'

import { useEffect } from 'react'

export default function OverlayTextsPage() {
  useEffect(() => {
    window.location.replace('/overlay-image?tab=text')
  }, [])

  return null
}
