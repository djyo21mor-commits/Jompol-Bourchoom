/*
 * ทดสอบโมดูล stats.js ด้วย Node.js (ไม่ต้องติดตั้ง dependency)
 * รันด้วย:  node test/stats.test.js   หรือ   npm test
 */
var assert = require('assert');
var Stats = require('../js/stats.js');

var passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    console.error('  ✗ ' + name + '\n    ' + e.message);
    process.exitCode = 1;
  }
}

function near(a, b, eps) {
  return Math.abs(a - b) <= (eps || 1e-6);
}

console.log('ทดสอบ stats.js');

// ---------- mean ----------
test('mean ของ [2,4,6] = 4', function () {
  assert.strictEqual(Stats.mean([2, 4, 6]), 4);
});
test('mean ของอาเรย์ว่าง = null', function () {
  assert.strictEqual(Stats.mean([]), null);
});
test('mean ของค่าเดียว [10] = 10', function () {
  assert.strictEqual(Stats.mean([10]), 10);
});

// ---------- stdDev (sample, n-1) ----------
test('stdDev ตัวอย่างของ [2,4,4,4,5,5,7,9] = 2.138...', function () {
  // ค่าอ้างอิง: sample sd = 2.13809...
  assert.ok(near(Stats.stdDev([2, 4, 4, 4, 5, 5, 7, 9]), 2.13808993, 1e-6));
});
test('stdDev ประชากร (n) ของ [2,4,4,4,5,5,7,9] = 2', function () {
  assert.ok(near(Stats.stdDev([2, 4, 4, 4, 5, 5, 7, 9], false), 2, 1e-9));
});
test('stdDev ของค่าเดียว = 0', function () {
  assert.strictEqual(Stats.stdDev([5]), 0);
});
test('stdDev ของอาเรย์ว่าง = null', function () {
  assert.strictEqual(Stats.stdDev([]), null);
});
test('stdDev ของค่าที่เท่ากันหมด = 0', function () {
  assert.strictEqual(Stats.stdDev([7, 7, 7, 7]), 0);
});

// ---------- inverseNormalCDF ----------
test('inverseNormalCDF(0.5) = 0', function () {
  assert.ok(near(Stats.inverseNormalCDF(0.5), 0, 1e-6));
});
test('inverseNormalCDF(0.975) ≈ 1.96', function () {
  assert.ok(near(Stats.inverseNormalCDF(0.975), 1.959964, 1e-4));
});
test('inverseNormalCDF(0.90) ≈ 1.2816', function () {
  assert.ok(near(Stats.inverseNormalCDF(0.90), 1.281552, 1e-4));
});

// ---------- summarize ----------
test('summarize ให้ค่าครบถ้วน', function () {
  var s = Stats.summarize([10, 20, 30]);
  assert.strictEqual(s.count, 3);
  assert.strictEqual(s.mean, 20);
  assert.strictEqual(s.min, 10);
  assert.strictEqual(s.max, 30);
});
test('summarize ของอาเรย์ว่างให้ count = 0', function () {
  var s = Stats.summarize([]);
  assert.strictEqual(s.count, 0);
  assert.strictEqual(s.mean, null);
});

// ---------- recommend ----------
test('recommend ที่ 50% = ค่าเฉลี่ยพอดี (ไม่มีสต็อกเผื่อ)', function () {
  var r = Stats.recommend([10, 20, 30], 50);
  assert.strictEqual(r.recommended, 20); // z=0 → เท่ากับค่าเฉลี่ย
});
test('recommend ที่ระดับสูงต้องมากกว่าค่าเฉลี่ย', function () {
  var r = Stats.recommend([10, 20, 30], 95);
  assert.ok(r.recommended > r.mean, 'ควร > ค่าเฉลี่ย');
  assert.ok(r.safetyStock > 0, 'สต็อกเผื่อควรเป็นบวก');
});
test('recommend ไม่มีข้อมูล → recommended = null', function () {
  var r = Stats.recommend([], 85);
  assert.strictEqual(r.recommended, null);
});
test('recommend ไม่คืนค่าติดลบ', function () {
  var r = Stats.recommend([0, 1, 0, 2], 99);
  assert.ok(r.recommended >= 0);
});

console.log('\nผ่านทั้งหมด ' + passed + ' การทดสอบ');
