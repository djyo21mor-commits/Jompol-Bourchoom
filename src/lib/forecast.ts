import type { AppState, Recipe } from '../types'
import { finishedStock, recipeCost, suggestPrice } from './calc'
import { addDays, today } from './format'

/* ===========================================================================
   คาดการณ์ว่าพรุ่งนี้ควรทำขนมกี่กล่อง

   วิธีคิด: ดูยอดขายจริงย้อนหลังของเมนูนั้น หาค่าเฉลี่ยกับส่วนเบี่ยงเบนมาตรฐาน
   แล้วบวกเผื่อตามระดับความมั่นใจที่เลือก

       ควรผลิต = ค่าเฉลี่ย + (z × ส่วนเบี่ยงเบนมาตรฐาน) − ของที่ยังเหลือพร้อมขาย

   ยิ่งยอดขายเหวี่ยงมาก (SD สูง) ยิ่งต้องเผื่อมาก ถ้าขายสม่ำเสมอก็แทบไม่ต้องเผื่อ
   ตั้งใจนับเฉพาะ "วันที่ร้านมีเมนูนี้ขาย" เท่านั้น วันที่ไม่ได้ทำไม่ถูกนับเป็น 0
   ไม่งั้นเมนูที่ทำเฉพาะเสาร์-อาทิตย์จะถูกดึงค่าเฉลี่ยลงจนคาดการณ์ต่ำเกินจริง
=========================================================================== */

/** สถิติพื้นฐานของชุดตัวเลข */
export interface Stats {
  /** จำนวนวันที่มีข้อมูล */
  n: number
  mean: number
  /** ส่วนเบี่ยงเบนมาตรฐานแบบกลุ่มตัวอย่าง (หารด้วย n−1) */
  sd: number
  min: number
  max: number
  /** สัมประสิทธิ์การแปรผัน = sd / mean — บอกว่ายอดขายเหวี่ยงแค่ไหน */
  cv: number
}

export function stats(values: number[]): Stats {
  const n = values.length
  if (!n) return { n: 0, mean: 0, sd: 0, min: 0, max: 0, cv: 0 }

  const mean = values.reduce((s, v) => s + v, 0) / n
  // n = 1 ยังหาความเหวี่ยงไม่ได้ ให้ถือว่า 0 ไปก่อน แล้วเตือนที่หน้าจอว่าข้อมูลยังน้อย
  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0

  return {
    n,
    mean,
    sd: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
    cv: mean > 0 ? Math.sqrt(variance) / mean : 0,
  }
}

/** ระดับความมั่นใจว่าจะมีของพอขาย -> ค่า z ของการแจกแจงปกติ */
export const SERVICE_LEVELS = [
  { pct: 50, z: 0, label: 'พอดีค่าเฉลี่ย', hint: 'ประหยัดที่สุด แต่ประมาณครึ่งหนึ่งของวันจะขายขาด' },
  { pct: 80, z: 0.8416, label: 'เผื่อพอประมาณ', hint: 'ราว 8 ใน 10 วันจะมีของพอขาย' },
  { pct: 90, z: 1.2816, label: 'เผื่อมาก', hint: 'ราว 9 ใน 10 วันจะมีของพอขาย' },
  { pct: 95, z: 1.6449, label: 'แทบไม่ให้ขาด', hint: 'เกือบทุกวันมีของพอขาย แต่ของเหลือจะเยอะขึ้น' },
] as const

export type ServicePct = (typeof SERVICE_LEVELS)[number]['pct']

export function zFor(pct: number): number {
  return SERVICE_LEVELS.find((l) => l.pct === pct)?.z ?? 0
}

export interface MenuForecast {
  recipeId: string
  name: string
  unit: string
  stats: Stats
  /** จำนวนที่ควรมีพร้อมขาย = ค่าเฉลี่ย + z × SD (ปัดขึ้นเป็นจำนวนเต็ม) */
  target: number
  /** ของที่ยังเหลือพร้อมขายอยู่แล้ว */
  ready: number
  /** ที่ควรลงมือทำเพิ่ม = target − ready (ไม่ติดลบ) */
  make: number
  /** ต้นทุนต่อหน่วยตอนนี้ ใช้บอกว่าถ้าเหลือจะจมทุนเท่าไหร่ */
  costPerUnit: number
  /** ราคาขายต่อหน่วย ใช้บอกว่าถ้าขาดจะเสียกำไรเท่าไหร่ */
  price: number
}

/** ยอดขายรายวันของเมนูหนึ่ง เฉพาะวันที่ร้านมีเมนูนี้ขาย */
export function dailySold(state: AppState, recipeId: string, from: string, to: string): { date: string; qty: number }[] {
  const within = (d: string) => d >= from && d <= to
  const offered = new Set<string>()

  for (const p of state.productions) if (p.recipeId === recipeId && within(p.date)) offered.add(p.date)
  for (const s of state.sales) if (s.recipeId === recipeId && within(s.date)) offered.add(s.date)

  return [...offered]
    .sort()
    .map((date) => ({
      date,
      qty: state.sales
        .filter((s) => s.recipeId === recipeId && s.date === date)
        .reduce((sum, s) => sum + s.qty, 0),
    }))
}

/**
 * คาดการณ์ทุกเมนูที่มีสูตรอยู่ เรียงจากเมนูที่ควรทำมากที่สุดลงมา
 * `forDate` คือวันที่จะเอาไปขาย ใช้ดูว่ามีของค้างพร้อมขายวันนั้นอยู่แล้วเท่าไหร่
 */
export function forecastMenus(
  state: AppState,
  from: string,
  to: string,
  servicePct: number,
  forDate = addDays(today(), 1),
): MenuForecast[] {
  const z = zFor(servicePct)

  return state.recipes
    .map((recipe) => build(state, recipe, from, to, z, forDate))
    .filter((f) => f.stats.n > 0)
    .sort((a, b) => b.stats.mean - a.stats.mean)
}

function build(
  state: AppState,
  recipe: Recipe,
  from: string,
  to: string,
  z: number,
  forDate: string,
): MenuForecast {
  const st = stats(dailySold(state, recipe.id, from, to).map((d) => d.qty))
  const target = Math.max(0, Math.ceil(st.mean + z * st.sd))
  const ready = finishedStock(state.lots, recipe.id, forDate)

  const cost = recipeCost(recipe, state.items)
  const price =
    recipe.price > 0
      ? recipe.price
      : suggestPrice(
          cost.costPerUnit,
          recipe.marginPct || state.settings.defaultMarginPct,
          state.settings.priceMode,
          state.settings.priceRounding,
        ).price

  return {
    recipeId: recipe.id,
    name: recipe.name,
    unit: recipe.yieldUnit,
    stats: st,
    target,
    ready,
    make: Math.max(0, Math.ceil(target - ready)),
    costPerUnit: cost.costPerUnit,
    price,
  }
}

/** คำอธิบายความสม่ำเสมอของยอดขาย จาก cv */
export function steadiness(cv: number): { label: string; tone: 'good' | 'warn' | 'bad' } {
  if (cv <= 0.15) return { label: 'ขายสม่ำเสมอมาก', tone: 'good' }
  if (cv <= 0.35) return { label: 'ค่อนข้างสม่ำเสมอ', tone: 'good' }
  if (cv <= 0.6) return { label: 'เหวี่ยงพอสมควร', tone: 'warn' }
  return { label: 'เหวี่ยงมาก คาดเดายาก', tone: 'bad' }
}
