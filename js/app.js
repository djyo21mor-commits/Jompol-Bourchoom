/*
 * app.js — ตัวควบคุมหน้าจอและการเก็บข้อมูลของระบบวางแผนปริมาณขนม
 * ใช้ localStorage เก็บข้อมูลไว้ในเครื่องผู้ใช้ (ไม่ส่งออกไปที่ไหน)
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'khanom-planner-v1';
  var WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

  // ---------- สถานะข้อมูล ----------
  var state = load();

  function defaultState() {
    return {
      settings: { serviceLevel: 85, byWeekday: false, targetWeekday: new Date().getDay() },
      products: []
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      // เติมค่าที่อาจขาดหายจากเวอร์ชันเก่า
      if (!parsed.settings) parsed.settings = defaultState().settings;
      if (parsed.settings.targetWeekday === undefined) {
        parsed.settings.targetWeekday = new Date().getDay();
      }
      if (!Array.isArray(parsed.products)) parsed.products = [];
      return parsed;
    } catch (e) {
      console.error('โหลดข้อมูลไม่สำเร็จ ใช้ค่าเริ่มต้นแทน', e);
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      alert('บันทึกข้อมูลไม่สำเร็จ: พื้นที่จัดเก็บอาจเต็ม');
    }
  }

  function uid() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ---------- ตัวช่วย ----------
  function weekdayOf(dateStr) {
    var parts = dateStr.split('-');
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    return d.getDay();
  }

  function todayStr() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function fmt(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('th-TH', {
      minimumFractionDigits: digits || 0,
      maximumFractionDigits: digits === undefined ? 1 : digits
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // เลือกชุดยอดขายที่ใช้คำนวณ (ทั้งหมด หรือกรองตามวันในสัปดาห์)
  function selectValues(product) {
    var records = product.records || [];
    if (state.settings.byWeekday) {
      var wd = state.settings.targetWeekday;
      var filtered = records.filter(function (r) { return weekdayOf(r.date) === wd; });
      if (filtered.length >= 2) {
        return { values: filtered.map(function (r) { return r.qty; }), weekdayFiltered: true };
      }
      // ข้อมูลวันนั้นน้อยเกินไป กลับไปใช้ทั้งหมดพร้อมแจ้งเตือน
      return {
        values: records.map(function (r) { return r.qty; }),
        weekdayFiltered: false,
        fallback: true
      };
    }
    return { values: records.map(function (r) { return r.qty; }), weekdayFiltered: false };
  }

  // ---------- การแสดงผล ----------
  var productListEl = document.getElementById('productList');

  function render() {
    renderSettings();
    renderProducts();
  }

  function renderSettings() {
    document.getElementById('serviceLevel').value = state.settings.serviceLevel;
    document.getElementById('serviceLevelOut').textContent = state.settings.serviceLevel + '%';
    document.getElementById('byWeekday').checked = state.settings.byWeekday;

    var weekdayRow = document.getElementById('weekdayRow');
    weekdayRow.style.display = state.settings.byWeekday ? '' : 'none';

    var sel = document.getElementById('targetWeekday');
    if (!sel.options.length) {
      WEEKDAYS.forEach(function (name, i) {
        var opt = document.createElement('option');
        opt.value = i;
        opt.textContent = 'วัน' + name;
        sel.appendChild(opt);
      });
    }
    sel.value = state.settings.targetWeekday;
  }

  function renderProducts() {
    if (!state.products.length) {
      productListEl.innerHTML =
        '<div class="card empty-state">' +
        '<p>ยังไม่มีขนมในระบบ 🫙</p>' +
        '<p class="hint">เพิ่มชนิดขนมด้านล่าง แล้วบันทึกยอดขายย้อนหลังเพื่อเริ่มคำนวณ</p>' +
        '</div>';
      return;
    }

    var html = state.products.map(renderProductCard).join('');
    productListEl.innerHTML = html;
  }

  function renderProductCard(product) {
    var sel = selectValues(product);
    var stats = Stats.summarize(sel.values);
    var rec = Stats.recommend(sel.values, state.settings.serviceLevel);

    var recBlock;
    if (rec.recommended === null) {
      recBlock =
        '<div class="rec-box no-data">ยังไม่มีข้อมูลยอดขาย — บันทึกยอดขายอย่างน้อย 1 วันเพื่อเริ่มคำนวณ</div>';
    } else {
      var note = '';
      if (state.settings.byWeekday && sel.fallback) {
        note = '<div class="rec-note">⚠️ ข้อมูลวัน' + WEEKDAYS[state.settings.targetWeekday] +
               'ยังน้อย จึงคำนวณจากทุกวันไปก่อน</div>';
      } else if (sel.weekdayFiltered) {
        note = '<div class="rec-note">📅 คำนวณเฉพาะวัน' + WEEKDAYS[state.settings.targetWeekday] + '</div>';
      }
      recBlock =
        '<div class="rec-box">' +
          '<div class="rec-label">แนะนำให้ทำวันนี้</div>' +
          '<div class="rec-value">' + fmt(rec.recommended, 0) + ' <span class="rec-unit">' + esc(product.unit || 'ชิ้น') + '</span></div>' +
          '<div class="rec-formula">' +
            'เฉลี่ย ' + fmt(rec.mean, 1) + ' + เผื่อ ' + fmt(rec.safetyStock, 1) +
            ' (' + state.settings.serviceLevel + '%)' +
          '</div>' +
          note +
        '</div>';
    }

    var statsGrid =
      '<div class="stats-grid">' +
        statCell('จำนวนวันที่บันทึก', fmt(stats.count, 0) + ' วัน') +
        statCell('ค่าเฉลี่ยเลขคณิต', fmt(stats.mean, 1)) +
        statCell('ส่วนเบี่ยงเบนมาตรฐาน', fmt(stats.stdDev, 1)) +
        statCell('ต่ำสุด – สูงสุด', fmt(stats.min, 0) + ' – ' + fmt(stats.max, 0)) +
      '</div>';

    var records = (product.records || []).slice().sort(function (a, b) {
      return a.date < b.date ? 1 : -1; // ใหม่สุดขึ้นก่อน
    });
    var recordRows = records.map(function (r) {
      return '<li class="record-item">' +
        '<span class="record-date">' + esc(r.date) + ' <em>(วัน' + WEEKDAYS[weekdayOf(r.date)] + ')</em></span>' +
        '<span class="record-qty">' + fmt(r.qty, 0) + '</span>' +
        '<button class="link-danger" data-action="del-record" data-product="' + product.id + '" data-date="' + esc(r.date) + '">ลบ</button>' +
        '</li>';
    }).join('');

    return '' +
      '<div class="card product-card">' +
        '<div class="product-head">' +
          '<h2>' + esc(product.name) + '</h2>' +
          '<button class="link-danger" data-action="del-product" data-product="' + product.id + '">ลบขนมนี้</button>' +
        '</div>' +

        recBlock +
        statsGrid +

        '<form class="add-record-form" data-action="add-record" data-product="' + product.id + '">' +
          '<input type="date" name="date" value="' + todayStr() + '" required>' +
          '<input type="number" name="qty" min="0" step="1" placeholder="ขายได้กี่' + esc(product.unit || 'ชิ้น') + '" required>' +
          '<button type="submit">บันทึกยอดขาย</button>' +
        '</form>' +

        (records.length
          ? '<details class="history"><summary>ประวัติยอดขาย (' + records.length + ' วัน)</summary><ul class="record-list">' + recordRows + '</ul></details>'
          : '') +
      '</div>';
  }

  function statCell(label, value) {
    return '<div class="stat-cell"><div class="stat-label">' + label + '</div>' +
           '<div class="stat-value">' + value + '</div></div>';
  }

  // ---------- การจัดการเหตุการณ์ ----------
  document.getElementById('serviceLevel').addEventListener('input', function (e) {
    state.settings.serviceLevel = +e.target.value;
    document.getElementById('serviceLevelOut').textContent = e.target.value + '%';
    save();
    renderProducts();
  });

  document.getElementById('byWeekday').addEventListener('change', function (e) {
    state.settings.byWeekday = e.target.checked;
    save();
    render();
  });

  document.getElementById('targetWeekday').addEventListener('change', function (e) {
    state.settings.targetWeekday = +e.target.value;
    save();
    renderProducts();
  });

  document.getElementById('addProductForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = document.getElementById('newProductName').value.trim();
    var unit = document.getElementById('newProductUnit').value.trim() || 'ชิ้น';
    if (!name) return;
    state.products.push({ id: uid(), name: name, unit: unit, records: [] });
    save();
    e.target.reset();
    document.getElementById('newProductUnit').value = 'ชิ้น';
    renderProducts();
  });

  // ใช้ event delegation กับรายการขนม (ปุ่ม/ฟอร์มถูกสร้างแบบไดนามิก)
  productListEl.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-action="add-record"]');
    if (!form) return;
    e.preventDefault();
    var productId = form.getAttribute('data-product');
    var product = state.products.find(function (p) { return p.id === productId; });
    if (!product) return;
    var date = form.date.value;
    var qty = parseFloat(form.qty.value);
    if (!date || isNaN(qty) || qty < 0) return;

    // ถ้ามีวันนี้อยู่แล้ว ให้แทนที่ (แก้ยอดขายของวันเดิม)
    var existing = product.records.find(function (r) { return r.date === date; });
    if (existing) {
      existing.qty = qty;
    } else {
      product.records.push({ date: date, qty: qty });
    }
    save();
    renderProducts();
  });

  productListEl.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    var productId = btn.getAttribute('data-product');
    var product = state.products.find(function (p) { return p.id === productId; });
    if (!product) return;

    if (action === 'del-product') {
      if (confirm('ลบขนม "' + product.name + '" และประวัติทั้งหมด?')) {
        state.products = state.products.filter(function (p) { return p.id !== productId; });
        save();
        renderProducts();
      }
    } else if (action === 'del-record') {
      var date = btn.getAttribute('data-date');
      product.records = product.records.filter(function (r) { return r.date !== date; });
      save();
      renderProducts();
    }
  });

  // ---------- จัดการข้อมูล (นำเข้า/ส่งออก/ตัวอย่าง/ล้าง) ----------
  document.getElementById('exportBtn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'khanom-backup-' + todayStr() + '.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('importInput').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var imported = JSON.parse(reader.result);
        if (!imported || !Array.isArray(imported.products)) {
          throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
        }
        state = imported;
        if (!state.settings) state.settings = defaultState().settings;
        save();
        render();
        alert('นำเข้าข้อมูลสำเร็จ');
      } catch (err) {
        alert('นำเข้าไม่สำเร็จ: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('loadSampleBtn').addEventListener('click', function () {
    if (state.products.length && !confirm('เพิ่มขนมตัวอย่างเข้าไปในระบบ?')) return;
    state.products = state.products.concat(sampleProducts());
    save();
    renderProducts();
  });

  document.getElementById('clearBtn').addEventListener('click', function () {
    if (confirm('ล้างข้อมูลทั้งหมดถาวร? การกระทำนี้ย้อนกลับไม่ได้')) {
      state = defaultState();
      save();
      render();
    }
  });

  // สร้างข้อมูลตัวอย่าง 3 สัปดาห์ย้อนหลัง ให้เห็นผลการคำนวณทันที
  function sampleProducts() {
    function buildRecords(base, swing) {
      var recs = [];
      for (var i = 21; i >= 1; i--) {
        var d = new Date();
        d.setDate(d.getDate() - i);
        var wd = d.getDay();
        var weekendBoost = (wd === 0 || wd === 6) ? 1.4 : 1.0; // เสาร์-อาทิตย์ขายดีกว่า
        var noise = (Math.sin(i * 1.7) + Math.cos(i * 0.9)) * swing;
        var qty = Math.max(0, Math.round(base * weekendBoost + noise));
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        recs.push({ date: d.getFullYear() + '-' + m + '-' + day, qty: qty });
      }
      return recs;
    }
    return [
      { id: uid(), name: 'ขนมครก', unit: 'ชิ้น', records: buildRecords(40, 6) },
      { id: uid(), name: 'ทองหยิบ', unit: 'ชิ้น', records: buildRecords(25, 4) }
    ];
  }

  // ---------- เริ่มทำงาน ----------
  render();
})();
