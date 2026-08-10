import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { lowStockItems, stockValue, summarize } from '../lib/calc'
import { addDays, baht, dateText, dayLabel, money, num, qtyText, today } from '../lib/format'
import { DailyBars, MenuRanking } from '../components/Charts'
import { Card, Chip, Empty, Icon, Segmented, Stat } from '../components/ui'

type RangeKey = 'today' | '7d' | '30d' | 'month'

const RANGES: { value: RangeKey; label: string }[] = [
  { value: 'today', label: 'วันนี้' },
  { value: '7d', label: '7 วัน' },
  { value: '30d', label: '30 วัน' },
  { value: 'month', label: 'เดือนนี้' },
]

function rangeOf(key: RangeKey): { from: string; to: string } {
  const to = today()
  switch (key) {
    case 'today':
      return { from: to, to }
    case '7d':
      return { from: addDays(to, -6), to }
    case '30d':
      return { from: addDays(to, -29), to }
    case 'month':
      return { from: `${to.slice(0, 7)}-01`, to }
  }
}

export default function DashboardPage() {
  const { state } = useStore()
  const [range, setRange] = useState<RangeKey>('7d')
  const { from, to } = rangeOf(range)
  const s = useMemo(() => summarize(state, from, to), [state, from, to])

  const low = useMemo(() => lowStockItems(state.items), [state.items])
  const stockWorth = useMemo(() => stockValue(state.items), [state.items])
  const hasData = state.sales.length > 0 || state.productions.length > 0

  const unsoldNow = useMemo(
    () =>
      state.lots
        .filter((l) => l.remaining > 1e-9)
        .map((l) => ({ ...l, value: l.remaining * (l.originalCostPerUnit ?? l.costPerUnit) })),
    [state.lots],
  )
  const unsoldQty = unsoldNow.reduce((acc, l) => acc + l.remaining, 0)
  const unsoldValue = unsoldNow.reduce((acc, l) => acc + l.value, 0)

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-bold text-ink">สรุปการขาย</h1>
          <p className="text-[13px] text-ink-3">
            {range === 'today' ? dayLabel(to) : `${dateText(from)} – ${dateText(to)}`}
          </p>
        </div>
        <Segmented options={RANGES} value={range} onChange={setRange} size="sm" />
      </div>

      {!hasData ? (
        <Card bodyClass="p-0">
          <Empty
            icon="chart"
            title="ยังไม่มีข้อมูลให้สรุป"
            hint="เริ่มจากบันทึกการซื้อของ ตั้งสูตร แล้วบันทึกการผลิตกับการขาย ตัวเลขสรุปจะขึ้นที่นี่เอง"
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="ยอดขาย" value={baht(s.revenue, 0)} sub="บาท" tone="brand" />
            <Stat
              label="กำไรสุทธิ"
              value={baht(s.netProfit, 0)}
              sub="ยอดขาย − ต้นทุนที่ผลิต"
              tone={s.netProfit >= 0 ? 'good' : 'bad'}
            />
            <Stat label="ขายไปแล้ว" value={num(s.qtySold)} sub={`${s.orders} รายการขาย`} />
            <Stat
              label="กำไรจากการขาย"
              value={baht(s.grossProfit, 0)}
              sub={s.revenue > 0 ? `${num((s.grossProfit / s.revenue) * 100, 0)}% ของยอดขาย` : 'ยังไม่มียอดขาย'}
              tone={s.grossProfit >= 0 ? 'good' : 'bad'}
            />
          </div>

          <Card title="ยอดขายเทียบต้นทุนรายวัน">
            <DailyBars series={s.series} />
          </Card>

          <Card title="กำไร-ขาดทุนของช่วงนี้" subtitle="คิดแบบวันต่อวัน: ขายได้เท่าไหร่ ลบด้วยต้นทุนที่ลงมือผลิตในช่วงนั้น">
            <dl className="space-y-2 text-[14px]">
              <PLRow label="ยอดขาย" value={money(s.revenue)} sign="+" />
              <PLRow label="ค่าวัตถุดิบและบรรจุภัณฑ์ที่ใช้ผลิต" value={money(s.materialCost, 2)} sign="−" />
              <PLRow label="ค่าแรง ค่าน้ำ ค่าไฟ จิปาถะ" value={money(s.overheadCost, 2)} sign="−" />
              <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2.5">
                <dt className="text-[15px] font-semibold text-ink">กำไรสุทธิ</dt>
                <dd className={`text-[19px] font-bold tnum ${s.netProfit >= 0 ? 'text-good-ink' : 'text-bad-ink'}`}>
                  {money(s.netProfit)}
                </dd>
              </div>
            </dl>

            <div className="mt-3 space-y-2 rounded-xl bg-surface-2 p-3 text-[13px]">
              <div className="flex justify-between gap-3">
                <span className="text-ink-3">เงินที่จ่ายซื้อของเข้าร้าน</span>
                <span className="tnum font-medium">{money(s.purchaseSpend)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-ink-3">ผลิตไปทั้งหมด</span>
                <span className="tnum font-medium">{num(s.qtyProduced)} ชิ้น/กล่อง</span>
              </div>
              {s.wasteCost > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-ink-3">ของที่ทิ้ง {num(s.qtyWasted)} ชิ้น คิดเป็นทุน</span>
                  <span className="tnum font-medium text-bad-ink">{money(s.wasteCost, 2)}</span>
                </div>
              )}
            </div>
          </Card>

          {(unsoldQty > 0 || s.wasteCost > 0) && (
            <Card
              title="ของเหลือและของเสีย"
              subtitle="ของที่ผลิตแล้วยังขายไม่ออก คือเงินที่จ่ายไปแล้วแต่ยังไม่กลับมา"
            >
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  label="ค้างอยู่ตอนนี้"
                  value={num(unsoldQty)}
                  sub={`คิดเป็นทุน ${baht(unsoldValue, 0)} บาท`}
                  tone={unsoldQty > 0 ? 'warn' : 'neutral'}
                />
                <Stat
                  label="ทิ้งไปในช่วงนี้"
                  value={num(s.qtyWasted)}
                  sub={`ขาดทุน ${baht(s.wasteCost, 0)} บาท`}
                  tone={s.wasteCost > 0 ? 'bad' : 'neutral'}
                />
              </div>

              {unsoldNow.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-[13px]">
                  {unsoldNow.slice(0, 8).map((l) => (
                    <li key={l.id} className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-ink-2">
                        {l.recipeName}
                        {l.carriedOver && <span className="ml-1.5 text-[12px] text-warn-ink">ยกมา</span>}
                      </span>
                      <span className="shrink-0 tnum text-ink-3">
                        {num(l.remaining)} {l.unit} · ผลิต{dayLabel(l.date)} · พร้อมขาย{dayLabel(l.sellDate)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card title="เมนูที่ทำเงินได้ดีที่สุด">
            <MenuRanking data={s.byMenu} />
          </Card>
        </>
      )}

      <Card title="สต็อกวัตถุดิบ">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="มูลค่าคงคลัง" value={baht(stockWorth, 0)} sub="บาท" />
          <Stat
            label="ของใกล้หมด"
            value={num(low.length)}
            sub={low.length ? 'ควรสั่งซื้อเพิ่ม' : 'ยังไม่มีของใกล้หมด'}
            tone={low.length ? 'bad' : 'neutral'}
          />
        </div>
        {low.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {low.slice(0, 6).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="truncate text-ink-2">{i.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tnum text-bad-ink">{qtyText(i.stock, i.base, i.unitLabel)}</span>
                  <Chip tone="bad">
                    <Icon name="warn" className="size-3" />
                    ใกล้หมด
                  </Chip>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function PLRow({ label, value, sign }: { label: string; value: string; sign: '+' | '−' }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="shrink-0 tnum font-medium text-ink">
        <span className="mr-1 text-ink-3">{sign}</span>
        {value}
      </dd>
    </div>
  )
}
