import type { MenuForecast } from '../lib/forecast'
import { SERVICE_LEVELS, steadiness } from '../lib/forecast'
import { baht, num } from '../lib/format'
import { Card, Chip, Empty } from './ui'

/* ===========================================================================
   การ์ด "พรุ่งนี้ควรทำเท่าไหร่" บนหน้าสรุป
   แสดงค่าเฉลี่ย ส่วนเบี่ยงเบนมาตรฐาน และจำนวนที่แนะนำให้ผลิต
=========================================================================== */

const TONE_TEXT = { good: 'text-good-ink', warn: 'text-warn-ink', bad: 'text-bad-ink' } as const

export default function ForecastCard({
  rows,
  servicePct,
  onServiceChange,
  forLabel,
}: {
  rows: MenuForecast[]
  servicePct: number
  onServiceChange: (pct: number) => void
  /** วันที่จะเอาไปขาย เช่น "พรุ่งนี้" */
  forLabel: string
}) {
  const level = SERVICE_LEVELS.find((l) => l.pct === servicePct) ?? SERVICE_LEVELS[1]
  const totalMake = rows.reduce((s, r) => s + r.make, 0)
  const totalCost = rows.reduce((s, r) => s + r.make * r.costPerUnit, 0)
  const thin = rows.filter((r) => r.stats.n < 3)

  return (
    <Card
      title={`${forLabel}ควรทำเท่าไหร่`}
      subtitle="คำนวณจากยอดขายจริงย้อนหลังในช่วงที่เลือก — ค่าเฉลี่ยบวกเผื่อตามความเหวี่ยงของยอดขาย"
    >
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {SERVICE_LEVELS.map((l) => (
          <button
            key={l.pct}
            type="button"
            onClick={() => onServiceChange(l.pct)}
            className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
              l.pct === servicePct ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink-2 hover:bg-surface-3'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[12.5px] text-ink-3">{level.hint}</p>

      {!rows.length ? (
        <Empty
          icon="chart"
          title="ยังคาดการณ์ไม่ได้"
          hint="ต้องมีการผลิตหรือการขายอย่างน้อย 1 วันในช่วงที่เลือกก่อน แล้วตัวเลขจะขึ้นที่นี่เอง"
        />
      ) : (
        <>
          <ul className="mt-3 divide-y divide-line">
            {rows.map((r) => (
              <ForecastRow key={r.recipeId} row={r} />
            ))}
          </ul>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px] text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1 w-4 rounded-full bg-surface-3" /> ต่ำสุด–สูงสุด
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-full bg-s1/30" /> ช่วง ± SD
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3.5 w-0.5 rounded bg-s1" /> ค่าเฉลี่ย
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3.5 w-[3px] rounded bg-brand" /> ที่แนะนำ
            </span>
          </div>

          <dl className="mt-3 space-y-1.5 rounded-xl bg-surface-2 p-3 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">รวมที่ควรทำทั้งหมด</dt>
              <dd className="tnum font-semibold text-ink">{num(totalMake)} ชิ้น/กล่อง</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">ต้นทุนที่ต้องใช้โดยประมาณ</dt>
              <dd className="tnum font-semibold text-ink">{baht(totalCost, 0)} บาท</dd>
            </div>
          </dl>
        </>
      )}

      {thin.length > 0 && (
        <p className="mt-3 rounded-xl bg-warn/15 px-3 py-2.5 text-[12.5px] leading-relaxed text-warn-ink">
          <strong className="font-semibold">ข้อมูลยังน้อย</strong> — {thin.map((r) => r.name).join(', ')} มีข้อมูลไม่ถึง 3 วัน
          ตัวเลขที่แนะนำจึงยังเชื่อได้ไม่มาก บันทึกยอดขายไปสักพักแล้วค่อยกลับมาดูอีกที
        </p>
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
        สูตรที่ใช้: <strong className="font-medium text-ink-2">ควรมีพร้อมขาย = ค่าเฉลี่ย + ({num(level.z, 2)} × ส่วนเบี่ยงเบนมาตรฐาน)</strong>
        {' '}แล้วหักของที่ยังเหลือพร้อมขายออก
        <br />
        นับเฉพาะวันที่ร้านมีเมนูนั้นขายจริง วันที่ไม่ได้ทำไม่ถูกนับเป็นศูนย์
        ตัวเลขนี้เป็นตัวช่วยตัดสินใจ ไม่ได้รวมเทศกาล วันหยุด หรือออร์เดอร์ที่รับไว้ล่วงหน้า
      </p>
    </Card>
  )
}

function ForecastRow({ row }: { row: MenuForecast }) {
  const { stats: st } = row
  const steady = steadiness(st.cv)
  const buffer = Math.max(0, row.target - st.mean)

  // แถบแสดงการกระจายตัว: ช่วงต่ำสุด-สูงสุด กับแถบ ค่าเฉลี่ย ± SD และหมุดตรงจำนวนที่แนะนำ
  const scale = Math.max(st.max, row.target, 1) * 1.08
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scale) * 100))}%`
  const bandLo = Math.max(0, st.mean - st.sd)
  const bandHi = st.mean + st.sd

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[14.5px] font-semibold text-ink">{row.name}</span>
        <span className="shrink-0 text-[13px] text-ink-3">
          ควรทำ{' '}
          <strong className="text-[17px] font-bold tnum text-brand">{num(row.make)}</strong> {row.unit}
        </span>
      </div>

      <p className="mt-1 text-[12.5px] text-ink-2 tnum">
        ขายเฉลี่ย <strong className="font-semibold text-ink">{num(st.mean, 1)}</strong> ± {num(st.sd, 1)} {row.unit}/วัน
        <span className="text-ink-3">
          {' · '}
          {num(st.n)} วัน · ต่ำสุด {num(st.min)} สูงสุด {num(st.max)}
        </span>
      </p>

      <div className="relative mt-2 h-6" aria-hidden="true">
        {/* ช่วงต่ำสุด-สูงสุดที่เคยขายได้ */}
        <div
          className="absolute top-2.5 h-1 rounded-full bg-surface-3"
          style={{ left: pct(st.min), width: pct(Math.max(0, st.max - st.min)) }}
        />
        {/* ช่วงค่าเฉลี่ย ± SD */}
        <div
          className="absolute top-1.5 h-3 rounded-full bg-s1/30"
          style={{ left: pct(bandLo), width: pct(Math.max(0, bandHi - bandLo)) }}
        />
        {/* ค่าเฉลี่ย */}
        <div className="absolute top-0.5 h-5 w-0.5 rounded bg-s1" style={{ left: pct(st.mean) }} />
        {/* จำนวนที่แนะนำให้มีพร้อมขาย */}
        <div className="absolute top-0 h-6 w-[3px] rounded bg-brand" style={{ left: pct(row.target) }} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span className={`font-medium ${TONE_TEXT[steady.tone]}`}>{steady.label}</span>
        <span className="text-ink-3 tnum">
          ควรมีพร้อมขาย {num(row.target)} {row.unit}
          {buffer >= 0.5 && ` (เผื่อไว้ ${num(buffer, 1)})`}
        </span>
        {row.ready > 0 && (
          <Chip tone="warn">
            มีของค้าง {num(row.ready)} {row.unit} — หักให้แล้ว
          </Chip>
        )}
        {row.make === 0 && row.ready > 0 && <Chip tone="good">ของที่เหลือพอขายแล้ว ไม่ต้องทำเพิ่ม</Chip>}
      </div>
    </li>
  )
}
