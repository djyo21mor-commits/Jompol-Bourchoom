import { useMemo, useState } from 'react'
import type { Transaction, TxKind } from '../types'
import { TX_KIND_LABEL } from '../types'
import { useStore } from '../lib/store'
import { uid } from '../lib/engine'
import {
  buildMoneyEntries,
  groupByDay,
  monthLabel,
  monthRange,
  shiftMonth,
  summarizeMoney,
  SOURCE_LABEL,
  type MoneyEntry,
} from '../lib/money'
import { baht, dayLabel, money, num, today } from '../lib/format'
import { RankBars } from '../components/Charts'
import { Card, Chip, ConfirmButton, Empty, Field, Icon, Modal, NumberInput, Segmented, Stat } from '../components/ui'

function currentMonth(): string {
  return today().slice(0, 7)
}

export default function MoneyPage() {
  const { state, dispatch } = useStore()
  const [month, setMonth] = useState(currentMonth)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [filter, setFilter] = useState<'all' | TxKind>('all')

  const { from, to } = monthRange(month)
  const entries = useMemo(() => buildMoneyEntries(state, from, to), [state, from, to])
  const summary = useMemo(() => summarizeMoney(entries), [entries])

  const visible = useMemo(
    () => (filter === 'all' ? entries : entries.filter((e) => e.kind === filter)),
    [entries, filter],
  )
  const days = useMemo(() => groupByDay(visible), [visible])

  function newTx(kind: TxKind) {
    setEditing({
      id: uid('t'),
      date: month === currentMonth() ? today() : to,
      kind,
      category: '',
      detail: '',
      amount: 0,
      createdAt: new Date().toISOString(),
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-[17px] font-bold text-ink">บัญชีรายรับ-รายจ่าย</h1>
          <p className="truncate text-[13px] text-ink-3">{monthLabel(month)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-label="เดือนก่อนหน้า"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            className="btn-outline !px-2.5"
          >
            <Icon name="chevron" className="size-4 rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => setMonth(currentMonth())}
            disabled={month === currentMonth()}
            className="btn-ghost btn-sm disabled:opacity-40"
          >
            เดือนนี้
          </button>
          <button
            type="button"
            aria-label="เดือนถัดไป"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            disabled={month >= currentMonth()}
            className="btn-outline !px-2.5 disabled:opacity-40"
          >
            <Icon name="chevron" className="size-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="เงินเข้า" value={baht(summary.income, 0)} sub="บาท" tone="good" />
        <Stat label="เงินออก" value={baht(summary.expense, 0)} sub="บาท" tone="bad" />
        <Stat
          label="คงเหลือ"
          value={baht(summary.net, 0)}
          sub={summary.net >= 0 ? 'เดือนนี้เหลือเงิน' : 'เดือนนี้จ่ายเกิน'}
          tone={summary.net >= 0 ? 'good' : 'bad'}
        />
      </div>

      <Card title="เงินมาจากไหน ไปไหนบ้าง">
        <dl className="space-y-2 text-[14px]">
          <Line label="ขายขนม" value={summary.saleIncome} kind="income" hint="ดึงจากระบบขายอัตโนมัติ" />
          <Line label="รายรับอื่นที่บันทึกเอง" value={summary.otherIncome} kind="income" />
          <Line label="ซื้อวัตถุดิบและบรรจุภัณฑ์" value={summary.purchaseExpense} kind="expense" hint="ดึงจากระบบสต็อกอัตโนมัติ" />
          <Line label="ค่าใช้จ่ายอื่นที่บันทึกเอง" value={summary.otherExpense} kind="expense" />
          <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2.5">
            <dt className="text-[15px] font-semibold text-ink">คงเหลือสุทธิ</dt>
            <dd className={`text-[19px] font-bold tnum ${summary.net >= 0 ? 'text-good-ink' : 'text-bad-ink'}`}>
              {money(summary.net)}
            </dd>
          </div>
        </dl>
        <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
          ยอดขายขนมกับค่าซื้อของเข้าสต็อก ระบบดึงมาให้เองแล้ว — <strong className="font-semibold text-ink">ไม่ต้องบันทึกซ้ำ</strong>
          <br />
          ที่ต้องบันทึกเองคือค่าใช้จ่ายที่ไม่ผ่านสต็อก เช่น ค่าเช่าร้าน บิลค่าน้ำค่าไฟจริง ค่าจ้างพนักงาน
        </p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card title="รายจ่ายมากสุด" subtitle="เดือนนี้">
          <RankBars
            rows={summary.byCategory
              .filter((c) => c.kind === 'expense')
              .slice(0, 6)
              .map((c) => ({ label: c.category, amount: c.amount, sub: `${num(c.count)} รายการ` }))}
            tone="bad"
            emptyText="ยังไม่มีรายจ่ายในเดือนนี้"
          />
        </Card>
        <Card title="รายรับมากสุด" subtitle="เดือนนี้">
          <RankBars
            rows={summary.byCategory
              .filter((c) => c.kind === 'income')
              .slice(0, 6)
              .map((c) => ({ label: c.category, amount: c.amount, sub: `${num(c.count)} รายการ` }))}
            tone="good"
            emptyText="ยังไม่มีรายรับในเดือนนี้"
          />
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          options={[
            { value: 'all', label: 'ทั้งหมด' },
            { value: 'income', label: 'รายรับ' },
            { value: 'expense', label: 'รายจ่าย' },
          ]}
          value={filter}
          onChange={setFilter}
          size="sm"
        />
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => newTx('income')} className="btn-outline btn-sm">
            <Icon name="plus" className="size-3.5" />
            รายรับ
          </button>
          <button type="button" onClick={() => newTx('expense')} className="btn-primary btn-sm">
            <Icon name="plus" className="size-3.5" />
            รายจ่าย
          </button>
        </div>
      </div>

      {!days.length ? (
        <Card bodyClass="p-0">
          <Empty
            icon="calc"
            title="ยังไม่มีรายการในเดือนนี้"
            hint='พิมพ์ในแชทได้เลย เช่น "จ่ายค่าเช่าร้าน 5000 บาท" หรือกดปุ่มเพิ่มรายการด้านบน'
          />
        </Card>
      ) : (
        days.map((day) => (
          <Card key={day.date} bodyClass="p-0">
            <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5">
              <span className="text-[13.5px] font-semibold text-ink">{dayLabel(day.date)}</span>
              <span className={`text-[13px] font-semibold tnum ${day.net >= 0 ? 'text-good-ink' : 'text-bad-ink'}`}>
                {day.net >= 0 ? '+' : ''}
                {baht(day.net, 0)} บาท
              </span>
            </div>
            <ul className="divide-y divide-line">
              {day.entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  onEdit={
                    entry.source === 'manual'
                      ? () => {
                          const tx = state.transactions.find((t) => t.id === entry.refId)
                          if (tx) setEditing(tx)
                        }
                      : undefined
                  }
                />
              ))}
            </ul>
          </Card>
        ))
      )}

      {editing && (
        <TxEditor
          key={editing.id}
          tx={editing}
          isNew={!state.transactions.some((t) => t.id === editing.id)}
          onClose={() => setEditing(null)}
          onSave={(tx) => {
            dispatch({ type: 'tx/save', tx })
            setEditing(null)
          }}
          onDelete={() => {
            dispatch({ type: 'tx/delete', id: editing.id })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function Line({
  label,
  value,
  kind,
  hint,
}: {
  label: string
  value: number
  kind: TxKind
  hint?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-2">
        {label}
        {hint && <span className="ml-1.5 text-[12px] text-ink-3">({hint})</span>}
      </dt>
      <dd className="shrink-0 tnum font-medium text-ink">
        <span className="mr-1 text-ink-3">{kind === 'income' ? '+' : '−'}</span>
        {baht(value, 0)}
      </dd>
    </div>
  )
}

function EntryRow({ entry, onEdit }: { entry: MoneyEntry; onEdit?: () => void }) {
  const positive = entry.kind === 'income'
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14.5px] font-medium text-ink">{entry.category}</span>
          {entry.source !== 'manual' && <Chip tone="neutral">{SOURCE_LABEL[entry.source]}</Chip>}
        </div>
        {(entry.detail || entry.note) && (
          <p className="mt-0.5 truncate text-[12.5px] text-ink-3">
            {[entry.detail, entry.note].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
      <span className={`shrink-0 text-[15px] font-bold tnum ${positive ? 'text-good-ink' : 'text-bad-ink'}`}>
        {positive ? '+' : '−'}
        {baht(entry.amount, 0)}
      </span>
      {onEdit && <Icon name="chevron" className="size-4 shrink-0 text-ink-3" />}
    </>
  )

  return (
    <li>
      {onEdit ? (
        <button type="button" onClick={onEdit} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
          {body}
        </button>
      ) : (
        <div className="flex items-center gap-3 px-4 py-2.5">{body}</div>
      )}
    </li>
  )
}

function TxEditor({
  tx,
  isNew,
  onClose,
  onSave,
  onDelete,
}: {
  tx: Transaction
  isNew: boolean
  onClose: () => void
  onSave: (tx: Transaction) => void
  onDelete: () => void
}) {
  const { state } = useStore()
  const [draft, setDraft] = useState<Transaction>(tx)
  const set = <K extends keyof Transaction>(key: K, value: Transaction[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const categories =
    draft.kind === 'expense' ? state.settings.expenseCategories : state.settings.incomeCategories

  const valid = draft.category.trim().length > 0 && draft.amount > 0

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? `เพิ่ม${TX_KIND_LABEL[draft.kind]}` : `แก้ไข${TX_KIND_LABEL[draft.kind]}`}
      footer={
        <div className="flex items-center gap-2">
          {!isNew && <ConfirmButton onConfirm={onDelete} label="ลบรายการนี้" />}
          <button
            type="button"
            onClick={() => onSave({ ...draft, category: draft.category.trim(), detail: draft.detail.trim() })}
            disabled={!valid}
            className="btn-primary ml-auto"
          >
            บันทึก
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="ประเภท">
          <Segmented
            options={[
              { value: 'expense', label: 'รายจ่าย' },
              { value: 'income', label: 'รายรับ' },
            ]}
            value={draft.kind}
            onChange={(v) => set('kind', v)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="จำนวนเงิน">
            <NumberInput value={draft.amount} onChange={(v) => set('amount', v)} suffix="บาท" />
          </Field>
          <Field label="วันที่">
            <input type="date" className="field" value={draft.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
        </div>

        <Field label="หมวดหมู่" hint="พิมพ์หมวดใหม่ได้เลย ระบบจะจำไว้ให้เลือกครั้งหน้า">
          <input
            className="field"
            value={draft.category}
            onChange={(e) => set('category', e.target.value)}
            placeholder={draft.kind === 'expense' ? 'เช่น ค่าเช่าร้าน' : 'เช่น รับจ้างทำขนม'}
          />
        </Field>

        {categories.length > 0 && (
          <div className="-mt-2 flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set('category', c)}
                className={`rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                  draft.category === c ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink-2 hover:bg-surface-3'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        <Field label="หมายเหตุ" hint="ไม่ใส่ก็ได้">
          <input
            className="field"
            value={draft.detail}
            onChange={(e) => set('detail', e.target.value)}
            placeholder="เช่น เดือนสิงหาคม"
          />
        </Field>
      </div>
    </Modal>
  )
}
