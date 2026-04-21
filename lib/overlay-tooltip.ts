export type TooltipRectLike = {
  left: number
  top: number
  width: number
  height: number
  right?: number
  bottom?: number
}

export type TooltipViewport = {
  width: number
  height: number
}

export type TooltipPlacement = {
  left: number
  top: number
  placement: 'below' | 'above'
}

const DEFAULT_MARGIN = 8

export function computeHorizontalTooltipPlacement(
  anchorRect: TooltipRectLike,
  tooltipRect: TooltipRectLike,
  viewport: TooltipViewport,
  margin = DEFAULT_MARGIN,
): TooltipPlacement {
  const safeMargin = Number.isFinite(margin) ? Math.max(0, Math.floor(margin)) : DEFAULT_MARGIN
  const safeWidth = Number.isFinite(viewport.width) ? Math.max(1, viewport.width) : 1
  const safeHeight = Number.isFinite(viewport.height) ? Math.max(1, viewport.height) : 1
  const tooltipWidth = Number.isFinite(tooltipRect.width) ? Math.max(1, tooltipRect.width) : 1
  const tooltipHeight = Number.isFinite(tooltipRect.height) ? Math.max(1, tooltipRect.height) : 1
  const anchorLeft = Number.isFinite(anchorRect.left) ? anchorRect.left : 0
  const anchorTop = Number.isFinite(anchorRect.top) ? anchorRect.top : 0
  const anchorWidth = Number.isFinite(anchorRect.width) ? anchorRect.width : 0
  const anchorHeight = Number.isFinite(anchorRect.height) ? anchorRect.height : 0
  const anchorBottom = Number.isFinite(anchorRect.bottom) ? (anchorRect.bottom as number) : anchorTop + anchorHeight

  const centeredLeft = anchorLeft + anchorWidth / 2 - tooltipWidth / 2
  const minLeft = safeMargin
  const maxLeft = Math.max(minLeft, safeWidth - tooltipWidth - safeMargin)
  const left = clampNumber(centeredLeft, minLeft, maxLeft)

  const minTop = safeMargin
  const maxTop = Math.max(minTop, safeHeight - tooltipHeight - safeMargin)
  const belowTop = anchorBottom + safeMargin
  const fitsBelow = belowTop <= maxTop
  const aboveTop = anchorTop - tooltipHeight - safeMargin
  const top = fitsBelow ? belowTop : clampNumber(aboveTop, minTop, maxTop)

  return {
    left,
    top,
    placement: fitsBelow ? 'below' : 'above',
  }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
