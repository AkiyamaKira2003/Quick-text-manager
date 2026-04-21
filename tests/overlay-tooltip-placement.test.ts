import test from 'node:test'
import assert from 'node:assert/strict'
import { computeHorizontalTooltipPlacement } from '../lib/overlay-tooltip'

test('tooltip prefers below anchor when enough vertical space', () => {
  const placement = computeHorizontalTooltipPlacement(
    {
      left: 100,
      top: 50,
      width: 20,
      height: 20,
    },
    {
      left: 0,
      top: 0,
      width: 120,
      height: 80,
    },
    {
      width: 400,
      height: 300,
    },
  )

  assert.equal(placement.placement, 'below')
  assert.equal(placement.left, 50)
  assert.equal(placement.top, 78)
})

test('tooltip flips above when there is no space below', () => {
  const placement = computeHorizontalTooltipPlacement(
    {
      left: 120,
      top: 260,
      width: 20,
      height: 20,
    },
    {
      left: 0,
      top: 0,
      width: 160,
      height: 80,
    },
    {
      width: 420,
      height: 320,
    },
  )

  assert.equal(placement.placement, 'above')
  assert.equal(placement.top, 172)
})

test('tooltip shifts horizontally to stay inside viewport', () => {
  const leftEdge = computeHorizontalTooltipPlacement(
    {
      left: 2,
      top: 100,
      width: 20,
      height: 20,
    },
    {
      left: 0,
      top: 0,
      width: 180,
      height: 60,
    },
    {
      width: 200,
      height: 300,
    },
  )

  const rightEdge = computeHorizontalTooltipPlacement(
    {
      left: 180,
      top: 100,
      width: 20,
      height: 20,
    },
    {
      left: 0,
      top: 0,
      width: 180,
      height: 60,
    },
    {
      width: 200,
      height: 300,
    },
  )

  assert.equal(leftEdge.left, 8)
  assert.equal(rightEdge.left, 12)
})
