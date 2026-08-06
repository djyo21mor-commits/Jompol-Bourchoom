/*
 * stats.js — โมดูลคำนวณสถิติสำหรับวางแผนปริมาณขนม
 *
 * ฟังก์ชันในไฟล์นี้เป็น "ฟังก์ชันบริสุทธิ์" (pure functions) รับข้อมูลเข้า
 * แล้วคืนค่าออกโดยไม่ยุ่งกับ DOM หรือ localStorage เพื่อให้ทดสอบได้ง่าย
 * และนำไปใช้ซ้ำได้ทั้งบนเบราว์เซอร์และบน Node.js
 */
(function (root) {
  'use strict';

  /**
   * ค่าเฉลี่ยเลขคณิต (arithmetic mean) = ผลรวมทั้งหมด หารด้วยจำนวนข้อมูล
   * @param {number[]} values
   * @returns {number|null} null ถ้าไม่มีข้อมูล
   */
  function mean(values) {
    if (!values || values.length === 0) return null;
    var sum = values.reduce(function (a, b) { return a + b; }, 0);
    return sum / values.length;
  }

  /**
   * ส่วนเบี่ยงเบนมาตรฐาน (standard deviation)
   *
   * ใช้สูตรตัวอย่าง (sample, หารด้วย n-1 / Bessel's correction) เป็นค่าเริ่มต้น
   * เพราะประวัติการขายเป็นเพียง "ตัวอย่าง" ที่ใช้ทำนายอนาคต ไม่ใช่ประชากรทั้งหมด
   *
   * @param {number[]} values
   * @param {boolean} [sample=true] true = หารด้วย n-1, false = หารด้วย n
   * @returns {number|null} null ถ้าไม่มีข้อมูล, 0 ถ้ามีข้อมูลจุดเดียว
   */
  function stdDev(values, sample) {
    if (sample === undefined) sample = true;
    if (!values || values.length === 0) return null;
    if (values.length === 1) return 0; // มีวันเดียว ประเมินความผันผวนไม่ได้
    var m = mean(values);
    var sumSq = values.reduce(function (a, b) {
      var diff = b - m;
      return a + diff * diff;
    }, 0);
    var denom = sample ? values.length - 1 : values.length;
    return Math.sqrt(sumSq / denom);
  }

  /**
   * ค่าผกผันของฟังก์ชันการแจกแจงสะสมปกติ (inverse normal CDF)
   * ใช้อัลกอริทึมของ Peter Acklam ให้ค่า z-score จากความน่าจะเป็น p
   *
   * ใช้แปลง "ระดับความมั่นใจว่าขนมจะพอขาย" (เช่น 90%) → ค่า z ที่เหมาะสม
   * @param {number} p ความน่าจะเป็น (0 < p < 1)
   * @returns {number} z-score
   */
  function inverseNormalCDF(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;

    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];

    var pLow = 0.02425;
    var pHigh = 1 - pLow;
    var q, r;

    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
             ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= pHigh) {
      q = p - 0.5;
      r = q * q;
      return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
             (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
              ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
  }

  /**
   * สรุปสถิติทั้งหมดจากชุดข้อมูลยอดขาย
   * @param {number[]} values
   * @returns {{count:number, mean:number|null, stdDev:number|null, min:number|null, max:number|null}}
   */
  function summarize(values) {
    if (!values || values.length === 0) {
      return { count: 0, mean: null, stdDev: null, min: null, max: null };
    }
    return {
      count: values.length,
      mean: mean(values),
      stdDev: stdDev(values),
      min: Math.min.apply(null, values),
      max: Math.max.apply(null, values)
    };
  }

  /**
   * แนะนำปริมาณที่ควรทำ
   *
   * สูตร:  ปริมาณแนะนำ = ค่าเฉลี่ย + (z × ส่วนเบี่ยงเบนมาตรฐาน)
   *
   * - ค่าเฉลี่ย   = ยอดขายที่คาดว่าจะขายได้โดยเฉลี่ย
   * - z × SD     = "สต็อกเผื่อ" (safety stock) กันขนมขาดในวันที่ขายดี
   *   ยิ่งอยากมั่นใจว่าขนมพอขายมากเท่าไร z ยิ่งสูง สต็อกเผื่อยิ่งเยอะ
   *
   * @param {number[]} values ประวัติยอดขาย
   * @param {number} serviceLevelPercent ระดับความมั่นใจว่าขนมจะพอขาย (0-100)
   * @returns {{recommended:number, mean:number|null, stdDev:number|null, z:number, safetyStock:number}}
   */
  function recommend(values, serviceLevelPercent) {
    var m = mean(values);
    var s = stdDev(values);
    if (m === null) {
      return { recommended: null, mean: null, stdDev: null, z: 0, safetyStock: 0 };
    }
    // จำกัดช่วงเพื่อไม่ให้ z เป็นอนันต์
    var p = Math.min(0.999, Math.max(0.001, serviceLevelPercent / 100));
    var z = inverseNormalCDF(p);
    var safetyStock = z * (s || 0);
    var raw = m + safetyStock;
    return {
      recommended: Math.max(0, Math.round(raw)),
      mean: m,
      stdDev: s,
      z: z,
      safetyStock: safetyStock
    };
  }

  var Stats = {
    mean: mean,
    stdDev: stdDev,
    summarize: summarize,
    inverseNormalCDF: inverseNormalCDF,
    recommend: recommend
  };

  // ให้ใช้ได้ทั้งบนเบราว์เซอร์ (window.Stats) และบน Node.js (require)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Stats;
  } else {
    root.Stats = Stats;
  }
})(typeof window !== 'undefined' ? window : this);
