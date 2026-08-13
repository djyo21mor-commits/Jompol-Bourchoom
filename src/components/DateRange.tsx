import { addDays, dateText, today } from '../lib/format'
import { monthLabel, monthRange, shiftMonth } from '../lib/money'

/* ===========================================================================
   ตัวเลือกช่วงวันที่ ใช้ร่วมกันทั้งหน้าสรุปการขายและหน้าบัญชี
   กดปุ่มสำเร็จรูปก็ได้ หรือเลือกเองว่าตั้งแต่วันไหนถึงวันไหน
=========================================================================== */

export type RangeKey = 'today' | '7d' | '30d' | 'month' | 'lastMonth' | 'custom'

export interface RangeValue {
  key: RangeKey
  from: string
  to: string
}

export const RANGE_LABEL: Record<RangeKey, string> = {
  today: 'วันนี้',
  '7d': '7 วัน',
  '30d': '30 วัน',
  month: 'เดือนนี้',
  lastMonth: 'เดือนก่อน',
  custom: 'เลือกวันเอง',
}

/** ช่วงวันที่ของปุ่มสำเร็จรูปแต่ละปุ่ม คิดจากวันนี้เสมอ */
export function presetRange(key: Exclude<RangeKey, 'custom'>): RangeValue {
  const to = today()
  switch (key) {
    case 'today':
      return { key, from: to, to }
    case '7d':
      return { key, from: addDays(to, -6), to }
    case '30d':
      return { key, from: addDays(to, -29), to }
    case 'month':
      return { key, ...monthRange(to.slice(0, 7)) }
    case 'lastMonth':
      return { key, ...monthRange(shiftMonth(to.slice(0, 7), -1)) }
  }
}

/** ตรงกับเดือนปฏิทินพอดีไหม — ถ้าใช่จะได้เรียกชื่อเดือนแทนช่วงวันที่ */
function wholeMonth(value: RangeValue): boolean {
  const m = value.from.slice(0, 7)
  if (value.to.slice(0, 7) !== m) return false
  const r = monthRange(m)
  return r.from === value.from && r.to === value.to
}

/** ข้อความบอกช่วงที่กำลังดูอยู่ */
export function rangeLabel(value: RangeValue): string {
  if (value.from === value.to) return dateText(value.from)
  if (wholeMonth(value)) return monthLabel(value.from.slice(0, 7))
  return `${dateText(value.from)} – ${dateText(value.to)}`
}

export default function DateRangePicker({
  value,
  onChange,
  presets = ['today', '7d', '30d', 'month'],
}: {
  value: RangeValue
  onChange: (next: RangeValue) => void
  presets?: Exclude<RangeKey, 'custom'>[]
}) {
  const custom = value.key === 'custom'

  /** เลือกวันสลับหัวท้าย ให้จัดเรียงให้เอง จะได้ไม่เจอช่วงว่างเปล่า */
  function setCustom(from: string, to: string) {
    if (!from || !to) return
    onChange(from <= to ? { key: 'custom', from, to } : { key: 'custom', from: to, to: from })
  }

  return (
    <div className="w-full">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {presets.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(presetRange(key))}
            className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
              value.key === key ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink-2 hover:bg-surface-3'
            }`}
          >
            {RANGE_LABEL[key]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange({ key: 'custom', from: value.from, to: value.to })}
          className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
            custom ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink-2 hover:bg-surface-3'
          }`}
        >
          {RANGE_LABEL.custom}
        </button>
      </div>

      {custom && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[12px] text-ink-3">ตั้งแต่วันที่</span>
            <input
              type="date"
              className="field h-10 w-full !py-1.5 text-[13.5px]"
              value={value.from}
              max={value.to}
              onChange={(e) => setCustom(e.target.value, value.to)}
            />
          </label>
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[12px] text-ink-3">ถึงวันที่</span>
            <input
              type="date"
              className="field h-10 w-full !py-1.5 text-[13.5px]"
              value={value.to}
              min={value.from}
              onChange={(e) => setCustom(value.from, e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  )
}
