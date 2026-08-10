import { useEffect, useMemo, useState } from 'react'
import { CATEGORY_LABEL, type BaseUnit, type Category, type Item } from '../types'
import { useStore } from '../lib/store'
import { uid } from '../lib/engine'
import { lowStockItems, stockValue } from '../lib/calc'
import { baht, costText, dateText, money, num, qtyText, qtyTextFull } from '../lib/format'
import { bigUnitFor, costUnitFor } from '../lib/units'
import { Card, Chip, ConfirmButton, Empty, Field, Icon, Modal, NumberInput, Stat } from '../components/ui'

const CATEGORIES: Category[] = ['fresh', 'dry', 'packaging', 'other']

const BASE_OPTIONS: { value: BaseUnit; label: string }[] = [
  { value: 'g', label: 'ชั่งน้ำหนัก (กรัม / กก.)' },
  { value: 'ml', label: 'ตวงปริมาตร (มล. / ลิตร)' },
  { value: 'pcs', label: 'นับเป็นชิ้น (กล่อง / ใบ / ฟอง)' },
]

export default function StockPage({ focusItemId }: { focusItemId?: string }) {
  const { state, dispatch } = useStore()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Category | 'all' | 'low'>('all')
  const [editing, setEditing] = useState<Item | null>(null)

  useEffect(() => {
    if (!focusItemId) return
    const item = state.items.find((i) => i.id === focusItemId)
    if (item) setEditing(item)
    // ตั้งใจดูแค่ตอน id ที่ส่งเข้ามาเปลี่ยน
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusItemId])

  const low = useMemo(() => lowStockItems(state.items), [state.items])
  const lowIds = useMemo(() => new Set(low.map((i) => i.id)), [low])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return state.items
      .filter((i) => (filter === 'all' ? true : filter === 'low' ? lowIds.has(i.id) : i.category === filter))
      .filter((i) => !q || i.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'th'))
  }, [state.items, query, filter, lowIds])

  const grouped = useMemo(() => {
    const map = new Map<Category, Item[]>()
    for (const item of visible) {
      const list = map.get(item.category) ?? []
      list.push(item)
      map.set(item.category, list)
    }
    return CATEGORIES.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const)
  }, [visible])

  function newItem() {
    setEditing({
      id: uid('i'),
      name: '',
      category: 'other',
      base: 'g',
      unitLabel: 'กรัม',
      stock: 0,
      avgCost: 0,
      lastCost: 0,
      createdAt: new Date().toISOString(),
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="มูลค่าสต็อกทั้งหมด" value={`${baht(stockValue(state.items), 0)}`} sub="บาท" tone="brand" />
        <Stat label="จำนวนรายการ" value={num(state.items.length)} sub="วัตถุดิบและบรรจุภัณฑ์" />
        <Stat
          label="ใกล้หมด"
          value={num(low.length)}
          sub={low.length ? low.slice(0, 2).map((i) => i.name).join(', ') : 'ยังไม่มีของใกล้หมด'}
          tone={low.length ? 'bad' : 'neutral'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input
            className="field pl-9"
            placeholder="ค้นหาวัตถุดิบ…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button type="button" onClick={newItem} className="btn-primary">
          <Icon name="plus" className="size-4" />
          เพิ่มของ
        </button>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
        {[
          { value: 'all' as const, label: 'ทั้งหมด' },
          ...CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] })),
          ...(low.length ? [{ value: 'low' as const, label: `ใกล้หมด (${low.length})` }] : []),
        ].map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              filter === f.value ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink-2 hover:bg-surface-3'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!state.items.length ? (
        <Card bodyClass="p-0">
          <Empty
            icon="box"
            title="ยังไม่มีของในสต็อก"
            hint='ไปที่หน้าแชทแล้วพิมพ์ เช่น "ซื้อมะม่วง 3 กิโล ราคารวม 112 บาท" ระบบจะบันทึกและคิดต้นทุนต่อหน่วยให้เอง'
          />
        </Card>
      ) : !visible.length ? (
        <Card bodyClass="p-0">
          <Empty icon="search" title="ไม่เจอของที่ค้นหา" hint="ลองพิมพ์ชื่ออื่น หรือเปลี่ยนหมวดหมู่" />
        </Card>
      ) : (
        grouped.map(([category, items]) => (
          <div key={category} className="space-y-2">
            <h2 className="px-1 text-[13px] font-semibold text-ink-3">
              {CATEGORY_LABEL[category]} · {items.length} รายการ
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map((item) => (
                <ItemRow key={item.id} item={item} low={lowIds.has(item.id)} onOpen={() => setEditing(item)} />
              ))}
            </div>
          </div>
        ))
      )}

      {editing && (
        <ItemEditor
          key={editing.id}
          item={editing}
          isNew={!state.items.some((i) => i.id === editing.id)}
          onClose={() => setEditing(null)}
          onSave={(item) => {
            dispatch({ type: 'item/save', item })
            setEditing(null)
          }}
          onDelete={() => {
            dispatch({ type: 'item/delete', id: editing.id })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function ItemRow({ item, low, onOpen }: { item: Item; low: boolean; onOpen: () => void }) {
  const value = item.stock * (item.avgCost || item.lastCost || 0)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-surface-2"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold text-ink">{item.name}</span>
          {low && <Chip tone="bad">ใกล้หมด</Chip>}
          {item.avgCost <= 0 && <Chip tone="warn">ยังไม่รู้ราคา</Chip>}
        </div>
        <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{costText(item.avgCost, item.base, item.unitLabel)}</p>
      </div>
      <div className="shrink-0 text-right">
        <div className={`text-[15px] font-bold tnum ${item.stock <= 0 ? 'text-bad-ink' : 'text-ink'}`}>
          {qtyText(item.stock, item.base, item.unitLabel)}
        </div>
        <div className="text-[12px] text-ink-3 tnum">{baht(value, 0)} บาท</div>
      </div>
      <Icon name="chevron" className="size-4 shrink-0 text-ink-3" />
    </button>
  )
}

function ItemEditor({
  item,
  isNew,
  onClose,
  onSave,
  onDelete,
}: {
  item: Item
  isNew: boolean
  onClose: () => void
  onSave: (item: Item) => void
  onDelete: () => void
}) {
  const { state } = useStore()
  const [draft, setDraft] = useState<Item>(item)
  const set = <K extends keyof Item>(key: K, value: Item[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const costUnit = costUnitFor(draft.base, draft.unitLabel)
  // ผู้ใช้กรอกต้นทุนในหน่วยที่คุ้นเคย (บาท/กก.) แล้วค่อยแปลงกลับเป็นหน่วยฐาน
  const [costPerDisplay, setCostPerDisplay] = useState(() => Math.round(item.avgCost * costUnit.factor * 100) / 100)
  const [stockDisplay, setStockDisplay] = useState(() => {
    const big = bigUnitFor(item.base, item.unitLabel)
    return Math.round((item.stock / big.factor) * 1000) / 1000
  })
  const stockUnit = bigUnitFor(draft.base, draft.unitLabel)

  const history = useMemo(
    () => state.purchases.filter((p) => p.itemId === item.id).slice(0, 8),
    [state.purchases, item.id],
  )

  function save() {
    const name = draft.name.trim()
    if (!name) return
    onSave({
      ...draft,
      name,
      stock: stockDisplay * stockUnit.factor,
      avgCost: costPerDisplay / costUnit.factor,
      lastCost: draft.lastCost || costPerDisplay / costUnit.factor,
      unitLabel: draft.base === 'pcs' ? draft.unitLabel.trim() || 'ชิ้น' : draft.unitLabel,
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'เพิ่มวัตถุดิบ / บรรจุภัณฑ์' : draft.name}
      footer={
        <div className="flex items-center gap-2">
          {!isNew && <ConfirmButton onConfirm={onDelete} label="ลบรายการนี้" />}
          <button type="button" onClick={save} disabled={!draft.name.trim()} className="btn-primary ml-auto">
            บันทึก
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="ชื่อ">
          <input className="field" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="เช่น มะม่วงน้ำดอกไม้" />
        </Field>

        <Field label="หมวดหมู่">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set('category', c)}
                className={`rounded-xl px-3.5 py-2 text-[13.5px] font-medium transition-colors ${
                  draft.category === c ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink-2 hover:bg-surface-3'
                }`}
              >
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </Field>

        <Field label="วิธีนับ" hint={isNew ? undefined : 'เปลี่ยนวิธีนับแล้วตัวเลขเดิมจะถูกตีความใหม่ ควรตรวจสต็อกอีกครั้ง'}>
          <select
            className="field"
            value={draft.base}
            onChange={(e) => {
              const base = e.target.value as BaseUnit
              set('base', base)
              set('unitLabel', base === 'pcs' ? 'ชิ้น' : base === 'g' ? 'กรัม' : 'มล.')
            }}
          >
            {BASE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        {draft.base === 'pcs' && (
          <Field label="เรียกหน่วยว่า" hint="ใช้แสดงผลทั้งแอป เช่น กล่อง ใบ ฟอง แผ่น">
            <input className="field" value={draft.unitLabel} onChange={(e) => set('unitLabel', e.target.value)} placeholder="กล่อง" />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="คงเหลือ">
            <NumberInput value={stockDisplay} onChange={setStockDisplay} suffix={stockUnit.name} min={-1e9} />
          </Field>
          <Field label="ต้นทุนเฉลี่ย">
            <NumberInput value={costPerDisplay} onChange={setCostPerDisplay} suffix={`บาท/${costUnit.label}`} />
          </Field>
        </div>

        <Field label="เตือนเมื่อเหลือน้อยกว่า" hint="ใส่ 0 ถ้าไม่ต้องการให้เตือน">
          <NumberInput
            value={draft.base === 'pcs' ? (draft.lowStock ?? 0) : (draft.lowStock ?? 0) / stockUnit.factor}
            onChange={(v) => set('lowStock', v * (draft.base === 'pcs' ? 1 : stockUnit.factor))}
            suffix={stockUnit.name}
          />
        </Field>

        <div className="rounded-xl bg-surface-2 p-3 text-[13px]">
          <div className="flex justify-between">
            <span className="text-ink-3">มูลค่าคงเหลือ</span>
            <span className="font-semibold tnum">{money(stockDisplay * stockUnit.factor * (costPerDisplay / costUnit.factor), 2)}</span>
          </div>
        </div>

        {history.length > 0 && (
          <div>
            <h3 className="mb-2 text-[13px] font-semibold text-ink-2">ประวัติการซื้อล่าสุด</h3>
            <ul className="space-y-1.5">
              {history.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-ink-3">{dateText(p.date, true)}</span>
                  <span className="tnum text-ink-2">
                    {qtyTextFull(p.qty, draft.base, draft.unitLabel)} · {money(p.total)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
