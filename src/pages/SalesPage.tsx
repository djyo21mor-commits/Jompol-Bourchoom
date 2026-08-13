import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { readDailySheet, type DailySheetRow } from '../lib/engine'
import { recipeCost, suggestPrice } from '../lib/calc'
import { addDays, baht, dateText, dayLabel, money, num, today } from '../lib/format'
import { Card, Empty, Field, Icon, Modal, NumberInput, Stat } from '../components/ui'

/**
 * ตารางบันทึกรายวัน — เรียงเมนูทั้งหมดที่ตั้งสูตรไว้
 * กรอกแค่ "ทำเท่าไหร่" กับ "เหลือเท่าไหร่" ระบบคิด "ขายได้" ให้เอง
 */
export default function SalesPage() {
  const { state, dispatch } = useStore()
  const [date, setDate] = useState(today())
  const [editing, setEditing] = useState<DailySheetRow | null>(null)

  const rows = useMemo(() => readDailySheet(state, date), [state, date])
  const active = rows.filter((r) => r.produced > 0)

  const totals = active.reduce(
    (acc, r) => ({
      produced: acc.produced + r.produced,
      leftover: acc.leftover + r.leftover,
      sold: acc.sold + r.sold,
      revenue: acc.revenue + r.revenue,
      cost: acc.cost + r.cost,
    }),
    { produced: 0, leftover: 0, sold: 0, revenue: 0, cost: 0 },
  )
  const profit = totals.revenue - totals.cost

  // ของที่ยกมาจากเมื่อวาน ยังขายได้วันนี้
  const carried = useMemo(
    () => state.lots.filter((l) => l.remaining > 1e-9 && l.carriedOver && l.sellDate <= date),
    [state.lots, date],
  )

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-bold text-ink">บันทึกการขายรายวัน</h1>
          <p className="text-[13px] text-ink-3">
            {dayLabel(date)} · {dateText(date, true)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="วันก่อนหน้า"
            onClick={() => setDate((d) => addDays(d, -1))}
            className="btn-outline !px-2.5"
          >
            <Icon name="chevron" className="size-4 rotate-180" />
          </button>
          <input type="date" className="field w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
          <button
            type="button"
            aria-label="วันถัดไป"
            onClick={() => setDate((d) => addDays(d, 1))}
            disabled={date >= today()}
            className="btn-outline !px-2.5 disabled:opacity-40"
          >
            <Icon name="chevron" className="size-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="ทำไป" value={num(totals.produced)} sub="ชิ้น/กล่อง" />
        <Stat label="ขายได้" value={num(totals.sold)} sub="ทำ − เหลือ" tone="brand" />
        <Stat label="ยอดขาย" value={baht(totals.revenue, 0)} sub="บาท" tone="good" />
        <Stat
          label="กำไรวันนี้"
          value={baht(profit, 0)}
          sub="ยอดขาย − ต้นทุนที่ผลิต"
          tone={profit >= 0 ? 'good' : 'bad'}
        />
      </div>

      {carried.length > 0 && (
        <Card title="ของยกมาจากวันก่อน" subtitle="ขายได้เลยวันนี้ ไม่คิดต้นทุนซ้ำ">
          <ul className="space-y-1.5 text-[13.5px]">
            {carried.map((l) => (
              <li key={l.id} className="flex justify-between gap-3">
                <span className="text-ink-2">{l.recipeName}</span>
                <span className="tnum text-ink">
                  {num(l.remaining)} {l.unit} · ผลิต{dayLabel(l.date)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!state.recipes.length ? (
        <Card bodyClass="p-0">
          <Empty
            icon="book"
            title="ยังไม่มีเมนู"
            hint='ไปที่ช่องแชท "ของขาย" แล้วพิมพ์สูตรก่อน เช่น "สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม, กล่อง p39 20 กล่อง" เมนูจะมาโผล่ที่นี่เอง'
          />
        </Card>
      ) : (
        <Card title="เมนูทั้งหมด" subtitle="กดที่เมนูเพื่อกรอกว่าวันนี้ทำเท่าไหร่ เหลือเท่าไหร่">
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <li key={row.recipeId}>
                <button
                  type="button"
                  onClick={() => setEditing(row)}
                  className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold text-ink">{row.name}</div>
                    {row.produced > 0 ? (
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-ink-3 tnum">
                        <span>
                          ทำ {num(row.produced)} {row.unit}
                        </span>
                        <span>เหลือ {num(row.leftover)}</span>
                        <span className="font-semibold text-ink-2">ขายได้ {num(row.sold)}</span>
                      </div>
                    ) : (
                      <p className="mt-0.5 text-[12.5px] text-ink-3">ยังไม่ได้บันทึกวันนี้</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[15px] font-bold tnum text-ink">{baht(row.revenue, 0)}</div>
                    {row.produced > 0 && (
                      <div className={`text-[12px] tnum ${row.profit >= 0 ? 'text-good-ink' : 'text-bad-ink'}`}>
                        กำไร {baht(row.profit, 0)}
                      </div>
                    )}
                  </div>
                  <Icon name="chevron" className="size-4 shrink-0 text-ink-3" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <DailyEditor
          key={editing.recipeId + date}
          row={editing}
          date={date}
          onClose={() => setEditing(null)}
          onSave={(produced, leftover, unitPrice) => {
            dispatch({ type: 'daily/save', recipeId: editing.recipeId, date, produced, leftover, unitPrice })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function DailyEditor({
  row,
  date,
  onClose,
  onSave,
}: {
  row: DailySheetRow
  date: string
  onClose: () => void
  onSave: (produced: number, leftover: number, unitPrice: number) => void
}) {
  const { state } = useStore()
  const recipe = state.recipes.find((r) => r.id === row.recipeId)!
  const [produced, setProduced] = useState(row.produced)
  const [leftover, setLeftover] = useState(row.leftover)
  const [unitPrice, setUnitPrice] = useState(() => {
    if (row.unitPrice > 0) return row.unitPrice
    if (recipe.price > 0) return recipe.price
    const cost = recipeCost(recipe, state.items)
    return suggestPrice(cost.costPerUnit, recipe.marginPct || state.settings.defaultMarginPct, state.settings.priceMode, state.settings.priceRounding).price
  })

  const sold = Math.max(0, produced - Math.min(leftover, produced))
  const scale = recipe.yieldQty > 0 ? produced / recipe.yieldQty : 0
  const cost = recipeCost(recipe, state.items, scale)
  const revenue = sold * unitPrice
  const profit = revenue - cost.totalCost
  const short = cost.lines.filter((l) => !l.enough)

  return (
    <Modal
      open
      onClose={onClose}
      title={`${recipe.name} · ${dayLabel(date)}`}
      footer={
        <button type="button" onClick={() => onSave(produced, leftover, unitPrice)} className="btn-primary w-full">
          {produced > 0 ? `บันทึก — ขายได้ ${num(sold)} ${recipe.yieldUnit}` : 'ล้างยอดของวันนี้'}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="วันนี้ทำไปเท่าไหร่">
            <NumberInput value={produced} onChange={setProduced} min={0} suffix={recipe.yieldUnit} />
          </Field>
          <Field label="เหลือเท่าไหร่" hint="ใส่ 0 ถ้าขายหมด">
            <NumberInput value={leftover} onChange={setLeftover} min={0} suffix={recipe.yieldUnit} />
          </Field>
        </div>

        <div className="rounded-xl bg-brand-soft px-3.5 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13.5px] text-ink-2">ขายได้ (ทำ − เหลือ)</span>
            <span className="text-[24px] font-bold leading-none tnum text-brand">
              {num(sold)} <span className="text-[14px] font-semibold">{recipe.yieldUnit}</span>
            </span>
          </div>
        </div>

        <Field label={`ราคาขายต่อ${recipe.yieldUnit}`}>
          <NumberInput value={unitPrice} onChange={setUnitPrice} suffix="บาท" />
        </Field>

        <dl className="space-y-1.5 rounded-xl bg-surface-2 p-3 text-[13.5px]">
          <Row label="ยอดขาย" value={money(revenue)} />
          <Row label={`ต้นทุนต่อ${recipe.yieldUnit}`} value={money(cost.costPerUnit, 2)} />
          <Row label="ต้นทุนที่ผลิตวันนี้" value={money(cost.totalCost, 2)} />
          <div className="flex items-baseline justify-between gap-3 border-t border-line pt-1.5">
            <dt className="font-semibold text-ink">กำไรวันนี้</dt>
            <dd className={`text-[16px] font-bold tnum ${profit >= 0 ? 'text-good-ink' : 'text-bad-ink'}`}>
              {money(profit, 2)}
            </dd>
          </div>
        </dl>

        {leftover > 0 && (
          <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2">
            ของเหลือ {num(Math.min(leftover, produced))} {recipe.yieldUnit} จะยกไปขาย{dayLabel(addDays(date, 1))}{' '}
            โดยไม่คิดต้นทุนซ้ำ ขายได้เมื่อไหร่เป็นกำไรเต็มจำนวน
          </p>
        )}

        {short.length > 0 && produced > 0 && (
          <p className="rounded-xl bg-warn/15 px-3 py-2.5 text-[13px] text-warn-ink">
            วัตถุดิบไม่พอ {short.length} รายการ ({short.map((l) => l.name).join(', ')}) — บันทึกได้ แต่สต็อกจะติดลบ
          </p>
        )}
        {cost.unpriced.length > 0 && (
          <p className="rounded-xl bg-warn/15 px-3 py-2.5 text-[13px] text-warn-ink">
            ยังไม่รู้ราคาของ {cost.unpriced.join(', ')} — ต้นทุนที่คิดได้ยังไม่ครบ
          </p>
        )}
      </div>
    </Modal>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="tnum font-medium text-ink">{value}</dd>
    </div>
  )
}
