import { useEffect, useMemo, useState } from 'react'
import type { BaseUnit, Overhead, Recipe } from '../types'
import { OVERHEAD_LABEL } from '../types'
import { useStore } from '../lib/store'
import { uid } from '../lib/engine'
import { finishedStock, maxProducible, profitAt, recipeCost, suggestPrice } from '../lib/calc'
import { baht, money, num, qtyText, today } from '../lib/format'
import { bigUnitFor, unitsForBase } from '../lib/units'
import { CostBreakdownBar } from '../components/Charts'
import { Card, Chip, ConfirmButton, Empty, Field, Icon, Modal, NumberInput, Stat } from '../components/ui'

/** แตกจำนวนในหน่วยฐานออกเป็น "ตัวเลข + หน่วยที่อ่านง่าย" สำหรับกรอกในฟอร์ม */
function splitQty(qty: number, base: BaseUnit, unitLabel: string): { value: number; unitName: string } {
  if (base === 'pcs') return { value: qty, unitName: unitLabel || 'ชิ้น' }
  const big = bigUnitFor(base)
  if (Math.abs(qty) >= big.factor) return { value: Math.round((qty / big.factor) * 10000) / 10000, unitName: big.name }
  return { value: Math.round(qty * 100) / 100, unitName: unitsForBase(base)[0].name }
}

interface DraftLine {
  key: string
  itemId: string
  value: number
  unitName: string
}

export default function RecipePage({ focus }: { focus?: { recipeId?: string; name?: string } }) {
  const { state, dispatch } = useStore()
  const [editing, setEditing] = useState<Recipe | null>(null)
  const [producing, setProducing] = useState<Recipe | null>(null)

  function blankRecipe(name = ''): Recipe {
    return {
      id: uid('r'),
      name,
      yieldQty: 20,
      yieldUnit: 'กล่อง',
      lines: [],
      overhead: { ...state.settings.defaultOverhead },
      marginPct: state.settings.defaultMarginPct,
      price: 0,
      createdAt: new Date().toISOString(),
    }
  }

  useEffect(() => {
    if (!focus) return
    if (focus.recipeId) {
      const r = state.recipes.find((x) => x.id === focus.recipeId)
      if (r) setEditing(r)
    } else if (focus.name) {
      setEditing(blankRecipe(focus.name))
    }
    // เปิดเฉพาะตอนถูกส่งมาจากหน้าอื่น
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-bold text-ink">เมนูขนม</h1>
          <p className="text-[13px] text-ink-3">สูตร ต้นทุนต่อกล่อง และราคาขายที่ควรตั้ง</p>
        </div>
        <button type="button" onClick={() => setEditing(blankRecipe())} className="btn-primary">
          <Icon name="plus" className="size-4" />
          เพิ่มเมนู
        </button>
      </div>

      {!state.recipes.length ? (
        <Card bodyClass="p-0">
          <Empty
            icon="book"
            title="ยังไม่มีเมนู"
            hint='สร้างจากแชทได้เลย เช่น "สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม, กล่อง p39 20 กล่อง" หรือกดปุ่มเพิ่มเมนู'
            action={
              <button type="button" onClick={() => setEditing(blankRecipe())} className="btn-primary">
                เพิ่มเมนูแรก
              </button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {state.recipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onEdit={() => setEditing(recipe)}
              onProduce={() => setProducing(recipe)}
            />
          ))}
        </div>
      )}

      {editing && (
        <RecipeEditor
          key={editing.id}
          recipe={editing}
          isNew={!state.recipes.some((r) => r.id === editing.id)}
          onClose={() => setEditing(null)}
          onSave={(r) => {
            dispatch({ type: 'recipe/save', recipe: r })
            setEditing(null)
          }}
          onDelete={() => {
            dispatch({ type: 'recipe/delete', id: editing.id })
            setEditing(null)
          }}
        />
      )}

      {producing && (
        <ProduceDialog
          recipe={producing}
          onClose={() => setProducing(null)}
          onConfirm={(qty, date) => {
            dispatch({ type: 'recipe/produce', recipeId: producing.id, qty, date })
            setProducing(null)
          }}
        />
      )}
    </div>
  )
}

function RecipeCard({ recipe, onEdit, onProduce }: { recipe: Recipe; onEdit: () => void; onProduce: () => void }) {
  const { state } = useStore()
  const cost = useMemo(() => recipeCost(recipe, state.items), [recipe, state.items])
  const ready = finishedStock(state.lots, recipe.id)
  const canMake = maxProducible(recipe, state.items)
  const profit = recipe.price > 0 ? profitAt(recipe.price, cost.costPerUnit) : null

  return (
    <article className="card overflow-hidden">
      <button type="button" onClick={onEdit} className="block w-full p-4 text-left transition-colors hover:bg-surface-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[16px] font-bold text-ink">{recipe.name}</h3>
          <Icon name="chevron" className="mt-1 size-4 shrink-0 text-ink-3" />
        </div>
        <p className="mt-0.5 text-[12.5px] text-ink-3">
          1 รอบได้ {num(recipe.yieldQty)} {recipe.yieldUnit} · ส่วนผสม {recipe.lines.length} อย่าง
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
          <div>
            <dt className="text-ink-3">ต้นทุน/{recipe.yieldUnit}</dt>
            <dd className="text-[15px] font-bold tnum text-ink">{baht(cost.costPerUnit, 2)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">ราคาขาย</dt>
            <dd className="text-[15px] font-bold tnum text-ink">
              {recipe.price > 0 ? baht(recipe.price, 0) : <span className="text-ink-3">ยังไม่ตั้ง</span>}
            </dd>
          </div>
        </dl>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {profit && (
            <Chip tone={profit.profit >= 0 ? 'good' : 'bad'}>
              กำไร {baht(profit.profit, 2)} บาท ({num(profit.markupPct, 0)}%)
            </Chip>
          )}
          <Chip tone={ready > 0 ? 'brand' : 'neutral'}>
            พร้อมขาย {num(ready)} {recipe.yieldUnit}
          </Chip>
          {cost.unpriced.length > 0 && <Chip tone="warn">ยังไม่รู้ราคา {cost.unpriced.length} อย่าง</Chip>}
        </div>
      </button>

      <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
        <span className="text-[12.5px] text-ink-3">
          วัตถุดิบที่มีทำได้อีก {num(canMake)} {recipe.yieldUnit}
        </span>
        <button type="button" onClick={onProduce} className="btn-ghost btn-sm ml-auto">
          บันทึกการผลิต
        </button>
      </div>
    </article>
  )
}

/* --------------------------------------------------------------------------
   ตัวแก้สูตร + เครื่องคิดราคาขาย
-------------------------------------------------------------------------- */

function RecipeEditor({
  recipe,
  isNew,
  onClose,
  onSave,
  onDelete,
}: {
  recipe: Recipe
  isNew: boolean
  onClose: () => void
  onSave: (r: Recipe) => void
  onDelete: () => void
}) {
  const { state } = useStore()
  const items = state.items
  const [name, setName] = useState(recipe.name)
  const [yieldQty, setYieldQty] = useState(recipe.yieldQty)
  const [yieldUnit, setYieldUnit] = useState(recipe.yieldUnit)
  const [overhead, setOverhead] = useState<Overhead>(recipe.overhead)
  const [marginPct, setMarginPct] = useState(recipe.marginPct)
  const [price, setPrice] = useState(recipe.price)
  const [lines, setLines] = useState<DraftLine[]>(() =>
    recipe.lines.map((l) => {
      const item = items.find((i) => i.id === l.itemId)
      const split = splitQty(l.qty, item?.base ?? 'g', item?.unitLabel ?? 'ชิ้น')
      return { key: uid('dl'), itemId: l.itemId, value: split.value, unitName: split.unitName }
    }),
  )

  /** สูตรชั่วคราวที่สะท้อนสิ่งที่กำลังกรอกอยู่ ใช้คิดต้นทุนแบบสดๆ */
  const draft: Recipe = useMemo(() => {
    const built = lines
      .filter((l) => l.itemId)
      .map((l) => {
        const item = items.find((i) => i.id === l.itemId)
        const factor =
          item?.base === 'pcs' ? 1 : (unitsForBase(item?.base ?? 'g').find((u) => u.name === l.unitName)?.factor ?? 1)
        return { itemId: l.itemId, qty: l.value * factor }
      })
    return { ...recipe, name, yieldQty, yieldUnit, overhead, marginPct, price, lines: built }
  }, [recipe, name, yieldQty, yieldUnit, overhead, marginPct, price, lines, items])

  const cost = useMemo(() => recipeCost(draft, items), [draft, items])
  const suggestion = suggestPrice(cost.costPerUnit, marginPct, state.settings.priceMode, state.settings.priceRounding)
  const current = price > 0 ? profitAt(price, cost.costPerUnit) : null

  const usedIds = new Set(lines.map((l) => l.itemId))
  const available = items.filter((i) => !usedIds.has(i.id))

  function addLine() {
    const first = available[0] ?? items[0]
    if (!first) return
    const split = splitQty(first.base === 'pcs' ? 1 : first.base === 'g' ? 100 : 100, first.base, first.unitLabel)
    setLines((ls) => [...ls, { key: uid('dl'), itemId: first.id, value: split.value, unitName: split.unitName }])
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={isNew ? 'เพิ่มเมนูใหม่' : name || 'แก้ไขเมนู'}
      footer={
        <div className="flex items-center gap-2">
          {!isNew && <ConfirmButton onConfirm={onDelete} label="ลบเมนูนี้" />}
          <button type="button" onClick={() => onSave(draft)} disabled={!name.trim()} className="btn-primary ml-auto">
            บันทึกเมนู
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="ชื่อเมนู" className="sm:col-span-1">
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="เค้กมะม่วง" />
          </Field>
          <Field label="ทำ 1 รอบได้">
            <NumberInput value={yieldQty} onChange={setYieldQty} min={1} suffix={yieldUnit} />
          </Field>
          <Field label="หน่วยขนม" hint="กล่อง ชิ้น ถ้วย ถุง">
            <input className="field" value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)} placeholder="กล่อง" />
          </Field>
        </div>

        {/* ------------------------------ ส่วนผสม ------------------------------ */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[14px] font-semibold text-ink">ส่วนผสมต่อ 1 รอบ ({num(yieldQty)} {yieldUnit})</h3>
            <button type="button" onClick={addLine} disabled={!items.length} className="btn-ghost btn-sm">
              <Icon name="plus" className="size-3.5" />
              เพิ่ม
            </button>
          </div>

          {!items.length ? (
            <p className="rounded-xl bg-surface-2 p-3 text-[13px] text-ink-2">
              ยังไม่มีวัตถุดิบในระบบ — ไปพิมพ์บันทึกการซื้อในหน้าแชทก่อน แล้วค่อยกลับมาใส่ส่วนผสม
            </p>
          ) : !lines.length ? (
            <p className="rounded-xl bg-surface-2 p-3 text-[13px] text-ink-2">
              ยังไม่ได้ใส่ส่วนผสม — กด "เพิ่ม" เพื่อเลือกวัตถุดิบและบรรจุภัณฑ์ที่ใช้
            </p>
          ) : (
            <ul className="space-y-2">
              {lines.map((line, index) => {
                const item = items.find((i) => i.id === line.itemId)
                const detail = cost.lines.find((c) => c.itemId === line.itemId)
                return (
                  <li key={line.key} className="rounded-xl border border-line p-2.5">
                    <div className="flex gap-2">
                      <select
                        className="field min-w-0 flex-1"
                        value={line.itemId}
                        onChange={(e) => {
                          const next = items.find((i) => i.id === e.target.value)!
                          const split = splitQty(next.base === 'pcs' ? 1 : 100, next.base, next.unitLabel)
                          setLines((ls) =>
                            ls.map((l, i) =>
                              i === index ? { ...l, itemId: next.id, value: split.value, unitName: split.unitName } : l,
                            ),
                          )
                        }}
                      >
                        {items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label="ลบส่วนผสม"
                        onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}
                        className="rounded-xl px-2 text-ink-3 hover:bg-surface-2 hover:text-bad-ink"
                      >
                        <Icon name="trash" className="size-4" />
                      </button>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <div className="w-28">
                        <NumberInput
                          value={line.value}
                          onChange={(v) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, value: v } : l)))}
                        />
                      </div>
                      {item && item.base !== 'pcs' ? (
                        <select
                          className="field w-28"
                          value={line.unitName}
                          onChange={(e) =>
                            setLines((ls) => ls.map((l, i) => (i === index ? { ...l, unitName: e.target.value } : l)))
                          }
                        >
                          {unitsForBase(item.base).map((u) => (
                            <option key={u.name} value={u.name}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-[13.5px] text-ink-2">{item?.unitLabel ?? 'ชิ้น'}</span>
                      )}
                      <span className="ml-auto text-right text-[13px] tnum">
                        {detail ? (
                          <>
                            <span className="font-semibold text-ink">{baht(detail.cost, 2)} บาท</span>
                            {!detail.enough && <span className="ml-1.5 text-[12px] text-bad-ink">สต็อกไม่พอ</span>}
                            {detail.missingPrice && <span className="ml-1.5 text-[12px] text-warn-ink">ไม่รู้ราคา</span>}
                          </>
                        ) : null}
                      </span>
                    </div>

                    {item && detail && (
                      <p className="mt-1.5 text-[12px] text-ink-3">
                        คงเหลือในสต็อก {qtyText(item.stock, item.base, item.unitLabel)}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* --------------------- ค่าแรง ค่าน้ำ ค่าไฟ จิปาถะ --------------------- */}
        <section>
          <h3 className="mb-2 text-[14px] font-semibold text-ink">ค่าใช้จ่ายอื่นต่อ 1 รอบ</h3>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(OVERHEAD_LABEL) as (keyof Overhead)[]).map((key) => (
              <Field key={key} label={OVERHEAD_LABEL[key]}>
                <NumberInput
                  value={overhead[key]}
                  onChange={(v) => setOverhead((o) => ({ ...o, [key]: v }))}
                  suffix="บาท"
                />
              </Field>
            ))}
          </div>
        </section>

        {/* ------------------------------ สรุปต้นทุน ------------------------------ */}
        <section className="rounded-2xl bg-surface-2 p-3.5">
          <h3 className="mb-3 text-[14px] font-semibold text-ink">ต้นทุนต่อ 1 {yieldUnit}</h3>
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-[30px] font-bold leading-none tnum text-ink">{baht(cost.costPerUnit, 2)}</span>
            <span className="text-[14px] text-ink-2">บาท</span>
          </div>
          <CostBreakdownBar
            parts={[
              { label: 'วัตถุดิบ+บรรจุภัณฑ์', value: cost.materialCost, color: 'var(--c-s1)' },
              { label: OVERHEAD_LABEL.labor, value: overhead.labor, color: 'var(--c-s2)' },
              { label: OVERHEAD_LABEL.water, value: overhead.water, color: 'var(--c-s3)' },
              { label: OVERHEAD_LABEL.electric, value: overhead.electric, color: 'var(--c-s4)' },
              { label: OVERHEAD_LABEL.misc, value: overhead.misc, color: 'var(--c-s5)' },
            ]}
          />
          <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-[13px]">
            <Row label="ค่าวัตถุดิบทั้งรอบ" value={money(cost.materialCost, 2)} />
            <Row label="ค่าใช้จ่ายอื่นทั้งรอบ" value={money(cost.overheadCost, 2)} />
            <Row label="ต้นทุนรวมทั้งรอบ" value={money(cost.totalCost, 2)} strong />
          </dl>
          {cost.unpriced.length > 0 && (
            <p className="mt-2.5 rounded-lg bg-warn/15 px-2.5 py-2 text-[12.5px] text-warn-ink">
              ยังไม่รู้ราคาของ {cost.unpriced.join(', ')} — บันทึกการซื้อก่อน ต้นทุนถึงจะครบ
            </p>
          )}
        </section>

        {/* ------------------------------ ตั้งราคาขาย ------------------------------ */}
        <section className="rounded-2xl border border-brand/25 bg-brand-soft p-3.5">
          <h3 className="mb-2 text-[14px] font-semibold text-ink">อยากได้กำไรเท่าไหร่</h3>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            {[20, 30, 40, 50, 60].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setMarginPct(p)}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                  marginPct === p ? 'bg-brand text-brand-ink' : 'bg-surface text-ink-2 hover:bg-surface-2'
                }`}
              >
                {p}%
              </button>
            ))}
            <div className="w-24">
              <NumberInput value={marginPct} onChange={setMarginPct} suffix="%" />
            </div>
          </div>

          <div className="rounded-xl bg-surface p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-ink-2">ควรขาย {yieldUnit}ละ</span>
              <span className="text-[26px] font-bold leading-none tnum text-brand">{baht(suggestion.price, 2)}</span>
            </div>
            <dl className="mt-2.5 space-y-1 border-t border-line pt-2.5 text-[12.5px]">
              <Row label="ต้นทุน" value={money(cost.costPerUnit, 2)} />
              <Row label={`กำไรต่อ${yieldUnit}`} value={money(suggestion.profit, 2)} />
              <Row
                label="คิดเป็น"
                value={`${num(suggestion.markupPct, 1)}% ของทุน · ${num(suggestion.marginPct, 1)}% ของราคาขาย`}
              />
            </dl>
            <button
              type="button"
              onClick={() => setPrice(Math.round(suggestion.price * 100) / 100)}
              className="btn-primary btn-sm mt-3 w-full"
            >
              ใช้ราคานี้
            </button>
          </div>

          <div className="mt-3">
            <Field label="หรือกำหนดราคาขายเอง">
              <NumberInput value={price} onChange={setPrice} suffix="บาท" />
            </Field>
            {current && (
              <p className={`mt-1.5 text-[13px] ${current.profit >= 0 ? 'text-good-ink' : 'text-bad-ink'}`}>
                ขาย {baht(price, 2)} บาท → กำไร {baht(current.profit, 2)} บาท ต่อ{yieldUnit} ({num(current.markupPct, 1)}%
                ของทุน)
                {current.profit < 0 && ' — ราคานี้ขาดทุน'}
              </p>
            )}
          </div>
        </section>
      </div>
    </Modal>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className={`tnum text-right ${strong ? 'font-bold text-ink' : 'font-medium text-ink-2'}`}>{value}</dd>
    </div>
  )
}

/* --------------------------------------------------------------------------
   บันทึกการผลิต
-------------------------------------------------------------------------- */

function ProduceDialog({
  recipe,
  onClose,
  onConfirm,
}: {
  recipe: Recipe
  onClose: () => void
  onConfirm: (qty: number, date: string) => void
}) {
  const { state } = useStore()
  const [qty, setQty] = useState(recipe.yieldQty)
  const [date, setDate] = useState(today())

  const scale = recipe.yieldQty > 0 ? qty / recipe.yieldQty : 0
  const cost = recipeCost(recipe, state.items, scale)
  const short = cost.lines.filter((l) => !l.enough)

  return (
    <Modal
      open
      onClose={onClose}
      title={`บันทึกการผลิต · ${recipe.name}`}
      footer={
        <button type="button" onClick={() => onConfirm(qty, date)} disabled={qty <= 0} className="btn-primary w-full">
          บันทึกผลิต {num(qty)} {recipe.yieldUnit}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="จำนวนที่ทำได้">
            <NumberInput value={qty} onChange={setQty} min={0} suffix={recipe.yieldUnit} />
          </Field>
          <Field label="วันที่ผลิต">
            <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="ต้นทุนรวม" value={baht(cost.totalCost, 2)} sub="บาท" />
          <Stat label={`ต้นทุนต่อ${recipe.yieldUnit}`} value={baht(cost.costPerUnit, 2)} sub="บาท" tone="brand" />
        </div>

        <div>
          <h3 className="mb-2 text-[13.5px] font-semibold text-ink-2">วัตถุดิบที่จะถูกตัดออก</h3>
          <ul className="space-y-1.5">
            {cost.lines.map((l) => (
              <li key={l.itemId} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="truncate text-ink-2">{l.name}</span>
                <span className={`shrink-0 tnum ${l.enough ? 'text-ink' : 'text-bad-ink'}`}>
                  {qtyText(l.qty, l.base, l.unitLabel)} / มี {qtyText(l.available, l.base, l.unitLabel)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {short.length > 0 && (
          <p className="rounded-xl bg-warn/15 px-3 py-2.5 text-[13px] text-warn-ink">
            วัตถุดิบไม่พอ {short.length} รายการ — บันทึกได้ แต่สต็อกจะติดลบ ควรกลับไปบันทึกการซื้อที่ตกหล่น
          </p>
        )}
      </div>
    </Modal>
  )
}
