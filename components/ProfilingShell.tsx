'use client'

import { Profiler, useCallback, useEffect, useRef, type ProfilerOnRenderCallback, type ReactNode } from 'react'
import type {
  ProfilingPerformanceEntryInput,
  ProfilingReactCommitInput,
  ProfilingRuntimeState,
} from '@/types'

const REACT_FLUSH_DEBOUNCE_MS = 1200
const PERFORMANCE_FLUSH_DEBOUNCE_MS = 1800
const MAX_BATCH_ITEMS = 200
const MAX_BUFFER_ITEMS = 800

export default function ProfilingShell({ children }: { children: ReactNode }) {
  const profilingEnabledRef = useRef(false)
  const reactQueueRef = useRef<ProfilingReactCommitInput[]>([])
  const performanceQueueRef = useRef<ProfilingPerformanceEntryInput[]>([])
  const reactFlushTimerRef = useRef<number | null>(null)
  const performanceFlushTimerRef = useRef<number | null>(null)

  const flushReactQueue = useCallback(() => {
    if (reactQueueRef.current.length === 0) return
    const api = window.electronAPI?.reportReactProfileCommits
    if (!api) {
      reactQueueRef.current = []
      return
    }

    const batch = reactQueueRef.current.splice(0, MAX_BATCH_ITEMS)
    if (batch.length === 0) return

    void api(batch).catch(() => {
      reactQueueRef.current = [...batch, ...reactQueueRef.current].slice(-MAX_BUFFER_ITEMS)
    })
  }, [])

  const flushPerformanceQueue = useCallback(() => {
    if (performanceQueueRef.current.length === 0) return
    const api = window.electronAPI?.reportPerformanceEntries
    if (!api) {
      performanceQueueRef.current = []
      return
    }

    const batch = performanceQueueRef.current.splice(0, MAX_BATCH_ITEMS)
    if (batch.length === 0) return

    void api(batch).catch(() => {
      performanceQueueRef.current = [...batch, ...performanceQueueRef.current].slice(-MAX_BUFFER_ITEMS)
    })
  }, [])

  const scheduleReactFlush = useCallback(() => {
    if (reactFlushTimerRef.current !== null) return
    reactFlushTimerRef.current = window.setTimeout(() => {
      reactFlushTimerRef.current = null
      flushReactQueue()
      if (reactQueueRef.current.length > 0) {
        scheduleReactFlush()
      }
    }, REACT_FLUSH_DEBOUNCE_MS)
  }, [flushReactQueue])

  const schedulePerformanceFlush = useCallback(() => {
    if (performanceFlushTimerRef.current !== null) return
    performanceFlushTimerRef.current = window.setTimeout(() => {
      performanceFlushTimerRef.current = null
      flushPerformanceQueue()
      if (performanceQueueRef.current.length > 0) {
        schedulePerformanceFlush()
      }
    }, PERFORMANCE_FLUSH_DEBOUNCE_MS)
  }, [flushPerformanceQueue])

  const handleProfilerRender: ProfilerOnRenderCallback = useCallback(
    (id, phase, actualDuration, baseDuration, startTime, commitTime) => {
      if (!profilingEnabledRef.current) return
      if (!window.electronAPI?.reportReactProfileCommits) return

      const commit: ProfilingReactCommitInput = {
        id: String(id || 'qt-root'),
        phase,
        actualDurationMs: roundMetric(actualDuration),
        baseDurationMs: roundMetric(baseDuration),
        startTimeMs: roundMetric(startTime),
        commitTimeMs: roundMetric(commitTime),
        capturedAt: Date.now(),
        route: getRouteSnapshot(),
      }

      reactQueueRef.current.push(commit)
      if (reactQueueRef.current.length > MAX_BUFFER_ITEMS) {
        reactQueueRef.current.splice(0, reactQueueRef.current.length - MAX_BUFFER_ITEMS)
      }
      scheduleReactFlush()
    },
    [scheduleReactFlush],
  )

  useEffect(() => {
    let mounted = true

    const applyState = (state: ProfilingRuntimeState) => {
      if (!mounted) return
      profilingEnabledRef.current = state.enabled === true
    }

    if (window.electronAPI?.getProfilingState) {
      void window.electronAPI.getProfilingState().then(applyState).catch(() => undefined)
    }

    const unsubscribe = window.electronAPI?.onProfilingUpdated?.((state) => {
      applyState(state)
    })

    return () => {
      mounted = false
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return

    const api = window.electronAPI?.reportPerformanceEntries
    if (!api) return

    const supported = Array.isArray(PerformanceObserver.supportedEntryTypes) ? PerformanceObserver.supportedEntryTypes : []
    const targets = ['longtask', 'paint', 'measure', 'navigation'].filter((entryType) => supported.includes(entryType))
    if (targets.length === 0) return

    const observer = new PerformanceObserver((list) => {
      if (!profilingEnabledRef.current) return
      const entries = list.getEntries()
      if (!Array.isArray(entries) || entries.length === 0) return

      for (const entry of entries) {
        const normalized: ProfilingPerformanceEntryInput = {
          entryType: entry.entryType,
          name: entry.name || entry.entryType,
          startTimeMs: roundMetric(entry.startTime),
          durationMs: roundMetric(entry.duration),
          capturedAt: Date.now(),
          route: getRouteSnapshot(),
        }

        if (entry.entryType === 'navigation' && 'type' in entry) {
          const detail = String((entry as PerformanceNavigationTiming).type || '')
          if (detail) normalized.detail = detail
        }

        performanceQueueRef.current.push(normalized)
      }

      if (performanceQueueRef.current.length > MAX_BUFFER_ITEMS) {
        performanceQueueRef.current.splice(0, performanceQueueRef.current.length - MAX_BUFFER_ITEMS)
      }
      schedulePerformanceFlush()
    })

    for (const entryType of targets) {
      try {
        observer.observe({ type: entryType, buffered: true })
      } catch {
        // Ignore unsupported observer mode for this entry type.
      }
    }

    return () => {
      observer.disconnect()
    }
  }, [schedulePerformanceFlush])

  useEffect(() => {
    const flushAll = () => {
      if (reactFlushTimerRef.current !== null) {
        window.clearTimeout(reactFlushTimerRef.current)
        reactFlushTimerRef.current = null
      }
      if (performanceFlushTimerRef.current !== null) {
        window.clearTimeout(performanceFlushTimerRef.current)
        performanceFlushTimerRef.current = null
      }
      flushReactQueue()
      flushPerformanceQueue()
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushAll()
      }
    }

    window.addEventListener('beforeunload', flushAll)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('beforeunload', flushAll)
      document.removeEventListener('visibilitychange', handleVisibility)
      flushAll()
    }
  }, [flushPerformanceQueue, flushReactQueue])

  return (
    <Profiler id="qt-root" onRender={handleProfilerRender}>
      {children}
    </Profiler>
  )
}

function roundMetric(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 1000) / 1000
}

function getRouteSnapshot() {
  if (typeof window === 'undefined') return ''
  const pathname = window.location.pathname || '/'
  const search = window.location.search || ''
  return `${pathname}${search}`
}
