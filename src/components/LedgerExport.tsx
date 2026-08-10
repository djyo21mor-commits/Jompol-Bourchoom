import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { buildLedger, ledgerToCsv, ledgerToJson, ledgerTotals, type LedgerMode } from '../lib/ledger'
import { addDays, baht, dateText, num, today, toISODate } from '../lib/format'
import { Card, Chip, Field, Icon, Segmented } from './ui'

/**
 * ดาวน์โหลดข้อความเป็นไฟล์ โดยไม่ต้องมีเซิร์ฟเวอร์
 * ต้องแปะ <a> ลง DOM ก่อนกด ไม่งั้นบางเบราว์เซอร์จะไม่สนใจชื่อไฟล์ที่ตั้งไว้
 * และชื่อไฟล์ต้องเป็นอักษรอังกฤษ เพราะถ้าใส่ภาษาไทย เบราว์เซอร์บางตัวจะทิ้งชื่อทั้งก้อน
 * จนไฟล์ออกมาไม่มีนามสกุล แล้วเปิดใน Excel ไม่ได้
 */
function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

function lastMonthRange(): { from: string; to: string } {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const last = new Date(now.getFullYear(), now.getMonth(), 0)
  return { from: toISODate(first), to: toISODate(last) }
}

export default function LedgerExport() {
  const { state } = useStore()
  const [from, setFrom] = useState(() => monthStart(today()))
  const [to, setTo] = useState(today)
  const [mode, setMode] = useState<LedgerMode>('daily')
  const [includeOverhead, setIncludeOverhead] = useState(false)
  const [copied, setCopied] = useState(false)

  const opts = useMemo(() => ({ from, to, mode, includeOverhead }), [from, to, mode, includeOverhead])
  const rows = useMemo(() => buildLedger(state, opts), [state, opts])
  const totals = ledgerTotals(rows)
  const stamp = `${from}_${to}`

  async function copyCsv() {
    try {
      await navigator.clipboard.writeText(ledgerToCsv(rows).replace(/^﻿/, ''))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* บางเบราว์เซอร์ไม่ให้สิทธิ์คลิปบอร์ด — ผู้ใช้ยังดาวน์โหลดไฟล์ได้ */
    }
  }

  return (
    <Card
      title="ส่งออกไปลงบัญชีรายรับ-รายจ่าย"
      subtitle="แปลงยอดขายและค่าซื้อของในแอปนี้ เป็นรายการรายรับ-รายจ่ายสำหรับนำเข้าระบบบัญชีที่ใช้อยู่"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="ตั้งแต่วันที่">
          <input type="date" className="field" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="ถึงวันที่">
          <input type="date" className="field" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2">
        {[
          { label: 'เดือนนี้', range: { from: monthStart(today()), to: today() } },
          { label: 'เดือนที่แล้ว', range: lastMonthRange() },
          { label: '7 วันล่าสุด', range: { from: addDays(today(), -6), to: today() } },
          { label: '30 วันล่าสุด', range: { from: addDays(today(), -29), to: today() } },
        ].map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
              setFrom(preset.range.from)
              setTo(preset.range.to)
            }}
            className={`btn-ghost btn-sm ${from === preset.range.from && to === preset.range.to ? '!bg-brand !text-brand-ink' : ''}`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <Field label="ระดับความละเอียด" className="mt-4">
        <Segmented
          options={[
            { value: 'daily', label: 'สรุปรายวัน' },
            { value: 'detail', label: 'ทุกรายการ' },
          ]}
          value={mode}
          onChange={setMode}
          size="sm"
        />
        <span className="mt-1.5 block text-[12px] text-ink-3">
          {mode === 'daily'
            ? 'รวมยอดขายต่อเมนู และยอดซื้อต่อหมวดหมู่ ให้เหลือวันละไม่กี่บรรทัด'
            : 'ออกทีละรายการตามที่บันทึกไว้จริง เหมาะเวลาต้องการตรวจย้อนหลัง'}
        </span>
      </Field>

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl bg-surface-2 p-3">
        <input
          type="checkbox"
          checked={includeOverhead}
          onChange={(e) => setIncludeOverhead(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--c-brand)]"
        />
        <span className="text-[13px] leading-relaxed text-ink-2">
          <strong className="font-semibold text-ink">รวมค่าแรง ค่าน้ำ ค่าไฟ ค่าจิปาถะด้วย</strong>
          <br />
          ปกติไม่ต้องติ๊ก เพราะค่าพวกนี้เป็นค่าประมาณที่ตั้งไว้ในสูตร ส่วนบิลจริงมักถูกบันทึกในระบบบัญชีอยู่แล้ว
          ติ๊กแล้วจะกลายเป็นบันทึกซ้ำสองที่
        </span>
      </label>

      <div className="mt-4 rounded-xl border border-line p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[13px] text-ink-3">
            {dateText(from, true)} – {dateText(to, true)}
          </span>
          <Chip tone={totals.rows > 0 ? 'brand' : 'neutral'}>{num(totals.rows)} บรรทัด</Chip>
        </div>
        <dl className="mt-2.5 space-y-1.5 border-t border-line pt-2.5 text-[13.5px]">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">รายรับ</dt>
            <dd className="tnum font-semibold text-good-ink">{baht(totals.income, 2)} บาท</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">รายจ่าย</dt>
            <dd className="tnum font-semibold text-bad-ink">{baht(totals.expense, 2)} บาท</dd>
          </div>
          <div className="flex justify-between gap-3 border-t border-line pt-1.5">
            <dt className="font-medium text-ink">คงเหลือ</dt>
            <dd className={`tnum font-bold ${totals.net >= 0 ? 'text-good-ink' : 'text-bad-ink'}`}>
              {baht(totals.net, 2)} บาท
            </dd>
          </div>
        </dl>
      </div>

      {totals.rows === 0 ? (
        <p className="mt-3 rounded-xl bg-warn/15 px-3 py-2.5 text-[13px] text-warn-ink">
          ยังไม่มีรายการในช่วงวันที่เลือก — ลองขยายช่วงวันที่ดู
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => downloadText(`bakery-ledger_${stamp}.csv`, ledgerToCsv(rows), 'text/csv')}
            className="btn-primary btn-sm"
          >
            <Icon name="download" className="size-4" />
            ดาวน์โหลด CSV
          </button>
          <button
            type="button"
            onClick={() => downloadText(`bakery-ledger_${stamp}.json`, ledgerToJson(rows, opts), 'application/json')}
            className="btn-outline btn-sm"
          >
            <Icon name="download" className="size-4" />
            ดาวน์โหลด JSON
          </button>
          <button type="button" onClick={copyCsv} className="btn-outline btn-sm">
            <Icon name={copied ? 'check' : 'copy'} className="size-4" />
            {copied ? 'คัดลอกแล้ว' : 'คัดลอกเป็นข้อความ'}
          </button>
        </div>
      )}

      <details className="mt-3 text-[13px]">
        <summary className="cursor-pointer text-ink-2 hover:text-ink">ดูตัวอย่างข้อมูลก่อนดาวน์โหลด</summary>
        <div className="mt-2 -mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[520px] text-[12.5px] tnum">
            <thead className="text-ink-3">
              <tr className="text-left">
                <th className="py-1.5 pr-3 font-medium">วันที่</th>
                <th className="py-1.5 pr-3 font-medium">ประเภท</th>
                <th className="py-1.5 pr-3 font-medium">หมวดหมู่</th>
                <th className="py-1.5 pr-3 font-medium">รายการ</th>
                <th className="py-1.5 text-right font-medium">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{dateText(r.date)}</td>
                  <td className={`py-1.5 pr-3 ${r.kind === 'income' ? 'text-good-ink' : 'text-bad-ink'}`}>
                    {r.kind === 'income' ? 'รายรับ' : 'รายจ่าย'}
                  </td>
                  <td className="py-1.5 pr-3 text-ink-2">{r.category}</td>
                  <td className="py-1.5 pr-3">{r.detail}</td>
                  <td className="py-1.5 text-right font-medium">{baht(r.amount, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 12 && (
            <p className="mt-2 text-[12px] text-ink-3">…และอีก {num(rows.length - 12)} บรรทัดในไฟล์</p>
          )}
        </div>
      </details>
    </Card>
  )
}
