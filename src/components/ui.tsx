import { useEffect, useId, useRef, type ReactNode } from 'react'

/* ===========================================================================
   ชิ้นส่วน UI ที่ใช้ซ้ำทั้งแอป — ออกแบบให้กดง่ายบนมือถือ (ปุ่มใหญ่ ตัวหนังสือชัด)
=========================================================================== */

const ICON_PATHS: Record<string, string> = {
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  box: 'M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z M3.3 7 12 12l8.7-5 M12 22V12',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  cart: 'M8 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M19 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12',
  chart: 'M3 3v16a2 2 0 0 0 2 2h16 M7 15l4-4 3 3 5-6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  plus: 'M12 5v14 M5 12h14',
  trash: 'M3 6h18 M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  edit: 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z',
  undo: 'M3 7v6h6 M3.51 13a9 9 0 1 0 2.13-5.36L3 13',
  close: 'M18 6 6 18 M6 6l12 12',
  send: 'M22 2 11 13 M22 2l-7 20-4-9-9-4z',
  check: 'M20 6 9 17l-5-5',
  warn: 'M12 9v4 M12 17h.01 M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  info: 'M12 16v-4 M12 8h.01 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35',
  chevron: 'M9 18l6-6-6-6',
  down: 'M6 9l6 6 6-6',
  calc: 'M8 6h8 M8 10h.01 M12 10h.01 M16 10h.01 M8 14h.01 M12 14h.01 M16 14h.01 M8 18h8 M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.22 4.22l1.42 1.42 M18.36 18.36l1.42 1.42 M1 12h2 M21 12h2 M4.22 19.78l1.42-1.42 M18.36 5.64l1.42-1.42',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
}

export function Icon({ name, className = 'size-5' }: { name: keyof typeof ICON_PATHS | string; className?: string }) {
  const d = ICON_PATHS[name] ?? ICON_PATHS.info
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {d.split(' M').map((seg, i) => (
        <path key={i} d={i === 0 ? seg : `M${seg}`} />
      ))}
    </svg>
  )
}

export function Card({
  title,
  subtitle,
  action,
  children,
  className = '',
  bodyClass = 'p-4',
}: {
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  children?: ReactNode
  className?: string
  bodyClass?: string
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-4 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink leading-tight">{title}</h2>}
            {subtitle && <p className="text-[13px] text-ink-3 mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

export type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'brand'

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink',
  good: 'text-good-ink',
  bad: 'text-bad-ink',
  warn: 'text-warn-ink',
  brand: 'text-brand',
}

/** ตัวเลขสรุปหนึ่งช่อง — พาดหัวเป็นตัวเลข ไม่ใช่กราฟ เพราะอ่านเร็วกว่า */
export function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
  hint,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: Tone
  hint?: string
}) {
  return (
    <div className="card p-3.5" title={hint}>
      <div className="text-[12.5px] font-medium text-ink-3 leading-tight">{label}</div>
      <div className={`mt-1.5 text-[22px] font-bold leading-none tnum ${TONE_TEXT[tone]}`}>{value}</div>
      {sub && <div className="mt-1.5 text-[12px] text-ink-3 leading-tight">{sub}</div>}
    </div>
  )
}

export function Chip({ tone = 'neutral', children }: { tone?: Tone | 'info'; children: ReactNode }) {
  const styles: Record<string, string> = {
    neutral: 'bg-surface-2 text-ink-2',
    good: 'bg-good/12 text-good-ink',
    bad: 'bg-bad/12 text-bad-ink',
    warn: 'bg-warn/18 text-warn-ink',
    brand: 'bg-brand-soft text-brand',
    info: 'bg-s1/12 text-s1',
  }
  return <span className={`chip ${styles[tone]}`}>{children}</span>
}

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label?: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-3">{hint}</span>}
    </label>
  )
}

/** ช่องกรอกตัวเลข — เปิดแป้นตัวเลขบนมือถือ และไม่เด้งกลับเป็น 0 ระหว่างพิมพ์ */
export function NumberInput({
  value,
  onChange,
  suffix,
  placeholder,
  min = 0,
  step = 'any',
  className = '',
}: {
  value: number | ''
  onChange: (v: number) => void
  suffix?: string
  placeholder?: string
  min?: number
  step?: number | 'any'
  className?: string
}) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        className={`field tnum ${suffix ? 'pr-14' : ''} ${className}`}
        value={value}
        min={min}
        step={step}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        onFocus={(e) => e.currentTarget.select()}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">
          {suffix}
        </span>
      )}
    </div>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex rounded-xl bg-surface-2 p-1 gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-lg font-medium transition-colors ${
            size === 'sm' ? 'px-2.5 py-1 text-[12.5px]' : 'px-3.5 py-1.5 text-[13.5px]'
          } ${value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-2xl outline-none
                    sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5">
          <h2 id={titleId} className="text-[16px] font-semibold">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2" aria-label="ปิด">
            <Icon name="close" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <footer className="border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

export function Empty({
  icon = 'info',
  title,
  hint,
  action,
}: {
  icon?: string
  title: string
  hint?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="rounded-2xl bg-surface-2 p-3 text-ink-3">
        <Icon name={icon} className="size-6" />
      </div>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {hint && <p className="max-w-xs text-[13.5px] leading-relaxed text-ink-3">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** แถบเลื่อนแนวนอนที่มีเงาบอกว่ายังเลื่อนต่อได้ — ใช้กับตารางกว้างๆ */
export function ScrollX({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`-mx-4 overflow-x-auto px-4 ${className}`}>{children}</div>
}

export function ConfirmButton({
  onConfirm,
  label = 'ลบ',
  confirmLabel = 'กดอีกครั้งเพื่อลบ',
  className = 'btn-ghost btn-sm text-bad-ink',
}: {
  onConfirm: () => void
  label?: string
  confirmLabel?: string
  className?: string
}) {
  const armed = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const labelRef = useRef<HTMLSpanElement>(null)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (armed.current) {
          window.clearTimeout(timer.current)
          armed.current = false
          onConfirm()
          return
        }
        armed.current = true
        if (labelRef.current) labelRef.current.textContent = confirmLabel
        timer.current = window.setTimeout(() => {
          armed.current = false
          if (labelRef.current) labelRef.current.textContent = label
        }, 3000)
      }}
    >
      <span ref={labelRef}>{label}</span>
    </button>
  )
}
