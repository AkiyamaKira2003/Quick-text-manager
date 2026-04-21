import test from 'node:test'
import assert from 'node:assert/strict'
import { computeMorphTransform, isRectSnapshotValid } from '../lib/overlay-morph'

test('isRectSnapshotValid validates finite positive rects', () => {
  assert.equal(isRectSnapshotValid({ left: 10, top: 12, width: 100, height: 42 }), true)
  assert.equal(isRectSnapshotValid({ left: 10, top: 12, width: 0, height: 42 }), false)
  assert.equal(isRectSnapshotValid({ left: Number.NaN, top: 12, width: 100, height: 42 }), false)
  assert.equal(isRectSnapshotValid(null), false)
})

test('computeMorphTransform returns expected translate and scale', () => {
  const from = { left: 100, top: 200, width: 300, height: 150 }
  const to = { left: 130, top: 240, width: 150, height: 300 }

  const transform = computeMorphTransform(from, to)

  assert.equal(transform.translateX, 30)
  assert.equal(transform.translateY, 40)
  assert.equal(transform.scaleX, 0.5)
  assert.equal(transform.scaleY, 2)
})

test('computeMorphTransform falls back scale to 1 for invalid ratios', () => {
  const from = { left: 0, top: 0, width: 0, height: 0 }
  const to = { left: 50, top: 60, width: 80, height: 120 }

  const transform = computeMorphTransform(from, to)

  assert.equal(transform.translateX, 50)
  assert.equal(transform.translateY, 60)
  assert.equal(transform.scaleX, 1)
  assert.equal(transform.scaleY, 1)
})
