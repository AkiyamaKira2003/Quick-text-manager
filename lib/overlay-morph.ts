import type { OverlayRectSnapshot } from '@/types'

export type MorphTransform = {
  translateX: number
  translateY: number
  scaleX: number
  scaleY: number
}

export function isRectSnapshotValid(rect: OverlayRectSnapshot | null | undefined): rect is OverlayRectSnapshot {
  if (!rect) return false
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return false
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return false
  return rect.width > 0 && rect.height > 0
}

export function computeMorphTransform(from: OverlayRectSnapshot, to: OverlayRectSnapshot): MorphTransform {
  const scaleX = to.width / from.width
  const scaleY = to.height / from.height
  return {
    translateX: to.left - from.left,
    translateY: to.top - from.top,
    scaleX: Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1,
    scaleY: Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1,
  }
}
