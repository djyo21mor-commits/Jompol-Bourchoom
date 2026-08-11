import { useLayoutEffect, useRef, useState } from 'react'
import type { DaySeriesPoint, MenuStat } from '../lib/calc'
import { baht, dateText, num } from '../lib/format'

/* ===========================================================================
   กราฟทั้งหมดวาดด้วย SVG ตรงๆ ไม่พึ่งไลบรารีภายนอก
   สีชุดนี้ผ่านการตรวจ contrast และการมองเห็นสีบกพร่องแล้ว (ดู docs/palette.md)
   ทุกกราฟมีทั้ง "ป้ายตัวเลขบนกราฟ" และ "มุมมองตาราง" เพื่อไม่ให้สีเป็นตัวสื่อความหมายเพียงอย่างเดียว
=========================================================================== */

/** วัดความกว้างจริงของกล่อง เพื่อวาด SVG ตามขนาดพิกเซลจริง (ตัวหนังสือจะได้ไม่ยืด) */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** สี่เหลี่ยมที่มนเฉพาะปลายด้านบน — ฐานแท่งยังชนเส้นศูนย์สนิท */
function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0.5) return ''
  const rr = Math.min(r, w / 2, h)
  return `M${x} ${y + h} L${x} ${y + rr} Q${x} ${y} ${x + rr} ${y} L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} L${x + w} ${y + h} Z`
}

/**
 * เลือกขั้นแกนที่ลงตัวสวยๆ (1 / 2 / 2.5 / 5 × 10^n)
 * ขีดบนสุดต้องสูงกว่าค่ามากสุดเสมอ ไม่งั้นแท่งจะทะลุกรอบกราฟ
 */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0]
  const rough = max / count
  const mag = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? mag * 10
  const top = Math.ceil(max / step - 1e-9) * step
  const ticks: number[] = []
  for (let v = 0; v <= top + step * 0.001; v += step) ticks.push(v)
  return ticks
}

function shortBaht(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${num(v / 1_000_000, 1)}ล.`
  if (Math.abs(v) >= 1000) return `${num(v / 1000, 1)}พ.`
  return num(v, 0)
}

/* --------------------------------------------------------------------------
   กราฟแท่งรายวัน: ยอดขาย เทียบ ต้นทุนผลิต
-------------------------------------------------------------------------- */

export function DailyBars({ series }: { series: DaySeriesPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)

  const data = series.slice(-31)
  const hasAny = data.some((d) => d.revenue > 0 || d.cost > 0)

  if (!hasAny) {
    return (
      <p className="py-8 text-center text-[13.5px] text-ink-3">
        ยังไม่มียอดขายหรือการผลิตในช่วงนี้
      </p>
    )
  }

  const H = 210
  const PAD = { top: 18, right: 8, bottom: 26, left: 40 }
  const W = Math.max(width, 260)
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const max = Math.max(...data.map((d) => Math.max(d.revenue, d.cost)), 1)
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1]
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH

  const slot = plotW / data.length
  const groupW = Math.max(6, Math.min(slot - 4, 34))
  const barW = (groupW - 2) / 2 // เว้นช่องว่าง 2px ระหว่างสองแท่ง
  // ติดป้ายตัวเลขไว้เฉพาะวันที่ยอดขายสูงสุด — วางเหนือแท่งที่สูงกว่าในกลุ่ม จะได้ไม่ทับกัน
  const peak = data.reduce((best, d, i) => (d.revenue > data[best].revenue ? i : best), 0)
  const peakTop = Math.max(data[peak].revenue, data[peak].cost)

  const legend = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-ink-2">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-s1" /> ยอดขาย
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-s2" /> ต้นทุนผลิต
      </span>
      <button
        type="button"
        onClick={() => setAsTable((v) => !v)}
        className="ml-auto text-[12.5px] font-medium text-brand hover:underline"
      >
        {asTable ? 'ดูเป็นกราฟ' : 'ดูเป็นตาราง'}
      </button>
    </div>
  )

  if (asTable) {
    return (
      <div className="space-y-3">
        {legend}
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-[13px] tnum">
            <thead className="sticky top-0 bg-surface text-ink-3">
              <tr className="text-left">
                <th className="py-1.5 font-medium">วันที่</th>
                <th className="py-1.5 text-right font-medium">ยอดขาย</th>
                <th className="py-1.5 text-right font-medium">ต้นทุนผลิต</th>
                <th className="py-1.5 text-right font-medium">กำไร</th>
              </tr>
            </thead>
            <tbody>
              {data
                .filter((d) => d.revenue > 0 || d.cost > 0)
                .reverse()
                .map((d) => (
                  <tr key={d.date} className="border-t border-line">
                    <td className="py-1.5">{dateText(d.date)}</td>
                    <td className="py-1.5 text-right">{baht(d.revenue, 0)}</td>
                    <td className="py-1.5 text-right">{baht(d.cost, 0)}</td>
                    <td className={`py-1.5 text-right font-medium ${d.profit < 0 ? 'text-bad-ink' : 'text-good-ink'}`}>
                      {baht(d.profit, 0)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const active = hover !== null ? data[hover] : null

  return (
    <div className="space-y-2.5">
      {legend}
      <div ref={ref} className="relative">
        {width > 0 && (
          <svg width={W} height={H} role="img" aria-label="กราฟยอดขายและต้นทุนรายวัน">
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--c-grid)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="fill-[var(--c-ink-3)] text-[10px] tnum">
                  {shortBaht(t)}
                </text>
              </g>
            ))}

            {data.map((d, i) => {
              const cx = PAD.left + slot * i + slot / 2
              const x0 = cx - groupW / 2
              return (
                <g key={d.date}>
                  <path d={barPath(x0, y(d.revenue), barW, plotH - (y(d.revenue) - PAD.top))} fill="var(--c-s1)" />
                  <path
                    d={barPath(x0 + barW + 2, y(d.cost), barW, plotH - (y(d.cost) - PAD.top))}
                    fill="var(--c-s2)"
                  />
                  {i === peak && d.revenue > 0 && (
                    <text
                      x={cx}
                      y={y(peakTop) - 6}
                      textAnchor="middle"
                      className="fill-[var(--c-ink-2)] text-[10px] font-semibold tnum"
                    >
                      {shortBaht(d.revenue)}
                    </text>
                  )}
                </g>
              )
            })}

            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={PAD.top + plotH}
              y2={PAD.top + plotH}
              stroke="var(--c-axis)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />

            {data.map((d, i) => {
              const cx = PAD.left + slot * i + slot / 2
              const showLabel = data.length <= 10 || i % Math.ceil(data.length / 8) === 0
              return showLabel ? (
                <text key={d.date} x={cx} y={H - 8} textAnchor="middle" className="fill-[var(--c-ink-3)] text-[10px]">
                  {dateText(d.date).replace(' ', ' ')}
                </text>
              ) : null
            })}

            {/* พื้นที่รับการชี้ — กว้างกว่าแท่งจริง เพื่อให้นิ้วแตะง่าย */}
            {data.map((d, i) => (
              <rect
                key={d.date}
                x={PAD.left + slot * i}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
              />
            ))}

            {hover !== null && (
              <line
                x1={PAD.left + slot * hover + slot / 2}
                x2={PAD.left + slot * hover + slot / 2}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--c-axis)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}
          </svg>
        )}

        {active && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-xl border border-line bg-surface p-2.5 text-[12.5px] shadow-lg"
            style={{
              left: Math.min(Math.max(PAD.left + slot * (hover ?? 0) + slot / 2 - 72, 0), Math.max(W - 150, 0)),
            }}
          >
            <div className="font-semibold text-ink">{dateText(active.date, true)}</div>
            <div className="mt-1 space-y-0.5 tnum">
              <div className="flex justify-between gap-4">
                <span className="text-ink-3">ยอดขาย</span>
                <span className="font-medium">{baht(active.revenue, 0)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-ink-3">ต้นทุนผลิต</span>
                <span className="font-medium">{baht(active.cost, 0)}</span>
              </div>
              <div className="flex justify-between gap-4 border-t border-line pt-0.5">
                <span className="text-ink-3">กำไร</span>
                <span className={`font-semibold ${active.profit < 0 ? 'text-bad-ink' : 'text-good-ink'}`}>
                  {baht(active.profit, 0)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------------------
   อันดับเมนู — แท่งแนวนอนพร้อมป้ายตัวเลขตรงๆ ทุกแท่ง
-------------------------------------------------------------------------- */

export function MenuRanking({ data, unit = 'กล่อง' }: { data: MenuStat[]; unit?: string }) {
  if (!data.length) {
    return <p className="py-8 text-center text-[13.5px] text-ink-3">ยังไม่มีการขายในช่วงนี้</p>
  }
  const max = Math.max(...data.map((d) => d.revenue), 1)

  return (
    <ul className="space-y-3">
      {data.slice(0, 8).map((m) => {
        const pct = (m.revenue / max) * 100
        const marginPct = m.revenue > 0 ? (m.profit / m.revenue) * 100 : 0
        return (
          <li key={m.recipeId}>
            <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
              <span className="truncate font-medium text-ink">{m.name}</span>
              <span className="shrink-0 tnum font-semibold text-ink">{baht(m.revenue, 0)} บาท</span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-s1" style={{ width: `${Math.max(pct, 2)}%` }} />
            </div>
            <div className="mt-1 flex justify-between gap-3 text-[12px] text-ink-3 tnum">
              <span>
                ขาย {num(m.qty)} {m.unit || unit}
              </span>
              <span className={m.profit < 0 ? 'text-bad-ink' : ''}>
                กำไร {baht(m.profit, 0)} บาท ({num(marginPct, 0)}%)
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/* --------------------------------------------------------------------------
   อันดับทั่วไป — ใช้กับหมวดหมู่รายรับ-รายจ่าย
   ใช้แท่งความยาวสื่อขนาดแทนการไล่สี เพราะหมวดหมู่มีได้ไม่จำกัด
   ถ้าไล่สีจะเกินจำนวนสีที่แยกออกจากกันได้จริง
-------------------------------------------------------------------------- */

export function RankBars({
  rows,
  tone = 'neutral',
  emptyText = 'ยังไม่มีข้อมูล',
}: {
  rows: { label: string; amount: number; sub?: string }[]
  tone?: 'good' | 'bad' | 'neutral'
  emptyText?: string
}) {
  if (!rows.length) return <p className="py-6 text-center text-[13.5px] text-ink-3">{emptyText}</p>
  const max = Math.max(...rows.map((r) => r.amount), 1)
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const barColor = tone === 'good' ? 'bg-good' : tone === 'bad' ? 'bg-bad' : 'bg-s1'

  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
            <span className="truncate font-medium text-ink">{r.label}</span>
            <span className="shrink-0 tnum font-semibold text-ink">{baht(r.amount, 0)} บาท</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.max((r.amount / max) * 100, 2)}%` }} />
            </div>
            <span className="w-16 shrink-0 text-right text-[12px] text-ink-3 tnum">
              {total > 0 ? `${num((r.amount / total) * 100, 0)}%` : '—'}
            </span>
          </div>
          {r.sub && <p className="mt-0.5 text-[12px] text-ink-3">{r.sub}</p>}
        </li>
      ))}
    </ul>
  )
}

/* --------------------------------------------------------------------------
   แถบสัดส่วนต้นทุน: วัตถุดิบ / ค่าแรง / ค่าน้ำ / ค่าไฟ / จิปาถะ
-------------------------------------------------------------------------- */

export function CostBreakdownBar({
  parts,
}: {
  parts: { label: string; value: number; color: string }[]
}) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  if (total <= 0) return null
  const shown = parts.filter((p) => p.value > 0)

  return (
    <div className="space-y-2.5">
      {/* เว้นช่องว่าง 2px ระหว่างส่วนต่างๆ ให้เห็นขอบชัดแม้สีใกล้กัน */}
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
        {shown.map((p) => (
          <div
            key={p.label}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-3">
        {shown.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />
            <span className="truncate text-ink-2">{p.label}</span>
            <span className="ml-auto shrink-0 tnum font-medium text-ink">{num((p.value / total) * 100, 0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
