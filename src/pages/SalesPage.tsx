import { useMemo, useState } from 'react'
import type { Lot, Recipe } from '../types'
import { useStore } from '../lib/store'
import { finishedStock, profitAt, recipeCost, sellableLots, suggestPrice } from '../lib/calc'
import { addDays, baht, dateText, dayLabel, money, num, today } from '../lib/format'
import { Card, Chip, ConfirmButton, Empty, Field, Icon, Modal, NumberInput, Stat } from '../components/ui'

export default function SalesPage() {
  const { state, dispatch } = useStore()
  const [date, setDate] = useState(today())
  const [selling, setSelling] = useState<Recipe | null>(null)
  const [leftover, setLeftover] = useState<Recipe | null>(null)

  const daySales = useMemo(
    () => state.sales.filter((s) => s.date === date).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [state.sales, date],
  )

  const revenue = daySales.reduce((s, x) => s + x.revenue, 0)
  const cost = daySales.reduce((s, x) => s + x.cost, 0)
  const qty = daySales.reduce((s, x) => s + x.qty, 0)

  const ready = useMemo(
    () =>
      state.recipes
        .map((r) => ({ recipe: r, lots: sellableLots(state.lots, r.id, date) }))
        .filter((x) => x.lots.length > 0),
    [state.recipes, state.lots, date],
  )

  const pending = useMemo(
    () => state.lots.filter((l) => l.remaining > 1e-9 && l.sellDate > date),
    [state.lots, date],
  )

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-bold text-ink">การขาย</h1>
          <p className="text-[13px] text-ink-3">{dayLabel(date)} · {dateText(date, true)}</p>
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

      <div className="grid grid-cols-3 gap-3">
        <Stat label="ยอดขาย" value={baht(revenue, 0)} sub="บาท" tone="brand" />
        <Stat label="กำไรจากการขาย" value={baht(revenue - cost, 0)} sub="บาท" tone={revenue - cost >= 0 ? 'good' : 'bad'} />
        <Stat label="ขายไปแล้ว" value={num(qty)} sub={`${daySales.length} รายการ`} />
      </div>

      {/* --------------------------- ขนมที่พร้อมขาย --------------------------- */}
      <Card title="ขนมที่พร้อมขาย" subtitle="กดที่เมนูเพื่อบันทึกการขาย">
        {!ready.length ? (
          <Empty
            icon="box"
            title="ยังไม่มีขนมพร้อมขาย"
            hint='บันทึกการผลิตก่อน โดยพิมพ์ในแชทว่า "ทำเค้กมะม่วง 20 กล่อง" หรือกดบันทึกการผลิตในหน้าเมนู'
          />
        ) : (
          <ul className="space-y-2">
            {ready.map(({ recipe, lots }) => (
              <ReadyRow
                key={recipe.id}
                recipe={recipe}
                lots={lots}
                onSell={() => setSelling(recipe)}
                onLeftover={() => setLeftover(recipe)}
              />
            ))}
          </ul>
        )}

        {pending.length > 0 && (
          <div className="mt-3 rounded-xl bg-surface-2 p-3">
            <h3 className="text-[13px] font-semibold text-ink-2">เตรียมไว้ขายวันถัดไป</h3>
            <ul className="mt-1.5 space-y-1 text-[13px]">
              {pending.map((l) => (
                <li key={l.id} className="flex justify-between gap-3">
                  <span className="text-ink-2">{l.recipeName}</span>
                  <span className="tnum text-ink-3">
                    {num(l.remaining)} {l.unit} · พร้อมขาย{dayLabel(l.sellDate)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* ----------------------------- รายการขาย ----------------------------- */}
      <Card title={`รายการขาย ${dayLabel(date)}`} subtitle={daySales.length ? undefined : 'ยังไม่มีการขายในวันนี้'}>
        {!daySales.length ? (
          <Empty icon="cart" title="ยังไม่มีการขาย" hint='พิมพ์ในแชทได้เลย เช่น "ขายเค้กมะม่วง 15 กล่อง กล่องละ 120"' />
        ) : (
          <ul className="divide-y divide-line">
            {daySales.map((sale) => (
              <li key={sale.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-medium text-ink">{sale.recipeName}</div>
                  <div className="text-[12.5px] text-ink-3 tnum">
                    {num(sale.qty)} {sale.unit} × {baht(sale.unitPrice, 0)} บาท
                    {sale.cost === 0 && sale.revenue > 0 && ' · ของยกมา ไม่คิดทุนซ้ำ'}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[15px] font-bold tnum text-ink">{baht(sale.revenue, 0)}</div>
                  <div className={`text-[12px] tnum ${sale.revenue - sale.cost >= 0 ? 'text-good-ink' : 'text-bad-ink'}`}>
                    กำไร {baht(sale.revenue - sale.cost, 0)}
                  </div>
                </div>
                <ConfirmButton
                  onConfirm={() => dispatch({ type: 'sale/delete', id: sale.id })}
                  label="ลบ"
                  confirmLabel="ยืนยันลบ"
                  className="btn-ghost btn-sm shrink-0 text-ink-3"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selling && (
        <SellDialog
          recipe={selling}
          date={date}
          onClose={() => setSelling(null)}
          onConfirm={(q, price) => {
            dispatch({ type: 'sale/add', recipeId: selling.id, qty: q, unitPrice: price, date })
            setSelling(null)
          }}
        />
      )}

      {leftover && (
        <LeftoverDialog
          recipe={leftover}
          date={date}
          onClose={() => setLeftover(null)}
          onCarry={(q) => {
            dispatch({ type: 'lot/carryover', recipeId: leftover.id, qty: q, date })
            setLeftover(null)
          }}
          onWaste={(q, reason) => {
            dispatch({ type: 'lot/waste', recipeId: leftover.id, qty: q, date, reason })
            setLeftover(null)
          }}
        />
      )}
    </div>
  )
}

function ReadyRow({
  recipe,
  lots,
  onSell,
  onLeftover,
}: {
  recipe: Recipe
  lots: Lot[]
  onSell: () => void
  onLeftover: () => void
}) {
  const total = lots.reduce((s, l) => s + l.remaining, 0)
  const carried = lots.filter((l) => l.carriedOver).reduce((s, l) => s + l.remaining, 0)

  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-ink">{recipe.name}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Chip tone="brand">
              พร้อมขาย {num(total)} {recipe.yieldUnit}
            </Chip>
            {carried > 0 && (
              <Chip tone="warn">
                ยกมา {num(carried)} {recipe.yieldUnit} · ทุน 0
              </Chip>
            )}
            {recipe.price > 0 && <Chip>ราคา {baht(recipe.price, 0)} บาท</Chip>}
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex gap-2">
        <button type="button" onClick={onSell} className="btn-primary btn-sm flex-1">
          บันทึกขาย
        </button>
        <button type="button" onClick={onLeftover} className="btn-outline btn-sm flex-1">
          ของเหลือ
        </button>
      </div>
    </li>
  )
}

function SellDialog({
  recipe,
  date,
  onClose,
  onConfirm,
}: {
  recipe: Recipe
  date: string
  onClose: () => void
  onConfirm: (qty: number, price: number) => void
}) {
  const { state } = useStore()
  const available = finishedStock(state.lots, recipe.id, date)
  const cost = recipeCost(recipe, state.items)
  const fallback = suggestPrice(
    cost.costPerUnit,
    recipe.marginPct || state.settings.defaultMarginPct,
    state.settings.priceMode,
    state.settings.priceRounding,
  ).price

  const [qty, setQty] = useState(Math.min(1, available) || 1)
  const [price, setPrice] = useState(recipe.price > 0 ? recipe.price : fallback)

  const revenue = qty * price
  const margin = profitAt(price, cost.costPerUnit)

  return (
    <Modal
      open
      onClose={onClose}
      title={`บันทึกขาย · ${recipe.name}`}
      footer={
        <button
          type="button"
          onClick={() => onConfirm(qty, price)}
          disabled={qty <= 0 || price <= 0}
          className="btn-primary w-full"
        >
          บันทึกขาย {num(qty)} {recipe.yieldUnit} · {money(revenue)}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="จำนวน" hint={`พร้อมขาย ${num(available)} ${recipe.yieldUnit}`}>
            <NumberInput value={qty} onChange={setQty} min={0} suffix={recipe.yieldUnit} />
          </Field>
          <Field label={`ราคาต่อ${recipe.yieldUnit}`}>
            <NumberInput value={price} onChange={setPrice} suffix="บาท" />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          {[available, 5, 10, 20].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v) => (
            <button key={v} type="button" onClick={() => setQty(v)} className="btn-ghost btn-sm">
              {num(v)} {recipe.yieldUnit}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="ยอดขายรวม" value={baht(revenue, 0)} sub="บาท" tone="brand" />
          <Stat
            label="กำไรโดยประมาณ"
            value={baht(margin.profit * qty, 0)}
            sub={`${num(margin.markupPct, 0)}% ของทุน`}
            tone={margin.profit >= 0 ? 'good' : 'bad'}
          />
        </div>

        {qty > available && (
          <p className="rounded-xl bg-warn/15 px-3 py-2.5 text-[13px] text-warn-ink">
            มีของพร้อมขายแค่ {num(available)} {recipe.yieldUnit} — ระบบจะบันทึกเท่าที่มี แล้วเสนอให้บันทึกการผลิตเพิ่ม
          </p>
        )}
      </div>
    </Modal>
  )
}

function LeftoverDialog({
  recipe,
  date,
  onClose,
  onCarry,
  onWaste,
}: {
  recipe: Recipe
  date: string
  onClose: () => void
  onCarry: (qty: number) => void
  onWaste: (qty: number, reason?: string) => void
}) {
  const { state } = useStore()
  const available = finishedStock(state.lots, recipe.id, date)
  const [qty, setQty] = useState(available)
  const [reason, setReason] = useState('')

  return (
    <Modal open onClose={onClose} title={`ของเหลือ · ${recipe.name}`}>
      <div className="space-y-4">
        <Field label="จำนวนที่เหลือ" hint={`คงเหลือในระบบ ${num(available)} ${recipe.yieldUnit}`}>
          <NumberInput value={qty} onChange={setQty} min={0} suffix={recipe.yieldUnit} />
        </Field>

        <div className="rounded-xl border border-line p-3.5">
          <h3 className="text-[14px] font-semibold text-ink">ยังขายได้ — เก็บไว้ขายวันถัดไป</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
            ระบบจะเตรียมไว้ขาย{dayLabel(addDays(date, 1))} โดย<strong className="font-semibold">ไม่คิดต้นทุนซ้ำ</strong>
            เพราะคิดไปแล้วตอนผลิต เมื่อขายได้จะถือเป็นกำไรเต็มจำนวน
          </p>
          <button type="button" onClick={() => onCarry(qty)} disabled={qty <= 0} className="btn-primary btn-sm mt-3 w-full">
            เก็บไว้ขายวันถัดไป
          </button>
        </div>

        <div className="rounded-xl border border-line p-3.5">
          <h3 className="text-[14px] font-semibold text-ink">ขายไม่ได้แล้ว — ตัดเป็นของเสีย</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
            มูลค่าต้นทุนจะถูกบันทึกเป็นความเสียหาย และแสดงในหน้าสรุป
          </p>
          <input
            className="field mt-2.5"
            placeholder="สาเหตุ (ไม่ใส่ก็ได้) เช่น บูด, ตกแตก"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button"
            onClick={() => onWaste(qty, reason.trim() || undefined)}
            disabled={qty <= 0}
            className="btn-outline btn-sm mt-2.5 w-full text-bad-ink"
          >
            ตัดเป็นของเสีย
          </button>
        </div>
      </div>
    </Modal>
  )
}
