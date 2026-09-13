/* ==========================================================================
   NOXBOX 30 – Buchungslogik
   Alles, was du anpassen musst, steht im CONFIG-Block direkt hier oben.
   ========================================================================== */

var CONFIG = {
  // PayPal: Client-ID aus developer.paypal.com → "Apps & Credentials" (Live!).
  // 'sb' = Sandbox-Testmodus. Damit kann man den Ablauf durchklicken,
  // es fließt aber kein echtes Geld.
  paypalClientId: 'sb',
  currency: 'EUR',

  productName: 'NOXBOX 30 – Nachtclub-Zelt',

  // Preise in Euro. Staffel: 1 Tag / 2 Tage / 3 Tage, danach pro weiterem Tag.
  pricing: {
    day1: 249,
    day2: 399,
    day3: 499,
    extraDay: 89,
    deposit: 300
  },

  // Optionale Extras (einfach Zeilen löschen oder ergänzen).
  extras: [
    { id: 'delivery', label: 'Lieferung, Aufbau & Abbau', hint: 'im Umkreis von 30 km', price: 129 },
    { id: 'fog',      label: 'Nebelmaschine',             hint: 'inkl. 1 l wasserbasiertem Fluid', price: 39 },
    { id: 'bar',      label: 'Bar-Set',                   hint: '2 Stehtische + Getränkekühler XL', price: 49 }
  ],

  // Belegte Tage (Format JJJJ-MM-TT). Nach jeder Buchung hier eintragen.
  blockedDates: [
    '2026-09-19', '2026-09-20',
    '2026-10-03', '2026-10-04',
    '2026-10-31',
    '2026-12-31', '2027-01-01'
  ],

  minLeadDays: 2,   // frühestens in X Tagen buchbar
  maxDays: 14,      // maximale Mietdauer

  // Galerie: Bilder in docs/partyzelt/img/ ablegen. 6–10 Stück, Reihenfolge = Anzeige.
  // Das erste Bild ist gleichzeitig das Hero-Bild.
  images: [
    { src: 'img/zelt-01.jpg', alt: 'NOXBOX 30 bei Nacht mit magentafarbenem Licht',        caption: 'Außenansicht bei Nacht' },
    { src: 'img/zelt-02.jpg', alt: 'Innenraum mit LED-Strips und Spiegelkugel',            caption: 'Innenraum – die Tanzfläche' },
    { src: 'img/zelt-03.jpg', alt: 'Eingang mit Vorhang und Türreißverschluss',            caption: 'Eingang mit Vorhang' },
    { src: 'img/zelt-04.jpg', alt: 'Detail: RGB-LED-Strips am Boden',                     caption: 'LED-Lichtleiste' },
    { src: 'img/zelt-05.jpg', alt: 'Gäste tanzen im Zelt',                                 caption: 'Party mit 15 Gästen' },
    { src: 'img/zelt-06.jpg', alt: 'Zelt bei Tag im Garten',                               caption: 'Bei Tageslicht im Garten' },
    { src: 'img/zelt-07.jpg', alt: 'Gebläse und Transporttaschen',                         caption: 'Gebläse & Transporttaschen' },
    { src: 'img/zelt-08.jpg', alt: 'Bluetooth-Soundsystem im Zelt',                        caption: 'Soundsystem' }
  ]
};

/* ========================================================================== */

(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var fmtMoney = new Intl.NumberFormat('de-DE', { style: 'currency', currency: CONFIG.currency });
  var fmtDate = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  var fmtMonth = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
  var WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  /* ---------- Date helpers (all local, midnight) ---------- */
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fromIso(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
  function sameDay(a, b) { return a && b && a.getTime() === b.getTime(); }

  var BLOCKED = {};
  CONFIG.blockedDates.forEach(function (s) { BLOCKED[s] = true; });
  var MIN_DATE = addDays(today(), CONFIG.minLeadDays);

  function isBlocked(d) { return !!BLOCKED[iso(d)]; }
  function isSelectable(d) { return d >= MIN_DATE && !isBlocked(d); }
  function rangeHasBlocked(a, b) {
    for (var d = new Date(a); d <= b; d = addDays(d, 1)) { if (isBlocked(d)) return true; }
    return false;
  }

  /* ---------- Pricing ---------- */
  function basePrice(days) {
    var p = CONFIG.pricing;
    if (days <= 0) return 0;
    if (days === 1) return p.day1;
    if (days === 2) return p.day2;
    if (days === 3) return p.day3;
    return p.day3 + (days - 3) * p.extraDay;
  }

  /* ---------- State ---------- */
  var state = {
    start: null,
    end: null,
    hover: null,
    viewMonth: new Date(today().getFullYear(), today().getMonth(), 1),
    extras: {}
  };

  /* ================= Image placeholders ================= */
  function placeholderNode(file, label) {
    var div = document.createElement('div');
    div.className = 'placeholder';
    div.innerHTML =
      '<div class="placeholder-inner">' +
        '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-9 8"/></svg>' +
        '<span>' + escapeHtml(label || 'Produktbild') + '</span>' +
        '<code>' + escapeHtml(file) + '</code>' +
      '</div>';
    return div;
  }
  function attachPlaceholder(img, file, label) {
    img.addEventListener('error', function () {
      var ph = placeholderNode(file, label);
      img.replaceWith(ph);
    }, { once: true });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ================= Hero image ================= */
  (function initHero() {
    var img = $('.media-frame img');
    if (!img) return;
    var first = CONFIG.images[0];
    if (first) { img.src = first.src; img.alt = first.alt; }
    attachPlaceholder(img, img.getAttribute('src').replace(/^.*\//, 'img/'), 'Hero-Bild – hier dein bestes Foto');
  })();

  /* ================= Gallery + Lightbox ================= */
  var lbIndex = 0;
  (function initGallery() {
    var wrap = $('#gallery');
    if (!wrap) return;
    CONFIG.images.forEach(function (im, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gallery-item';
      btn.setAttribute('role', 'listitem');
      btn.setAttribute('aria-label', im.caption + ' – Großansicht öffnen');
      var img = document.createElement('img');
      img.src = im.src; img.alt = im.alt; img.loading = 'lazy'; img.width = 800; img.height = 600;
      attachPlaceholder(img, im.src, 'Bild ' + (i + 1));
      btn.appendChild(img);
      var cap = document.createElement('span'); cap.className = 'caption'; cap.textContent = im.caption;
      btn.appendChild(cap);
      btn.addEventListener('click', function () { openLightbox(i); });
      wrap.appendChild(btn);
    });
  })();

  var lb = $('#lightbox');
  function openLightbox(i) {
    lbIndex = i;
    var im = CONFIG.images[i];
    var img = $('#lb-img');
    img.src = im.src; img.alt = im.alt;
    $('#lb-caption').textContent = im.caption;
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    $('#lb-close').focus();
  }
  function closeLightbox() { lb.hidden = true; document.body.style.overflow = ''; }
  function stepLightbox(n) { openLightbox((lbIndex + n + CONFIG.images.length) % CONFIG.images.length); }
  if (lb) {
    $('#lb-close').addEventListener('click', closeLightbox);
    $('#lb-prev').addEventListener('click', function () { stepLightbox(-1); });
    $('#lb-next').addEventListener('click', function () { stepLightbox(1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) closeLightbox(); });
    document.addEventListener('keydown', function (e) {
      if (lb.hidden) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') stepLightbox(-1);
      if (e.key === 'ArrowRight') stepLightbox(1);
    });
  }

  /* ================= Pricing cards ================= */
  (function initPriceCards() {
    var grid = $('#price-grid');
    if (!grid) return;
    var p = CONFIG.pricing;
    var cards = [
      { label: '1 Tag', amount: p.day1, per: 'z. B. Samstag', items: ['Abholung ab 10 Uhr', 'Rückgabe bis 20 Uhr', 'Licht, Sound & Boden inkl.'] },
      { label: '2 Tage', amount: p.day2, per: fmtMoney.format(p.day2 / 2) + ' pro Tag', items: ['Perfekt fürs Wochenende', 'Aufbau am Vortag möglich', 'Licht, Sound & Boden inkl.'], featured: true, tag: 'Beliebt' },
      { label: '3 Tage', amount: p.day3, per: fmtMoney.format(Math.round(p.day3 / 3)) + ' pro Tag', items: ['Freitag bis Sonntag', 'Entspannt auf- und abbauen', 'Licht, Sound & Boden inkl.'] },
      { label: 'Jeder weitere Tag', amount: p.extraDay, per: 'ab dem 4. Tag', items: ['Bis zu ' + CONFIG.maxDays + ' Tage buchbar', 'Ideal für Festivals & Ferien', 'Licht, Sound & Boden inkl.'] }
    ];
    cards.forEach(function (c) {
      var el = document.createElement('article');
      el.className = 'price' + (c.featured ? ' featured' : '');
      el.innerHTML =
        (c.tag ? '<span class="tag">' + c.tag + '</span>' : '') +
        '<span class="label">' + c.label + '</span>' +
        '<span class="amount">' + fmtMoney.format(c.amount) + '</span>' +
        '<span class="per">' + c.per + '</span>' +
        '<ul>' + c.items.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul>' +
        '<a class="btn ' + (c.featured ? 'btn-primary' : 'btn-ghost') + '" href="#buchen">Zeitraum wählen</a>';
      grid.appendChild(el);
    });
  })();

  /* ================= Extras ================= */
  (function initExtras() {
    var list = $('#extras-list');
    if (!list) return;
    if (!CONFIG.extras.length) { $('.extras').hidden = true; return; }
    CONFIG.extras.forEach(function (x) {
      var label = document.createElement('label');
      label.className = 'extra';
      label.innerHTML =
        '<input type="checkbox" data-extra="' + x.id + '">' +
        '<span class="extra-text">' + escapeHtml(x.label) + (x.hint ? '<span>' + escapeHtml(x.hint) + '</span>' : '') + '</span>' +
        '<span class="extra-price">+ ' + fmtMoney.format(x.price) + '</span>';
      label.querySelector('input').addEventListener('change', function (e) {
        state.extras[x.id] = e.target.checked;
        renderSummary();
      });
      list.appendChild(label);
    });
  })();

  /* ================= Calendar ================= */
  var calWrap = $('#calendars');
  var calTitles = $('#cal-titles');
  var calHint = $('#cal-hint');

  function renderCalendar() {
    if (!calWrap) return;
    calWrap.innerHTML = '';
    calTitles.innerHTML = '';
    for (var m = 0; m < 2; m++) {
      var first = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() + m, 1);
      var title = document.createElement('span');
      title.textContent = fmtMonth.format(first);
      calTitles.appendChild(title);
      calWrap.appendChild(renderMonth(first));
    }
    // Prev button: don't go before the current month
    var cur = new Date(today().getFullYear(), today().getMonth(), 1);
    $('#cal-prev').disabled = state.viewMonth <= cur;
    $('#cal-prev').style.opacity = $('#cal-prev').disabled ? 0.35 : 1;
  }

  function renderMonth(first) {
    var grid = document.createElement('div');
    grid.className = 'month';
    grid.setAttribute('role', 'grid');
    WEEKDAYS.forEach(function (w) {
      var el = document.createElement('div'); el.className = 'weekday'; el.textContent = w; grid.appendChild(el);
    });
    var offset = (first.getDay() + 6) % 7; // Monday first
    for (var i = 0; i < offset; i++) {
      var e = document.createElement('div'); e.className = 'day empty'; grid.appendChild(e);
    }
    var daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    var t = today();
    for (var d = 1; d <= daysInMonth; d++) {
      var date = new Date(first.getFullYear(), first.getMonth(), d);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day';
      btn.textContent = d;
      btn.dataset.date = iso(date);
      btn.setAttribute('aria-label', fmtDate.format(date));
      if (sameDay(date, t)) btn.classList.add('today');
      if (date < MIN_DATE) { btn.classList.add('past'); btn.disabled = true; }
      if (isBlocked(date)) { btn.classList.add('blocked'); btn.disabled = true; btn.setAttribute('aria-label', fmtDate.format(date) + ' – belegt'); }

      // Selection classes
      var s = state.start, en = state.end;
      var hoverEnd = (s && !en && state.hover && state.hover > s) ? state.hover : null;
      if (s && sameDay(date, s)) btn.classList.add('range-start');
      if (en && sameDay(date, en)) btn.classList.add('range-end');
      if (s && en && date >= s && date <= en) btn.classList.add('in-range');
      if (s && !en && hoverEnd && date > s && date <= hoverEnd) btn.classList.add('hover-range');
      if (s && !en && sameDay(date, s)) btn.classList.add('range-end');
      if (s && sameDay(date, s)) btn.setAttribute('aria-pressed', 'true');

      btn.addEventListener('click', onDayClick);
      btn.addEventListener('mouseenter', onDayHover);
      grid.appendChild(btn);
    }
    return grid;
  }

  function setHint(text, isError) {
    calHint.textContent = text;
    calHint.classList.toggle('error', !!isError);
  }

  // Hover only toggles classes on the existing buttons; a full re-render here
  // would recreate the element under the cursor and fire mouseenter again.
  function onDayHover(e) {
    if (!state.start || state.end) return;
    state.hover = fromIso(e.currentTarget.dataset.date);
    applyHover();
  }
  function applyHover() {
    var s = state.start;
    var hoverEnd = (s && !state.end && state.hover && state.hover > s) ? state.hover : null;
    $$('.day[data-date]', calWrap).forEach(function (btn) {
      var d = fromIso(btn.dataset.date);
      btn.classList.toggle('hover-range', !!(hoverEnd && d > s && d <= hoverEnd));
    });
  }
  if (calWrap) calWrap.addEventListener('mouseleave', function () { state.hover = null; applyHover(); });

  function onDayClick(e) {
    var date = fromIso(e.currentTarget.dataset.date);
    if (!isSelectable(date)) return;

    if (!state.start || (state.start && state.end)) {
      // new selection
      state.start = date; state.end = null; state.hover = null;
      setHint('Erster Miettag: ' + fmtDate.format(date) + '. Wähle jetzt den letzten Miettag (oder denselben Tag für 1 Tag).');
    } else {
      // second click
      var a = state.start, b = date;
      if (b < a) { var tmp = a; a = b; b = tmp; }
      var days = daysBetween(a, b) + 1;
      if (rangeHasBlocked(a, b)) {
        setHint('In diesem Zeitraum ist das Zelt schon belegt. Bitte einen anderen Zeitraum wählen.', true);
        state.start = date; state.end = null;
      } else if (days > CONFIG.maxDays) {
        setHint('Maximal ' + CONFIG.maxDays + ' Tage am Stück buchbar.', true);
        state.start = date; state.end = null;
      } else {
        state.start = a; state.end = b; state.hover = null;
        setHint(days + (days === 1 ? ' Miettag' : ' Miettage') + ' gewählt. Passt? Dann weiter zu den Extras und zur Zahlung.');
      }
    }
    renderCalendar();
    renderSummary();
  }

  $('#cal-prev').addEventListener('click', function () {
    state.viewMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  $('#cal-next').addEventListener('click', function () {
    state.viewMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() + 1, 1);
    renderCalendar();
  });
  var mq = window.matchMedia('(max-width: 640px)');
  if (mq.addEventListener) mq.addEventListener('change', renderCalendar);

  /* ================= Summary ================= */
  function getBooking() {
    if (!state.start || !state.end) return null;
    var days = daysBetween(state.start, state.end) + 1;
    var base = basePrice(days);
    var extras = CONFIG.extras.filter(function (x) { return state.extras[x.id]; });
    var extrasTotal = extras.reduce(function (s, x) { return s + x.price; }, 0);
    return {
      start: state.start, end: state.end, days: days, base: base,
      extras: extras, extrasTotal: extrasTotal, total: base + extrasTotal
    };
  }

  function renderSummary() {
    var b = getBooking();
    var rangeEl = $('#summary-range');
    var linesEl = $('#price-lines');
    var totalEl = $('#total-amount');
    if (!b) {
      rangeEl.innerHTML = '<span class="muted">Noch kein Zeitraum gewählt</span>';
      linesEl.innerHTML = '';
      totalEl.textContent = fmtMoney.format(0);
      return;
    }
    var rangeText = sameDay(b.start, b.end)
      ? fmtDate.format(b.start)
      : fmtDate.format(b.start) + ' – ' + fmtDate.format(b.end);
    rangeEl.innerHTML = '<strong>' + rangeText + '</strong><span class="days">' + b.days + (b.days === 1 ? ' Miettag' : ' Miettage') + '</span>';

    var lines = ['<div><span>' + CONFIG.productName + ' · ' + b.days + (b.days === 1 ? ' Tag' : ' Tage') + '</span><span>' + fmtMoney.format(b.base) + '</span></div>'];
    b.extras.forEach(function (x) {
      lines.push('<div><span>' + escapeHtml(x.label) + '</span><span>' + fmtMoney.format(x.price) + '</span></div>');
    });
    linesEl.innerHTML = lines.join('');
    totalEl.textContent = fmtMoney.format(b.total);
  }
  renderCalendar();
  renderSummary();

  /* ================= Form validation ================= */
  var formError = $('#form-error');
  function showFormError(msg) {
    formError.textContent = msg;
    formError.hidden = !msg;
  }
  function validate() {
    var b = getBooking();
    var errors = [];
    $$('#booking-form .invalid').forEach(function (el) { el.classList.remove('invalid'); });

    if (!b) errors.push('Bitte zuerst einen Zeitraum im Kalender wählen.');

    var name = $('#f-name'), email = $('#f-email'), phone = $('#f-phone'), terms = $('#f-terms');
    if (!name.value.trim()) { name.classList.add('invalid'); errors.push('Bitte deinen Namen eintragen.'); }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { email.classList.add('invalid'); errors.push('Bitte eine gültige E-Mail-Adresse eintragen.'); }
    if (phone.value.replace(/\D/g, '').length < 6) { phone.classList.add('invalid'); errors.push('Bitte eine Telefonnummer eintragen.'); }
    if (!terms.checked) { terms.closest('.check').classList.add('invalid'); errors.push('Bitte Mietbedingungen und Hausregeln akzeptieren.'); }

    showFormError(errors.length ? errors[0] : '');
    return errors.length === 0;
  }
  $('#booking-form').addEventListener('submit', function (e) { e.preventDefault(); validate(); });
  $$('#booking-form input, #booking-form textarea').forEach(function (el) {
    el.addEventListener('input', function () { el.classList.remove('invalid'); if (el.type === 'checkbox') el.closest('.check').classList.remove('invalid'); showFormError(''); });
  });

  /* ================= PayPal ================= */
  function loadPayPal() {
    var container = $('#paypal-button-container');
    if (!container) return;
    if (CONFIG.paypalClientId === 'sb') {
      var note = document.createElement('p');
      note.className = 'test-mode';
      note.textContent = 'Testmodus: PayPal läuft im Sandbox-Modus. Für echte Zahlungen die Live-Client-ID in app.js eintragen.';
      container.parentNode.insertBefore(note, container);
    }
    var s = document.createElement('script');
    s.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(CONFIG.paypalClientId) +
            '&currency=' + CONFIG.currency + '&intent=capture&locale=de_DE&disable-funding=paylater';
    s.async = true;
    s.onload = renderPayPal;
    s.onerror = function () { $('#paypal-fallback').hidden = false; };
    document.head.appendChild(s);
  }

  function bookingDescription(b) {
    var range = sameDay(b.start, b.end) ? iso(b.start) : iso(b.start) + ' bis ' + iso(b.end);
    var desc = CONFIG.productName + ' · ' + range + ' (' + b.days + (b.days === 1 ? ' Tag' : ' Tage') + ')';
    if (b.extras.length) desc += ' · Extras: ' + b.extras.map(function (x) { return x.label; }).join(', ');
    return desc.slice(0, 127); // PayPal limit
  }

  function renderPayPal() {
    if (!window.paypal) { $('#paypal-fallback').hidden = false; return; }
    window.paypal.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'paypal', height: 48 },

      onClick: function (data, actions) {
        return validate() ? actions.resolve() : actions.reject();
      },

      createOrder: function (data, actions) {
        var b = getBooking();
        var customer = $('#f-name').value.trim() + ' | ' + $('#f-email').value.trim() + ' | ' + $('#f-phone').value.trim();
        var note = $('#f-note').value.trim();
        return actions.order.create({
          purchase_units: [{
            description: bookingDescription(b),
            custom_id: (customer + (note ? ' | ' + note : '')).slice(0, 127),
            invoice_id: 'NOX-' + iso(b.start).replace(/-/g, '') + '-' + Date.now().toString(36).toUpperCase(),
            amount: {
              currency_code: CONFIG.currency,
              value: b.total.toFixed(2),
              breakdown: {
                item_total: { currency_code: CONFIG.currency, value: b.total.toFixed(2) }
              }
            },
            items: [{
              name: CONFIG.productName,
              description: (b.days + (b.days === 1 ? ' Miettag' : ' Miettage') + ', ' + fmtDate.format(b.start) + (sameDay(b.start, b.end) ? '' : ' – ' + fmtDate.format(b.end))).slice(0, 127),
              quantity: '1',
              unit_amount: { currency_code: CONFIG.currency, value: b.base.toFixed(2) },
              category: 'DIGITAL_GOODS'
            }].concat(b.extras.map(function (x) {
              return {
                name: x.label.slice(0, 127),
                description: (x.hint || '').slice(0, 127),
                quantity: '1',
                unit_amount: { currency_code: CONFIG.currency, value: x.price.toFixed(2) },
                category: 'DIGITAL_GOODS'
              };
            }))
          }],
          application_context: { shipping_preference: 'NO_SHIPPING', brand_name: 'NOXBOX Zeltvermietung' }
        });
      },

      onApprove: function (data, actions) {
        return actions.order.capture().then(function (details) {
          var b = getBooking();
          var payer = details && details.payer && details.payer.name ? details.payer.name.given_name : $('#f-name').value.trim();
          var range = sameDay(b.start, b.end) ? fmtDate.format(b.start) : fmtDate.format(b.start) + ' bis ' + fmtDate.format(b.end);
          $('#success-text').textContent =
            'Danke, ' + payer + '! Die NOXBOX 30 ist für dich reserviert: ' + range + ' (' + b.days + (b.days === 1 ? ' Tag' : ' Tage') + '). ' +
            'Bezahlt: ' + fmtMoney.format(b.total) + '. Buchungsnummer ' + (details.id || data.orderID) + '.';
          $('#success').hidden = false;
          document.body.style.overflow = 'hidden';
        });
      },

      onError: function (err) {
        console.error('PayPal error', err);
        showFormError('Die Zahlung konnte nicht abgeschlossen werden. Bitte versuch es noch einmal oder schreib uns.');
      },

      onCancel: function () {
        showFormError('Zahlung abgebrochen. Deine Auswahl bleibt erhalten – du kannst jederzeit erneut zahlen.');
      }
    }).render('#paypal-button-container');
  }

  $('#success-close').addEventListener('click', function () {
    $('#success').hidden = true;
    document.body.style.overflow = '';
    // reset selection so the same slot isn't booked twice by accident
    state.start = null; state.end = null; state.extras = {};
    $$('#extras-list input').forEach(function (i) { i.checked = false; });
    $('#booking-form').reset();
    renderCalendar(); renderSummary();
    setHint('Wähle den ersten Miettag.');
  });

  loadPayPal();

  /* ================= Misc UI ================= */
  // Mobile nav
  var toggle = $('.nav-toggle'), menu = $('#nav-menu');
  toggle.addEventListener('click', function () {
    var open = menu.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
  });
  $$('#nav-menu a').forEach(function (a) {
    a.addEventListener('click', function () { menu.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); });
  });

  // Footer year
  $('#year').textContent = new Date().getFullYear();

  // Reveal on scroll
  if ('IntersectionObserver' in window) {
    var targets = $$('.feature, .gallery-item, .price, .steps li, .faq, .specs > div');
    targets.forEach(function (el) { el.classList.add('reveal'); });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('visible'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    targets.forEach(function (el) { io.observe(el); });
  }
})();
