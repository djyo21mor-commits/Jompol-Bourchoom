import { useRef, useState } from 'react'
import type { Overhead, Settings } from '../types'
import { OVERHEAD_LABEL } from '../types'
import { exportData, parseImport, useStore } from '../lib/store'
import { saveTextFile } from '../lib/download'
import { money, num } from '../lib/format'
import { suggestPrice } from '../lib/calc'
import { Card, ConfirmButton, Field, Icon, NumberInput, Segmented } from '../components/ui'
import LedgerExport from '../components/LedgerExport'

export default function SettingsPage() {
  const { state, dispatch } = useStore()
  const [draft, setDraft] = useState<Settings>(state.settings)
  const [saved, setSaved] = useState(false)
  const [importError, setImportError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setSaved(false)
  }

  function save() {
    dispatch({ type: 'settings/save', settings: draft })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2200)
  }

  async function download() {
    const res = await saveTextFile(
      `bakery-backup_${new Date().toISOString().slice(0, 10)}.json`,
      exportData(state),
      'application/json',
    )
    setImportError(res.ok ? '' : res.message)
  }

  async function upload(file: File) {
    setImportError('')
    try {
      dispatch({ type: 'data/replace', state: parseImport(await file.text()) })
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'อ่านไฟล์ไม่สำเร็จ')
    }
  }

  // ตัวอย่างให้เห็นภาพว่าวิธีคิดราคาที่เลือกไว้ ให้ผลต่างกันยังไง
  const demo = suggestPrice(100, draft.defaultMarginPct, draft.priceMode, draft.priceRounding)

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <h1 className="text-[17px] font-bold text-ink">ตั้งค่า</h1>

      <Card title="ร้านของฉัน">
        <Field label="ชื่อร้าน">
          <input className="field" value={draft.shopName} onChange={(e) => set('shopName', e.target.value)} />
        </Field>
        <Field label="ธีมสี" className="mt-3">
          <Segmented
            options={[
              { value: 'system', label: 'ตามเครื่อง' },
              { value: 'light', label: 'สว่าง' },
              { value: 'dark', label: 'มืด' },
            ]}
            value={draft.theme}
            onChange={(v) => {
              set('theme', v)
              dispatch({ type: 'settings/save', settings: { ...draft, theme: v } })
            }}
          />
        </Field>
      </Card>

      <Card
        title="ค่าใช้จ่ายตั้งต้นของเมนูใหม่"
        subtitle="ใส่ค่าต่อ 1 รอบผลิต ระบบจะเติมให้อัตโนมัติเมื่อสร้างเมนูใหม่ (แก้รายเมนูได้ทีหลัง)"
      >
        <div className="grid grid-cols-2 gap-3">
          {(Object.keys(OVERHEAD_LABEL) as (keyof Overhead)[]).map((key) => (
            <Field key={key} label={OVERHEAD_LABEL[key]}>
              <NumberInput
                value={draft.defaultOverhead[key]}
                onChange={(v) => set('defaultOverhead', { ...draft.defaultOverhead, [key]: v })}
                suffix="บาท"
              />
            </Field>
          ))}
        </div>
        <p className="mt-2.5 text-[12.5px] text-ink-3">
          รวม {money(Object.values(draft.defaultOverhead).reduce((a, b) => a + b, 0))} ต่อรอบผลิต
        </p>
      </Card>

      <Card title="วิธีคิดราคาขาย">
        <Field label="กำไรที่ต้องการโดยปกติ">
          <div className="flex flex-wrap items-center gap-2">
            {[20, 30, 40, 50].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => set('defaultMarginPct', p)}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                  draft.defaultMarginPct === p ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink-2 hover:bg-surface-3'
                }`}
              >
                {p}%
              </button>
            ))}
            <div className="w-24">
              <NumberInput value={draft.defaultMarginPct} onChange={(v) => set('defaultMarginPct', v)} suffix="%" />
            </div>
          </div>
        </Field>

        <Field label="ตีความเปอร์เซ็นต์กำไรว่า" className="mt-3">
          <Segmented
            options={[
              { value: 'markup', label: 'บวกจากทุน' },
              { value: 'margin', label: '% ของราคาขาย' },
            ]}
            value={draft.priceMode}
            onChange={(v) => set('priceMode', v)}
          />
        </Field>

        <Field label="ปัดราคาขายขึ้นเป็นหลัก" className="mt-3" hint="ใส่ 0 ถ้าไม่ต้องการปัด">
          <div className="flex flex-wrap gap-2">
            {[0, 1, 5, 10].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => set('priceRounding', r)}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                  draft.priceRounding === r ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink-2 hover:bg-surface-3'
                }`}
              >
                {r === 0 ? 'ไม่ปัด' : `${r} บาท`}
              </button>
            ))}
          </div>
        </Field>

        <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2">
          ตัวอย่าง: ต้นทุน 100 บาท กำไร {num(draft.defaultMarginPct)}% →{' '}
          <strong className="font-semibold text-ink">ขาย {money(demo.price)}</strong> (กำไร {money(demo.profit, 2)})
        </p>
      </Card>

      <div className="sticky bottom-2 z-10">
        <button type="button" onClick={save} className="btn-primary w-full shadow-lg">
          {saved ? (
            <>
              <Icon name="check" className="size-4" />
              บันทึกแล้ว
            </>
          ) : (
            'บันทึกการตั้งค่า'
          )}
        </button>
      </div>

      <Card
        title="คนที่ช่วยกันบันทึก"
        subtitle="ใส่ชื่อทั้งสองคนไว้ แล้วสลับได้จากด้านบนของช่องแชท ทุกข้อความจะจดว่าใครเป็นคนพิมพ์"
      >
        <div className="flex flex-wrap gap-2">
          {draft.people.map((person) => (
            <span key={person} className="inline-flex items-center gap-1 rounded-lg bg-surface-2 py-1.5 pl-3 pr-1.5 text-[13px]">
              {person}
              {draft.people.length > 1 && (
                <button
                  type="button"
                  aria-label={`ลบ ${person}`}
                  onClick={() =>
                    set('people', draft.people.filter((x) => x !== person))
                  }
                  className="rounded p-0.5 text-ink-3 hover:bg-surface-3 hover:text-bad-ink"
                >
                  <Icon name="close" className="size-3.5" />
                </button>
              )}
            </span>
          ))}
        </div>
        <input
          className="field mt-2"
          placeholder="เพิ่มชื่อคน แล้วกด Enter เช่น ภรรยา"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            const value = e.currentTarget.value.trim()
            if (value && !draft.people.includes(value)) set('people', [...draft.people, value])
            e.currentTarget.value = ''
          }}
        />
        <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
          ข้อมูลเก็บอยู่ในเครื่องนี้เครื่องเดียว ถ้าใช้คนละมือถือจะยังไม่เห็นข้อมูลของกันและกัน —
          ให้ใช้เครื่องเดียวกัน หรือส่งไฟล์สำรองให้กันในหน้าถัดไป
        </p>
      </Card>

      <Card
        title="หมวดหมู่รายรับ-รายจ่าย"
        subtitle="ใช้ในหน้าบัญชี — พิมพ์หมวดใหม่ในแชทได้เลย ระบบจะเพิ่มให้เอง ลบหมวดที่ไม่ใช้ได้ที่นี่"
      >
        {(
          [
            ['expenseCategories', 'หมวดรายจ่าย'],
            ['incomeCategories', 'หมวดรายรับ'],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="mb-4 last:mb-0">
            <h3 className="mb-2 text-[13px] font-semibold text-ink-2">{label}</h3>
            <div className="flex flex-wrap gap-2">
              {draft[key].map((c) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-lg bg-surface-2 py-1.5 pl-3 pr-1.5 text-[13px]">
                  {c}
                  <button
                    type="button"
                    aria-label={`ลบหมวด ${c}`}
                    onClick={() => set(key, draft[key].filter((x) => x !== c))}
                    className="rounded p-0.5 text-ink-3 hover:bg-surface-3 hover:text-bad-ink"
                  >
                    <Icon name="close" className="size-3.5" />
                  </button>
                </span>
              ))}
              {!draft[key].length && <span className="text-[13px] text-ink-3">ยังไม่มีหมวด</span>}
            </div>
            <input
              className="field mt-2"
              placeholder={`เพิ่ม${label}ใหม่ แล้วกด Enter`}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                const value = e.currentTarget.value.trim()
                if (value && !draft[key].includes(value)) set(key, [...draft[key], value])
                e.currentTarget.value = ''
              }}
            />
          </div>
        ))}
        <p className="mt-1 text-[12px] text-ink-3">
          ลบหมวดแล้วรายการเก่าที่ใช้หมวดนั้นยังอยู่ครบ แค่ไม่ขึ้นเป็นตัวเลือกให้กดอีก
        </p>
      </Card>

      <LedgerExport />

      <Card title="สำรองข้อมูล" subtitle="ข้อมูลทั้งหมดเก็บอยู่ในเครื่องนี้เท่านั้น ควรดาวน์โหลดเก็บไว้เป็นระยะ">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void download()} className="btn-outline">
            <Icon name="download" className="size-4" />
            ดาวน์โหลดไฟล์สำรอง
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className="btn-outline">
            <Icon name="upload" className="size-4" />
            นำเข้าไฟล์สำรอง
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void upload(file)
              e.target.value = ''
            }}
          />
        </div>
        {importError && <p className="mt-2.5 text-[13px] text-bad-ink">{importError}</p>}

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-3">
          {[
            ['วัตถุดิบ', state.items.length],
            ['เมนู', state.recipes.length],
            ['การซื้อ', state.purchases.length],
            ['การผลิต', state.productions.length],
            ['การขาย', state.sales.length],
            ['ของเสีย', state.wastes.length],
          ].map(([label, count]) => (
            <div key={label as string} className="flex justify-between gap-2">
              <dt className="text-ink-3">{label}</dt>
              <dd className="tnum font-medium text-ink">{num(count as number)}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="ล้างข้อมูล" subtitle="ลบทุกอย่างในเครื่องนี้แล้วเริ่มใหม่ — กู้คืนไม่ได้">
        <ConfirmButton
          onConfirm={() => dispatch({ type: 'data/reset' })}
          label="ล้างข้อมูลทั้งหมด"
          confirmLabel="กดอีกครั้งเพื่อยืนยันการล้าง"
          className="btn-danger w-full"
        />
      </Card>

      <p className="pb-2 text-center text-[12px] leading-relaxed text-ink-3">
        ข้อมูลทั้งหมดถูกเก็บไว้ในเบราว์เซอร์ของเครื่องนี้ ไม่ได้ส่งออกไปที่ไหน
        <br />
        ถ้าล้างข้อมูลเบราว์เซอร์หรือเปลี่ยนเครื่อง ให้ใช้ไฟล์สำรองในการย้ายข้อมูล
      </p>
    </div>
  )
}
