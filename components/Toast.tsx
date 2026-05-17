'use client'

import { useEffect, useState } from 'react'

interface Toast {
  id: number
  message: string
  variant: 'success' | 'error' | 'info'
  link?: { label: string; url: string }
}

type Listener = (toast: Toast) => void

const listeners = new Set<Listener>()
let nextId = 1

export function showToast(
  message: string,
  variant: Toast['variant'] = 'info',
  link?: { label: string; url: string },
) {
  const t: Toast = { id: nextId++, message, variant, link }
  listeners.forEach(l => l(t))
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const listener: Listener = (t) => {
      setToasts(prev => [...prev, t])
      // Auto-dismiss after 5s
      setTimeout(() => {
        setToasts(prev => prev.filter(x => x.id !== t.id))
      }, 5000)
    }
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])

  function dismiss(id: number) {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  return (
    <div className="fixed bottom-4 right-4 z-[1000] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className="pointer-events-auto card p-3 min-w-[280px] max-w-[420px] fade-in"
          style={{
            borderColor: t.variant === 'success' ? 'var(--accent)' : t.variant === 'error' ? 'var(--negative)' : 'var(--border-strong)',
            background: 'var(--bg-card)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
          }}
        >
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 inline-block w-2 h-2 rounded-full shrink-0"
              style={{
                background: t.variant === 'success' ? 'var(--accent)' : t.variant === 'error' ? 'var(--negative)' : 'var(--fg-muted)',
                boxShadow: t.variant === 'success' ? '0 0 8px var(--accent-glow)' : 'none',
              }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[var(--fg)] leading-snug">{t.message}</div>
              {t.link && (
                <a
                  href={t.link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-1 text-[11px] text-[var(--accent)] hover:underline mono"
                >
                  {t.link.label} ↗
                </a>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="text-[var(--fg-dim)] hover:text-[var(--fg)] text-lg leading-none shrink-0"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
