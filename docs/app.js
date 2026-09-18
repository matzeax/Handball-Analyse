'use strict';

/* ══════════════════════ constants ══════════════════════ */

var APP_VERSION = '2026-09-18e';
var STORAGE_KEY = 'handball-tracker-v1';

var ATT = [
  { code: 'tor', label: 'Tor', pos: 1, shot: 1, goal: 1 },
  { code: 'tempo', label: 'Tempo-Tor', pos: 1, shot: 1, goal: 1, excludeFromAttackTime: 1 },
  { code: 'assist', label: 'Assist', pos: 1 },
  { code: 'erzw7', label: '7m erzwungen', pos: 1 },
  { code: 'fehlwurf', label: 'Fehlwurf', shot: 1, neg: 1 },
  { code: 'fehlpass', label: 'Fehlpass', neg: 1 },
  { code: 'stuermer', label: 'Stürmerfoul', neg: 1 },
  { code: 'schritt', label: 'Schrittfehler', neg: 1 }
];
var DEF = [
  { code: 'ballgewinn', label: 'Ballgewinn', pos: 1 },
  { code: 'block', label: 'Block', pos: 1 },
  { code: 'stellung', label: 'Stellungsfehler', neg: 1 },
  { code: 'gegentor', label: 'Gegentor zugel.', neg: 1, startsAttack: 1 },
  { code: 'verurs7', label: '7m verursacht', neg: 1 },
  { code: 'zeit2', label: 'Zeitstrafe 2′', neg: 1, strafe: 1 },
  // Gegner-Aktion, keinem eigenen Spieler zugeordnet - eigener Platz/Ton im Abwehr-Block
  { code: 'oppFehlwurf', label: 'Gegner Fehlwurf', opp: 1, startsAttack: 1 },
  { code: 'twSave', label: 'Torwart gehalten', opp: 1, startsAttack: 1, pickPos: 'TW' }
];
var ATT_CODES = {};
ATT.forEach(function (a) { ATT_CODES[a.code] = true; });
var ACTION_BY_CODE = {};
ATT.concat(DEF).forEach(function (a) { ACTION_BY_CODE[a.code] = a; });

// Standard-Wertigkeiten für die Bilanz - vor der Wertigkeiten-Funktion konnte
// jede Aktion nur +1/-1 zählen; hier lässt sich jede Aktion einzeln gewichten.
// Die Werte entsprechen dem bisherigen Verhalten, bis der Trainer sie in der
// Kader-Verwaltung anpasst. "Gegner Fehlwurf" fehlt bewusst - die Aktion wird
// nie einem eigenen Spieler zugeordnet und geht daher nie in eine Bilanz ein.
var WEIGHT_DEFAULTS = {
  tor: 1, tempo: 1, assist: 1, erzw7: 1,
  fehlwurf: -1, fehlpass: -1, stuermer: -1, schritt: -1,
  ballgewinn: 1, block: 1, stellung: -1, gegentor: -1, verurs7: -1, zeit2: -1,
  twSave: 1
};
function getWeight(code) {
  if (state.weights && state.weights[code] != null) return state.weights[code];
  return WEIGHT_DEFAULTS[code] || 0;
}
// Aktionen, die in der Wertigkeiten-Liste editierbar sind - alle außer
// Gegner-Aktionen ohne Spielerzuordnung (opp ohne pickPos, z.B. Gegner Fehlwurf).
var WEIGHTABLE_ACTIONS = ATT.concat(DEF.filter(function (a) { return !a.opp || a.pickPos; }));

var POSITIONS = [
  { code: '', label: '–' },
  { code: 'TW', label: 'TW · Torwart' },
  { code: 'LA', label: 'LA · Linksaußen' },
  { code: 'RL', label: 'RL · Rückraum links' },
  { code: 'RM', label: 'RM · Rückraum Mitte' },
  { code: 'RR', label: 'RR · Rückraum rechts' },
  { code: 'KM', label: 'KM · Kreisläufer' },
  { code: 'RA', label: 'RA · Rechtsaußen' }
];

var SEED_PLAYER_COUNT = 16;

/* ══════════════════════ helpers ══════════════════════ */

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  var m = Math.floor(sec / 60), s = sec % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}
function signed(n) { return (n > 0 ? '+' : '') + n; }
function todayISO() {
  var d = new Date();
  var mo = String(d.getMonth() + 1).padStart(2, '0');
  var da = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mo + '-' + da;
}
function fmtDate(iso) {
  if (!iso) return '';
  var p = iso.split('-');
  if (p.length !== 3) return iso;
  return p[2] + '.' + p[1] + '.';
}
function halfLimitSec(g) { return (g.halfMinutes || 30) * 60; }

/* ══════════════════════ state & persistence ══════════════════════ */

function blankStats() {
  return { tore: 0, wuerfe: 0, assist: 0, fehlwuerfe: 0, ballverluste: 0, angFehler: 0, ballgewinn: 0, block: 0, abwFehler: 0, strafen: 0, erzw7: 0 };
}
function addStats(target, src) {
  Object.keys(target).forEach(function (k) { target[k] += (src && src[k]) || 0; });
}

function seedRoster() {
  var roster = [];
  for (var i = 0; i < SEED_PLAYER_COUNT; i++) {
    roster.push({ id: 'p' + (i + 1), nr: null, name: '', pos: '', active: true });
  }
  return roster;
}

function defaultState() {
  return {
    teamName: 'Meine Mannschaft',
    roster: seedRoster(),
    currentGame: null,
    archive: [],
    view: 'live',
    sel: null,
    sort: 'balance',
    seasonSort: 'tore',
    seasonDir: 'desc',
    weights: Object.assign({}, WEIGHT_DEFAULTS)
  };
}

var state = load();
var newGameDialog = null; // { opponent, homeAway, date, halfMinutes, rosterIds, error }
var endGameDialog = false;
var twPicker = null; // { sec } - Sekunde beim Drücken von "Torwart gehalten", bis der Keeper gewählt ist

function load() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    var parsed = JSON.parse(raw);
    var def = defaultState();
    parsed.teamName = parsed.teamName || def.teamName;
    parsed.roster = Array.isArray(parsed.roster) && parsed.roster.length ? parsed.roster : def.roster;
    parsed.view = parsed.view || 'live';
    parsed.sort = parsed.sort || 'balance';
    parsed.seasonSort = parsed.seasonSort || 'tore';
    parsed.seasonDir = parsed.seasonDir === 'asc' ? 'asc' : 'desc';
    // Defaults zuerst, gespeicherte Werte überschreiben sie - so bekommen
    // neu hinzugekommene Aktionen automatisch eine sinnvolle Wertigkeit.
    parsed.weights = Object.assign({}, WEIGHT_DEFAULTS, parsed.weights || {});
    if (parsed.currentGame && parsed.currentGame.running && parsed.currentGame.lastTickAt) {
      var elapsed = Math.round((Date.now() - parsed.currentGame.lastTickAt) / 1000);
      if (elapsed > 0) parsed.currentGame.sec += elapsed;
      parsed.currentGame.lastTickAt = Date.now();
      var limit0 = halfLimitSec(parsed.currentGame);
      if (parsed.currentGame.sec >= limit0) {
        parsed.currentGame.sec = limit0;
        parsed.currentGame.running = false;
      }
    }
    return parsed;
  } catch (e) {
    return defaultState();
  }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
}

/* ══════════════════════ game model ══════════════════════ */

function createGame(fields) {
  return {
    id: uid('g'),
    opponent: fields.opponent,
    homeAway: fields.homeAway,
    date: fields.date,
    halfMinutes: fields.halfMinutes,
    rosterIds: fields.rosterIds.slice(),
    events: [],
    them: 0,
    sec: 0,
    half: 1,
    running: false,
    lastTickAt: null
  };
}

function computeStats(game) {
  var map = {};
  var ids = {};
  (game.rosterIds || []).forEach(function (id) { ids[id] = true; });
  game.events.forEach(function (e) { ids[e.playerId] = true; });
  Object.keys(ids).forEach(function (id) { map[id] = blankStats(); });
  game.events.forEach(function (e) {
    var a = ACTION_BY_CODE[e.code];
    var s = map[e.playerId];
    if (!a || !s) return;
    var isAtt = !!ATT_CODES[a.code];
    if (a.goal) s.tore++;
    if (a.shot) s.wuerfe++;
    if (a.code === 'assist') s.assist++;
    if (a.code === 'erzw7') s.erzw7++;
    if (a.strafe) s.strafen++;
    else if (a.neg) {
      if (isAtt) {
        s.angFehler++;                                  // Angriffsfehler gesamt
        if (a.shot) s.fehlwuerfe++; else s.ballverluste++; // Fehlwurf vs. Ballverlust ohne Abschluss
      } else s.abwFehler++;
    }
    if (a.code === 'ballgewinn') s.ballgewinn++;
    if (a.code === 'block') s.block++;
  });
  return map;
}

// Bilanz = Summe der Wertigkeiten der eigenen Aktionen eines Spielers, getrennt
// nach Angriff/Abwehr. Ersetzt die frühere feste +1/-1 Zählung pro Kategorie.
function weightedScoresForGame(game) {
  var map = {};
  game.events.forEach(function (e) {
    if (e.playerId == null) return; // Gegner-Aktionen zählen in keine Spieler-Bilanz
    var a = ACTION_BY_CODE[e.code];
    if (!a) return;
    if (!map[e.playerId]) map[e.playerId] = { att: 0, def: 0 };
    var w = getWeight(e.code);
    if (ATT_CODES[a.code]) map[e.playerId].att += w; else map[e.playerId].def += w;
  });
  return map;
}
function sumWeightedScores(games) {
  var total = {};
  games.forEach(function (game) {
    var ws = weightedScoresForGame(game);
    Object.keys(ws).forEach(function (id) {
      if (!total[id]) total[id] = { att: 0, def: 0 };
      total[id].att += ws[id].att; total[id].def += ws[id].def;
    });
  });
  return total;
}
function attScore(ws) { return ws.att; }
function defScore(ws) { return ws.def; }
function balance(ws) { return ws.att + ws.def; }
function quote(s) { return s.wuerfe ? Math.round((s.tore / s.wuerfe) * 100) : 0; }

// Angriffszeit: Sekunden ab einem Ballübergang zu uns - Gegentor (Abwehr-Aktion
// oder das Plus am Spielstand) oder Gegner-Fehlwurf - bis zur nächsten
// Angriffsaktion, die kein Assist und kein erzwungener 7m ist - beide zählen
// als Randnotiz zu einer Aktion, nicht als deren Abschluss, also wird bei
// ihnen weiter auf die eigentliche Aktion gewartet. Tempo-Tore beenden die
// Wartezeit zwar, gehen aber nicht in den Schnitt ein - sie sind naturgemäß
// zu schnell, um eine normale Angriffszeit widerzuspiegeln.
function attackTimes(game) {
  var times = [];
  var pendingSince = null;
  game.events.forEach(function (e) {
    var a = ACTION_BY_CODE[e.code];
    if (a && a.startsAttack) { pendingSince = e.sec; return; }
    if (pendingSince == null) return;
    if (!a || !ATT_CODES[a.code]) return; // Abwehraktionen unterbrechen die Wartezeit nicht
    if (a.code === 'assist' || a.code === 'erzw7') return; // noch nicht der Abschluss
    var dur = e.sec - pendingSince;
    pendingSince = null;
    if (a.excludeFromAttackTime) return; // z.B. Tempo-Tor: zählt als Abschluss, aber nicht in den Schnitt
    if (dur >= 0) times.push(dur); // negative Werte = über eine Halbzeitgrenze hinweg, verwerfen
  });
  return times;
}
function avgAttackTimeSec(games) {
  var all = [];
  games.forEach(function (g) { all = all.concat(attackTimes(g)); });
  if (!all.length) return null;
  var sum = all.reduce(function (a, b) { return a + b; }, 0);
  return { avg: sum / all.length, count: all.length };
}

// Angriffszeit des Gegners: das Spiegelbild von attackTimes(). Jede unserer
// eigenen Angriffsaktionen, die auch attackTimes() beendet (Tor, Tempo-Tor,
// Fehlwurf, Fehlpass, Stürmerfoul, Schrittfehler - alles außer Assist/7m
// erzwungen), beendet unseren Angriff und startet damit den des Gegners.
// Jede startsAttack-Aktion (Gegentor, Gegner Fehlwurf, Torwart gehalten,
// das Plus) beendet wiederum den Angriff des Gegners. Keine neuen Buttons
// nötig - dieselben Ereignisse, nur aus der anderen Richtung gelesen.
function oppAttackTimes(game) {
  var times = [];
  var pendingSince = null;
  game.events.forEach(function (e) {
    var a = ACTION_BY_CODE[e.code];
    if (!a) return;
    if (a.startsAttack) {
      if (pendingSince != null) {
        var dur = e.sec - pendingSince;
        pendingSince = null;
        if (dur >= 0) times.push(dur);
      }
      return;
    }
    if (ATT_CODES[a.code] && a.code !== 'assist' && a.code !== 'erzw7') pendingSince = e.sec;
  });
  return times;
}
function avgOppAttackTimeSec(games) {
  var all = [];
  games.forEach(function (g) { all = all.concat(oppAttackTimes(g)); });
  if (!all.length) return null;
  var sum = all.reduce(function (a, b) { return a + b; }, 0);
  return { avg: sum / all.length, count: all.length };
}

function playerById(id) {
  for (var i = 0; i < state.roster.length; i++) if (state.roster[i].id === id) return state.roster[i];
  return null;
}
function sortedRoster(list) {
  return list.slice().sort(function (a, b) {
    var an = a.nr == null ? Infinity : a.nr, bn = b.nr == null ? Infinity : b.nr;
    if (an !== bn) return an - bn;
    return 0;
  });
}

/* ══════════════════════ actions ══════════════════════ */

function switchView(v) { state.view = v; state.sel = null; save(); render(); }

function selectPlayer(id) { state.sel = state.sel === id ? null : id; save(); render(); }

function recordEvent(code) {
  var g = state.currentGame;
  if (!g || !state.sel) return;
  g.events.push({ id: uid('e'), playerId: state.sel, code: code, sec: g.sec });
  if (code === 'gegentor') g.them++;
  save(); render();
}
function recordOppEvent(code) {
  // Gegner-Aktion: keinem eigenen Spieler zugeordnet, braucht daher keine Auswahl
  var g = state.currentGame;
  if (!g) return;
  g.events.push({ id: uid('e'), playerId: null, code: code, sec: g.sec });
  save(); render();
}
function openPlayerPicker(code) {
  // merkt sich die Sekunde beim Drücken, damit die Zeit stimmt, auch wenn
  // die Auswahl des Spielers (z.B. Torwart) einen Moment dauert
  var g = state.currentGame;
  if (!g) return;
  twPicker = { code: code, sec: g.sec };
  render();
}
function closePlayerPicker() { twPicker = null; render(); }
function pickPlayerForEvent(playerId) {
  var g = state.currentGame;
  if (!g || !twPicker) return;
  g.events.push({ id: uid('e'), playerId: playerId, code: twPicker.code, sec: twPicker.sec });
  twPicker = null;
  save(); render();
}
function undoLast() {
  var g = state.currentGame;
  if (!g || !g.events.length) return;
  g.events.pop();
  save(); render();
}
function removeEvent(id) {
  var g = state.currentGame;
  if (!g) return;
  g.events = g.events.filter(function (e) { return e.id !== id; });
  save(); render();
}
function toggleClock() {
  var g = state.currentGame;
  if (!g) return;
  g.running = !g.running;
  g.lastTickAt = Date.now();
  save(); render();
}
function nextHalf() {
  var g = state.currentGame;
  if (!g) return;
  if (g.half === 1) { g.half = 2; g.sec = 0; }
  else { g.half = 1; g.sec = 0; }
  save(); render();
}
function themDelta(n) {
  var g = state.currentGame;
  if (!g) return;
  g.them = Math.max(0, g.them + n);
  // a goal conceded via the quick +, not attributed to a defender, still marks
  // the start of our next attack for the Ø Angriffszeit measurement below
  if (n > 0) g.events.push({ id: uid('e'), playerId: null, code: 'gegentor', sec: g.sec });
  save(); render();
}

function openNewGameDialog() {
  var activeIds = state.roster.filter(function (p) { return p.active; }).map(function (p) { return p.id; });
  newGameDialog = { opponent: '', homeAway: 'Heim', date: todayISO(), halfMinutes: 30, rosterIds: activeIds, error: '' };
  render();
}
function closeNewGameDialog() { newGameDialog = null; render(); }
function submitNewGame() {
  if (!newGameDialog) return;
  var opp = (newGameDialog.opponent || '').trim();
  if (!opp) { newGameDialog.error = 'Bitte einen Gegner eintragen.'; render(); return; }
  if (!newGameDialog.rosterIds.length) { newGameDialog.error = 'Bitte mindestens einen Spieler auswählen.'; render(); return; }
  if (state.currentGame) state.archive.push(state.currentGame);
  state.currentGame = createGame({
    opponent: opp,
    homeAway: newGameDialog.homeAway,
    date: newGameDialog.date || todayISO(),
    halfMinutes: Number(newGameDialog.halfMinutes) || 30,
    rosterIds: newGameDialog.rosterIds
  });
  state.view = 'live';
  state.sel = null;
  newGameDialog = null;
  save(); render();
}

function openEndGameDialog() { if (state.currentGame) { endGameDialog = true; render(); } }
function closeEndGameDialog() { endGameDialog = false; render(); }
function confirmEndGame() {
  if (state.currentGame) {
    state.currentGame.running = false;
    state.archive.push(state.currentGame);
    state.currentGame = null;
  }
  endGameDialog = false;
  state.view = 'season';
  state.sel = null;
  save(); render();
}

function deleteArchiveGame(id) {
  state.archive = state.archive.filter(function (g) { return g.id !== id; });
  save(); render();
}

function addRosterPlayer() {
  state.roster.push({ id: uid('p'), nr: null, name: '', pos: '', active: true });
  save(); render();
}
function deleteRosterPlayer(id) {
  state.roster = state.roster.filter(function (p) { return p.id !== id; });
  save(); render();
}
function resetWeights() {
  state.weights = Object.assign({}, WEIGHT_DEFAULTS);
  save(); render();
}

/* ══════════════════════ ticking clock ══════════════════════ */

setInterval(function () {
  var g = state.currentGame;
  if (g && g.running) {
    var limit = halfLimitSec(g);
    var wasBelowLimit = g.sec < limit;
    g.sec++;
    g.lastTickAt = Date.now();
    if (wasBelowLimit && g.sec >= limit) {
      g.sec = limit;
      g.running = false;
      save();
      render();
      return;
    }
    save();
    var el = document.getElementById('clockTime');
    if (el) el.textContent = fmtClock(g.sec);
  }
}, 1000);

/* ══════════════════════ rendering ══════════════════════ */

function trashIcon() {
  return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6l-.8 13.1a2 2 0 0 1-2 1.9H7.8a2 2 0 0 1-2-1.9L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';
}
function corners() {
  return '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';
}

function renderHeader() {
  var g = state.currentGame;
  var title = esc(state.teamName) + (g ? ' – ' + esc(g.opponent) : ' – Kein aktives Spiel');
  var tabs = [
    { key: 'live', label: 'Erfassen' },
    { key: 'eval', label: 'Auswertung' },
    { key: 'season', label: 'Saison' },
    { key: 'roster', label: 'Kader' }
  ].map(function (t) {
    return '<button class="tab-btn' + (state.view === t.key ? ' active' : '') + '" data-act="switch-tab" data-view="' + t.key + '">' + t.label + '</button>';
  }).join('');

  var middle;
  if (g) {
    var stats = computeStats(g);
    var scoreUs = 0;
    Object.keys(stats).forEach(function (id) { scoreUs += stats[id].tore; });
    middle =
      '<div class="score-block">' +
        '<div class="score-display"><span>' + scoreUs + '</span><span class="score-sep">:</span><span class="score-them">' + g.them + '</span></div>' +
        '<div class="score-btns">' +
          '<button class="score-btn" data-act="them-plus">+</button>' +
          '<button class="score-btn" data-act="them-minus">–</button>' +
        '</div>' +
      '</div>' +
      '<div class="clock-block">' +
        '<div><div class="clock-time" id="clockTime">' + fmtClock(g.sec) + '</div><div class="clock-half">' + g.half + '. Halbzeit</div></div>' +
        '<button class="header-btn" data-act="toggle-clock">' + (g.running ? 'Stop' : 'Start') + '</button>' +
        '<button class="header-btn" data-act="next-half">Halbzeit</button>' +
        '<button class="header-btn warn" data-act="open-end-game">Spiel beenden</button>' +
      '</div>';
  } else {
    middle = '<button class="header-btn" data-act="open-new-game" style="background:var(--color-accent);border-color:var(--color-accent)">+ Neues Spiel</button>';
  }

  return (
    '<header class="app-header">' +
      '<div class="app-header-title"><div class="app-header-kicker">Spielanalyse · v' + APP_VERSION + '</div><div class="app-header-match">' + title + '</div></div>' +
      middle +
      '<div class="tabs">' + tabs + '</div>' +
      '<a class="header-btn header-link" href="wurfbild/index.html" title="Zum Wurfbild der Gegenspieler wechseln">Wurfbild ↗</a>' +
    '</header>'
  );
}

function renderEmptyState(text, showCta) {
  return (
    '<div class="empty-state">' +
      '<p>' + text + '</p>' +
      (showCta ? '<button class="btn btn-primary" data-act="open-new-game">+ Neues Spiel starten</button>' : '') +
    '</div>'
  );
}

function renderLive() {
  var g = state.currentGame;
  if (!g) {
    return '<div class="view">' + renderEmptyState('Es läuft aktuell kein Spiel. Starte ein neues Spiel, um Aktionen zu erfassen.', true) + '</div>';
  }
  var roster = sortedRoster(state.roster.filter(function (p) { return g.rosterIds.indexOf(p.id) > -1; }));
  var stats = computeStats(g);
  var wscores = weightedScoresForGame(g);

  var rosterHtml = roster.map(function (p) {
    var s = stats[p.id] || blankStats();
    var ws = wscores[p.id] || { att: 0, def: 0 };
    var on = state.sel === p.id;
    return (
      '<button class="roster-item' + (on ? ' active' : '') + '" data-act="select-player" data-id="' + p.id + '">' +
        '<span class="roster-nr">' + (p.nr != null ? p.nr : '–') + '</span>' +
        '<span class="roster-name-col"><span class="roster-name">' + esc(p.name || '(ohne Namen)') + '</span><span class="roster-pos">' + esc(p.pos || '–') + '</span></span>' +
        '<span class="roster-tally">' + s.tore + '/' + signed(balance(ws)) + '</span>' +
      '</button>'
    );
  }).join('');

  var selPlayer = state.sel ? playerById(state.sel) : null;
  var selStats = state.sel ? (stats[state.sel] || blankStats()) : null;

  function countFor(code) {
    if (!selStats) return '';
    var n = g.events.filter(function (e) { return e.playerId === state.sel && e.code === code; }).length;
    return n ? String(n) : '–';
  }
  function actionBtn(a, cls) {
    var disabled = state.sel ? '' : ' disabled';
    return (
      '<button class="action-btn ' + cls + '" data-act="record" data-code="' + a.code + '"' + disabled + '>' +
        '<span class="action-label">' + esc(a.label) + '</span>' +
        '<span class="action-count">' + countFor(a.code) + '</span>' +
      '</button>'
    );
  }
  function countForOpp(code) {
    var n = g.events.filter(function (e) { return e.playerId == null && e.code === code; }).length;
    return n ? String(n) : '–';
  }
  function countForAnyPlayer(code) {
    var n = g.events.filter(function (e) { return e.code === code; }).length;
    return n ? String(n) : '–';
  }
  function oppActionBtn(a) {
    return (
      '<button class="action-btn opp" data-act="record-opp" data-code="' + a.code + '">' +
        '<span class="action-label">' + esc(a.label) + '</span>' +
        '<span class="action-count">' + countForOpp(a.code) + '</span>' +
      '</button>'
    );
  }
  function pickerActionBtn(a) {
    return (
      '<button class="action-btn opp" data-act="open-player-picker" data-code="' + a.code + '">' +
        '<span class="action-label">' + esc(a.label) + '</span>' +
        '<span class="action-count">' + countForAnyPlayer(a.code) + '</span>' +
      '</button>'
    );
  }

  var attGood = ATT.filter(function (a) { return a.pos; }).map(function (a) { return actionBtn(a, 'good'); }).join('');
  var attBad = ATT.filter(function (a) { return a.neg; }).map(function (a) { return actionBtn(a, 'bad'); }).join('');
  var defGood = DEF.filter(function (a) { return a.pos; }).map(function (a) { return actionBtn(a, 'good'); }).join('');
  var defBad = DEF.filter(function (a) { return a.neg && !a.opp; }).map(function (a) { return actionBtn(a, 'bad'); }).join('');
  var defOpp = DEF.filter(function (a) { return a.opp; }).map(function (a) { return a.pickPos ? pickerActionBtn(a) : oppActionBtn(a); }).join('');

  var log = g.events.filter(function (e) { return !!ACTION_BY_CODE[e.code]; }).slice().reverse().slice(0, 8).map(function (e) {
    var a = ACTION_BY_CODE[e.code];
    var p = playerById(e.playerId);
    var side = ATT_CODES[a.code] ? 'Angriff' : 'Abwehr';
    var playerLabel = p ? ((p.nr != null ? p.nr + ' ' : '') + esc(p.name)) : '—';
    return (
      '<div class="log-row">' +
        '<span class="log-time">' + fmtClock(e.sec) + '</span>' +
        '<span class="log-side">' + side + '</span>' +
        '<span class="log-text"><strong>' + playerLabel + '</strong> · ' + esc(a.label) + '</span>' +
        '<button class="log-remove" data-act="remove-log" data-id="' + e.id + '" title="Aktion löschen" aria-label="Aktion löschen">' + trashIcon() + '</button>' +
      '</div>'
    );
  }).join('');

  return (
    '<div class="live-grid">' +
      '<section class="roster-panel"><h6>Kader antippen</h6>' + rosterHtml + '</section>' +
      '<section class="record-panel">' +
        '<div class="record-head">' +
          '<div class="record-head-title">' + (selPlayer ? esc((selPlayer.nr != null ? selPlayer.nr + ' ' : '') + selPlayer.name) : 'Kein Spieler gewählt') + '</div>' +
          '<div class="record-head-hint">' + (selPlayer ? esc(selPlayer.pos || '') + ' · Aktion antippen, um sie zu buchen' : 'Links einen Spieler antippen') + '</div>' +
          '<button class="btn btn-secondary record-undo" data-act="undo"' + (g.events.length ? '' : ' disabled') + '>Letzte Aktion zurück</button>' +
        '</div>' +
        '<div class="action-grids">' +
          '<div class="blueprint action-block">' + corners() +
            '<div class="action-head"><h4>Angriff</h4><span class="action-sub">Abschluss · Ballverlust</span></div>' +
            '<div class="action-buttons">' + attGood + attBad + '</div>' +
          '</div>' +
          '<div class="blueprint action-block">' + corners() +
            '<div class="action-head"><h4>Abwehr</h4><span class="action-sub">Gewinn · Fehler · Strafe</span></div>' +
            '<div class="action-buttons">' + defGood + defBad + '</div>' +
            (defOpp ? '<div class="action-extra">' + defOpp + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<div class="log-section"><h6>Protokoll · ' + g.events.length + ' Aktionen</h6>' + log + '</div>' +
      '</section>' +
    '</div>'
  );
}

function renderEval() {
  var g = state.currentGame;
  if (!g) {
    return '<div class="view">' + renderEmptyState('Es läuft aktuell kein Spiel. Sobald ein Spiel läuft, erscheint hier die Auswertung.', true) + '</div>';
  }
  var roster = state.roster.filter(function (p) { return g.rosterIds.indexOf(p.id) > -1; });
  var stats = computeStats(g);
  var wscores = weightedScoresForGame(g);
  var wrapped = roster.map(function (p) { return { p: p, s: stats[p.id] || blankStats(), ws: wscores[p.id] || { att: 0, def: 0 } }; });

  var teamShots = 0, teamAng = 0, teamAbw = 0, teamBall = 0, teamBlock = 0, teamStraf = 0, scoreUs = 0, teamFehlwurf = 0, teamVerlust = 0;
  wrapped.forEach(function (w) {
    teamShots += w.s.wuerfe; teamAng += w.s.angFehler; teamAbw += w.s.abwFehler;
    teamBall += w.s.ballgewinn; teamBlock += w.s.block; teamStraf += w.s.strafen; scoreUs += w.s.tore;
    teamFehlwurf += w.s.fehlwuerfe; teamVerlust += w.s.ballverluste;
  });

  var gameAtk = avgAttackTimeSec([g]);
  var gameOppAtk = avgOppAttackTimeSec([g]);

  var kpis = [
    { label: 'Wurfquote', value: (teamShots ? Math.round((scoreUs / teamShots) * 100) : 0) + '%', sub: scoreUs + ' Tore aus ' + teamShots + ' Würfen' },
    { label: 'Fehlwürfe', value: String(teamFehlwurf), sub: 'Abschlüsse ohne Tor' },
    { label: 'Angriffsfehler gesamt', value: String(teamAng), sub: teamFehlwurf + ' Fehlwürfe · ' + teamVerlust + ' Ballverluste' },
    { label: 'Abwehrfehler', value: String(teamAbw), sub: 'Lücken, Stellung, Gegentore' },
    { label: 'Ballgewinne + Blocks', value: String(teamBall + teamBlock), sub: teamBall + ' Gewinne · ' + teamBlock + ' Blocks' },
    { label: 'Strafen', value: String(teamStraf), sub: 'Zeitstrafen' },
    { label: 'Ø Angriffszeit', value: gameAtk ? fmtClock(Math.round(gameAtk.avg)) : '–', sub: gameAtk ? gameAtk.count + ' gemessene Angriffe' : 'Gegentor bis nächste Aktion' },
    { label: 'Ø Angriffszeit Gegner', value: gameOppAtk ? fmtClock(Math.round(gameOppAtk.avg)) : '–', sub: gameOppAtk ? gameOppAtk.count + ' gemessene Angriffe' : 'Unser Fehler bis Ballverlust' }
  ];
  var kpiHtml = kpis.map(function (k) {
    return '<div class="blueprint kpi-card">' + corners() + '<div class="kpi-label">' + k.label + '</div><div class="kpi-value">' + k.value + '</div><div class="kpi-sub">' + k.sub + '</div></div>';
  }).join('');

  var sortFns = {
    tore: function (a, b) { return b.s.tore - a.s.tore; },
    quote: function (a, b) { return quote(b.s) - quote(a.s); },
    fehler: function (a, b) { return (b.s.angFehler + b.s.abwFehler) - (a.s.angFehler + a.s.abwFehler); },
    balance: function (a, b) { return balance(b.ws) - balance(a.ws); }
  };
  var sorters = [
    { key: 'tore', label: 'Tore' }, { key: 'quote', label: 'Quote' },
    { key: 'fehler', label: 'Fehler' }, { key: 'balance', label: 'Bilanz' }
  ].map(function (s) {
    return '<button class="sorter-btn' + (state.sort === s.key ? ' active' : '') + '" data-act="sort" data-key="' + s.key + '">' + s.label + '</button>';
  }).join('');

  var sorted = wrapped.slice().sort(sortFns[state.sort] || sortFns.balance);

  var rows = sorted.map(function (w) {
    var b = balance(w.ws), q = quote(w.s);
    return (
      '<tr>' +
        '<td style="white-space:nowrap"><span style="font:600 14px/1 var(--font-heading);opacity:.45;font-variant-numeric:tabular-nums;margin-right:8px">' + (w.p.nr != null ? w.p.nr : '–') + '</span>' + esc(w.p.name) + '</td>' +
        '<td style="font-variant-numeric:tabular-nums;font-weight:500">' + w.s.tore + '</td>' +
        '<td style="font-variant-numeric:tabular-nums;opacity:.7">' + w.s.wuerfe + '</td>' +
        '<td><div class="quote-cell"><span class="quote-num">' + q + '%</span><span class="quote-track"><span class="quote-fill" style="width:' + q + '%"></span></span></div></td>' +
        '<td style="font-variant-numeric:tabular-nums;opacity:.7">' + w.s.assist + '</td>' +
        '<td style="font-variant-numeric:tabular-nums">' + w.s.fehlwuerfe + '</td>' +
        '<td style="font-variant-numeric:tabular-nums">' + w.s.angFehler + '</td>' +
        '<td style="font-variant-numeric:tabular-nums;font-weight:500">' + w.s.ballgewinn + '</td>' +
        '<td style="font-variant-numeric:tabular-nums;opacity:.7">' + w.s.block + '</td>' +
        '<td style="font-variant-numeric:tabular-nums;opacity:.7">' + w.s.strafen + '</td>' +
        '<td style="font-variant-numeric:tabular-nums">' + w.s.abwFehler + '</td>' +
        '<td><span class="tag ' + (b > 0 ? 'tag-accent' : 'tag-neutral') + '" style="font-variant-numeric:tabular-nums;font-weight:500">' + signed(b) + '</span></td>' +
      '</tr>'
    );
  }).join('');

  var maxSplit = 4;
  wrapped.forEach(function (w) { maxSplit = Math.max(maxSplit, Math.abs(attScore(w.ws)), Math.abs(defScore(w.ws))); });
  function bar(v) {
    var w = (Math.abs(v) / maxSplit) * 50;
    return { left: (v >= 0 ? 50 : 50 - w) + '%', w: w + '%', color: v >= 0 ? 'var(--color-accent)' : 'var(--color-neutral-500)' };
  }
  var splitRows = sorted.map(function (w) {
    var a = bar(attScore(w.ws)), d = bar(defScore(w.ws));
    return (
      '<div class="split-row">' +
        '<span class="split-name"><span class="nr">' + (w.p.nr != null ? w.p.nr : '–') + '</span>' + esc(w.p.name) + '</span>' +
        '<span class="split-bar"><span class="split-track"><span class="split-fill" style="left:' + a.left + ';width:' + a.w + ';background:' + a.color + '"></span><span class="split-mid"></span></span><span class="split-value">' + signed(attScore(w.ws)) + '</span></span>' +
        '<span class="split-bar"><span class="split-track"><span class="split-fill" style="left:' + d.left + ';width:' + d.w + ';background:' + d.color + '"></span><span class="split-mid"></span></span><span class="split-value">' + signed(defScore(w.ws)) + '</span></span>' +
      '</div>'
    );
  }).join('');

  var highlightsHtml = '';
  if (wrapped.length) {
    var shooters = wrapped.filter(function (w) { return w.s.wuerfe >= 4; });
    var topScorer = wrapped.slice().sort(function (a, b) { return b.s.tore - a.s.tore; })[0];
    var bestQuote = (shooters.length ? shooters : wrapped).slice().sort(function (a, b) { return quote(b.s) - quote(a.s); })[0];
    var mostErr = wrapped.slice().sort(function (a, b) { return (b.s.angFehler + b.s.abwFehler) - (a.s.angFehler + a.s.abwFehler); })[0];
    var bestDef = wrapped.slice().sort(function (a, b) { return defScore(b.ws) - defScore(a.ws); })[0];
    function hiCard(tag, w, text, dark) {
      var name = (w.p.nr != null ? w.p.nr + ' ' : '') + esc(w.p.name);
      return '<div class="blueprint highlight-card' + (dark ? ' dark' : '') + '">' + corners() +
        '<div class="highlight-tag">' + tag + '</div><div class="highlight-name">' + name + '</div><div class="highlight-text">' + text + '</div></div>';
    }
    highlightsHtml =
      hiCard('Torgefährlichster', topScorer, topScorer.s.tore + ' Tore aus ' + topScorer.s.wuerfe + ' Würfen · Quote ' + quote(topScorer.s) + '%', true) +
      hiCard('Beste Wurfquote', bestQuote, quote(bestQuote.s) + '% bei ' + bestQuote.s.wuerfe + ' Würfen') +
      hiCard('Stärkste Abwehr', bestDef, bestDef.s.ballgewinn + ' Ballgewinne, ' + bestDef.s.block + ' Blocks, ' + bestDef.s.abwFehler + ' Fehler') +
      hiCard('Meiste Fehler', mostErr, mostErr.s.angFehler + ' im Angriff (davon ' + mostErr.s.fehlwuerfe + ' Fehlwürfe), ' + mostErr.s.abwFehler + ' in der Abwehr');
  }

  return (
    '<div class="view">' +
      '<div class="kpi-grid">' + kpiHtml + '</div>' +
      '<section class="section">' +
        '<div class="section-head"><h3>Spieler im Vergleich</h3><div class="sorter-group">' + sorters + '</div></div>' +
        '<div class="table-wrap"><table class="table" style="min-width:900px"><thead>' +
          '<tr><th style="border-bottom:0"></th><th colspan="6" style="color:var(--color-accent-700);border-bottom:1px solid var(--color-divider)">Angriff</th><th colspan="4" style="color:var(--color-accent-700);border-bottom:1px solid var(--color-divider)">Abwehr</th><th style="border-bottom:0"></th></tr>' +
          '<tr><th>Spieler</th><th>Tore</th><th>Würfe</th><th>Quote</th><th>Assists</th><th>Fehlwürfe</th><th>Fehler ges.</th><th>Ballgew.</th><th>Blocks</th><th>Strafen</th><th>Fehler</th><th>Bilanz</th></tr>' +
        '</thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="table-footnote">Fehlwürfe sind in den Angriffsfehlern gesamt enthalten. Bilanz = Tore, Assists, erzwungene 7m, Ballgewinne und Blocks minus Angriffsfehler, Abwehrfehler und Strafen.</div>' +
      '</section>' +
      '<section class="section"><h3>Auffälligkeiten</h3><div class="highlight-grid">' + highlightsHtml + '</div></section>' +
      '<section class="section"><h3>Angriff gegen Abwehr</h3><div class="blueprint split-card">' + corners() +
        '<div class="split-list"><div class="split-header"><span>Spieler</span><span>Angriff · Bilanz</span><span>Abwehr · Bilanz</span></div>' + splitRows + '</div>' +
      '</div></section>' +
    '</div>'
  );
}

var SEASON_COLS = (function () {
  function num(key, label, opts) {
    opts = opts || {};
    return {
      key: key, label: label, title: opts.title || label,
      cmp: function (a, b) { return a[key] - b[key]; },
      cell: function (r) {
        var v = opts.fmt ? opts.fmt(r[key]) : r[key];
        return '<td style="font-variant-numeric:tabular-nums' + (opts.style || '') + '">' + v + '</td>';
      }
    };
  }
  var oneDec = function (n) { return (Math.round(n * 10) / 10).toFixed(1); };
  return [
    {
      key: 'nr', label: 'Spieler', title: 'Rückennummer',
      cmp: function (a, b) {
        var an = a.nr == null ? Infinity : a.nr, bn = b.nr == null ? Infinity : b.nr;
        if (an !== bn) return an - bn;
        return String(a.name).localeCompare(String(b.name), 'de');
      },
      dir: 'asc',
      cell: function (r) {
        return '<td style="white-space:nowrap"><span style="font:600 14px/1 var(--font-heading);opacity:.45;font-variant-numeric:tabular-nums;margin-right:8px">' +
          (r.nr != null ? r.nr : '–') + '</span>' + esc(r.name) + '</td>';
      }
    },
    num('spiele', 'Spiele', { style: ';opacity:.7' }),
    num('tore', 'Tore', { style: ';font-weight:500' }),
    num('avgTore', 'Ø Tore', { style: ';opacity:.7', fmt: oneDec }),
    {
      key: 'quote', label: 'Quote', title: 'Wurfquote',
      cmp: function (a, b) { return a.quote - b.quote; },
      cell: function (r) {
        return '<td><div class="quote-cell"><span class="quote-num">' + r.quote + '%</span>' +
          '<span class="quote-track"><span class="quote-fill" style="width:' + r.quote + '%"></span></span></div></td>';
      }
    },
    num('assist', 'Assists', { style: ';opacity:.7' }),
    num('fehlwuerfe', 'Fehlwürfe'),
    num('ballverluste', 'Ballverluste', { style: ';opacity:.7' }),
    num('angFehler', 'Ang.-Fehler ges.', { title: 'Angriffsfehler gesamt' }),
    num('ballgewinn', 'Ballgew.', { style: ';font-weight:500', title: 'Ballgewinne' }),
    num('block', 'Blocks', { style: ';opacity:.7' }),
    num('strafen', 'Strafen', { style: ';opacity:.7' }),
    num('abwFehler', 'Abw.-Fehler', { title: 'Abwehrfehler' }),
    {
      key: 'avgBalance', label: 'Ø Bilanz', title: 'durchschnittliche Bilanz',
      cmp: function (a, b) { return a.avgBalance - b.avgBalance; },
      cell: function (r) {
        var v = Math.round(r.avgBalance * 10) / 10;
        return '<td><span class="tag ' + (v > 0 ? 'tag-accent' : 'tag-neutral') + '" style="font-variant-numeric:tabular-nums;font-weight:500">' + signed(v) + '</span></td>';
      }
    }
  ];
})();
var SEASON_COLS_BY_KEY = {};
SEASON_COLS.forEach(function (c) { SEASON_COLS_BY_KEY[c.key] = c; });

function sortSeason(key) {
  var col = SEASON_COLS_BY_KEY[key];
  if (!col) return;
  if (state.seasonSort === key) state.seasonDir = state.seasonDir === 'asc' ? 'desc' : 'asc';
  else { state.seasonSort = key; state.seasonDir = col.dir || 'desc'; }
  save(); render();
}

function renderSeason() {
  var g = state.currentGame;
  var newTile = '<button class="blueprint new-game-card" data-act="open-new-game">' + corners() + '<span class="new-game-plus">+</span><span class="new-game-label">Neues Spiel</span></button>';

  var liveTile = '';
  if (g) {
    var scoreUs = 0;
    var st = computeStats(g);
    Object.keys(st).forEach(function (id) { scoreUs += st[id].tore; });
    liveTile = (
      '<div class="blueprint game-card dark">' + corners() +
        '<div class="game-card-head"><span>' + fmtDate(g.date) + '</span><span>' + esc(g.homeAway) + '</span></div>' +
        '<div class="game-card-opp">' + esc(g.opponent) + '</div>' +
        '<div class="game-card-result"><span class="game-card-score">' + scoreUs + ':' + g.them + '</span><span class="tag tag-outline">Laufend</span></div>' +
      '</div>'
    );
  }

  var archiveTiles = state.archive.slice().reverse().map(function (game) {
    var stats = computeStats(game);
    var us = 0;
    Object.keys(stats).forEach(function (id) { us += stats[id].tore; });
    var win = us > game.them, draw = us === game.them;
    return (
      '<div class="blueprint game-card">' + corners() +
        '<div class="game-card-head"><span>' + fmtDate(game.date) + '</span><span>' + esc(game.homeAway) + '</span></div>' +
        '<div class="game-card-opp">' + esc(game.opponent) + '</div>' +
        '<div class="game-card-result"><span class="game-card-score">' + us + ':' + game.them + '</span><span class="tag ' + (win ? 'tag-accent' : 'tag-neutral') + '">' + (win ? 'Sieg' : draw ? 'Remis' : 'Nied.') + '</span>' +
          '<button class="game-card-delete" data-act="delete-game" data-id="' + game.id + '" title="Spiel löschen" aria-label="Spiel löschen">' + trashIcon() + '</button></div>' +
      '</div>'
    );
  }).join('');

  // season aggregation across archive + current game
  var games = state.archive.concat(g ? [g] : []);
  var seasonAtk = avgAttackTimeSec(games);
  var seasonOppAtk = avgOppAttackTimeSec(games);
  var seasonAtkHtml = '<div class="blueprint kpi-card">' + corners() +
    '<div class="kpi-label">Ø Angriffszeit</div><div class="kpi-value">' + (seasonAtk ? fmtClock(Math.round(seasonAtk.avg)) : '–') + '</div>' +
    '<div class="kpi-sub">' + (seasonAtk ? seasonAtk.count + ' gemessene Angriffe · Saison' : 'Gegentor bis nächste Aktion') + '</div></div>' +
    '<div class="blueprint kpi-card">' + corners() +
    '<div class="kpi-label">Ø Angriffszeit Gegner</div><div class="kpi-value">' + (seasonOppAtk ? fmtClock(Math.round(seasonOppAtk.avg)) : '–') + '</div>' +
    '<div class="kpi-sub">' + (seasonOppAtk ? seasonOppAtk.count + ' gemessene Angriffe · Saison' : 'Unser Fehler bis Ballverlust') + '</div></div>';
  var known = {};
  state.roster.forEach(function (p) { known[p.id] = true; });
  games.forEach(function (game) { (game.rosterIds || []).forEach(function (id) { known[id] = true; }); });
  var seasonWeighted = sumWeightedScores(games);

  var seasonRows = Object.keys(known).map(function (id) {
    var p = playerById(id);
    var t = blankStats();
    var spiele = 0;
    games.forEach(function (game) {
      if ((game.rosterIds || []).indexOf(id) > -1) {
        spiele++;
        var s = computeStats(game)[id];
        if (s) addStats(t, s);
      }
    });
    var ws = seasonWeighted[id] || { att: 0, def: 0 };
    return {
      nr: p ? p.nr : null,
      name: p ? p.name : '(entfernt)',
      spiele: spiele,
      tore: t.tore,
      avgTore: spiele ? t.tore / spiele : 0,
      quote: quote(t),
      assist: t.assist,
      fehlwuerfe: t.fehlwuerfe,
      ballverluste: t.ballverluste,
      angFehler: t.angFehler,
      ballgewinn: t.ballgewinn,
      block: t.block,
      abwFehler: t.abwFehler,
      strafen: t.strafen,
      avgBalance: spiele ? balance(ws) / spiele : 0
    };
  }).filter(function (r) {
    // leere Kaderplätze (kein Name, kein Spiel) blähen die Tabelle nur auf
    return r.spiele > 0 || (r.name && r.name.trim());
  });

  var sorted = seasonRows.slice().sort(function (a, b) {
    var col = SEASON_COLS_BY_KEY[state.seasonSort] || SEASON_COLS_BY_KEY.tore;
    var r = col.cmp(a, b);
    if (state.seasonDir === 'desc') r = -r;
    // equal values keep the familiar roster order
    if (r === 0) r = (a.nr == null ? Infinity : a.nr) - (b.nr == null ? Infinity : b.nr);
    return r;
  });

  var seasonHeadHtml = SEASON_COLS.map(function (c) {
    var on = state.seasonSort === c.key;
    return '<th class="th-sort' + (on ? ' active' : '') + '" data-act="season-sort" data-key="' + c.key + '" title="Nach ' + esc(c.title || c.label) + ' sortieren">' +
      esc(c.label) + '<span class="th-arrow">' + (on ? (state.seasonDir === 'asc' ? '▲' : '▼') : '') + '</span></th>';
  }).join('');

  var seasonRowsHtml = sorted.map(function (r) {
    return '<tr>' + SEASON_COLS.map(function (c) { return c.cell(r); }).join('') + '</tr>';
  }).join('');

  return (
    '<div class="view">' +
      '<div class="kpi-grid">' + seasonAtkHtml + '</div>' +
      '<section class="section"><h3>Spiele der Saison</h3><div class="game-grid">' + newTile + liveTile + archiveTiles + '</div></section>' +
      '<section class="section">' +
        '<div class="section-head"><h3>Saisonwerte pro Spieler</h3><span class="record-head-hint">Spaltenkopf antippen zum Sortieren</span></div>' +
        '<div class="table-wrap"><table class="table" style="min-width:980px"><thead><tr>' + seasonHeadHtml + '</tr></thead>' +
        '<tbody>' + (seasonRowsHtml || '') + '</tbody></table></div>' +
        '<div class="table-footnote">Fehlwürfe sind Abschlüsse ohne Tor und in den Angriffsfehlern gesamt enthalten; Ballverluste sind Fehler ohne Abschluss (Fehlpass, Stürmerfoul, Schrittfehler).</div>' +
      '</section>' +
    '</div>'
  );
}

function renderRoster() {
  var rows = state.roster.map(function (p) {
    var posOptions = POSITIONS.map(function (o) {
      return '<option value="' + o.code + '"' + (p.pos === o.code ? ' selected' : '') + '>' + o.label + '</option>';
    }).join('');
    return (
      '<tr class="' + (p.active ? '' : 'inactive') + '" data-row="' + p.id + '">' +
        '<td><input class="input nr-input" type="number" min="0" max="99" placeholder="–" value="' + (p.nr != null ? p.nr : '') + '" data-field="nr" data-id="' + p.id + '"></td>' +
        '<td><input class="input" type="text" placeholder="Name" value="' + esc(p.name) + '" data-field="name" data-id="' + p.id + '"></td>' +
        '<td><select class="input pos-select" data-field="pos" data-id="' + p.id + '">' + posOptions + '</select></td>' +
        '<td style="text-align:center"><label class="check-row" style="padding:0;justify-content:center"><input type="checkbox" data-field="active" data-id="' + p.id + '"' + (p.active ? ' checked' : '') + '></label></td>' +
        '<td style="text-align:right"><button class="btn btn-icon btn-danger" data-act="delete-player" data-id="' + p.id + '" title="Spieler entfernen" aria-label="Spieler entfernen">' + trashIcon() + '</button></td>' +
      '</tr>'
    );
  }).join('');

  function weightRow(a) {
    return (
      '<div class="weight-row">' +
        '<span class="weight-label">' + esc(a.label) + '</span>' +
        '<input class="input weight-input" type="number" step="1" data-weight="' + a.code + '" value="' + getWeight(a.code) + '">' +
      '</div>'
    );
  }
  var attWeightRows = ATT.map(weightRow).join('');
  var defWeightRows = DEF.filter(function (a) { return !a.opp || a.pickPos; }).map(weightRow).join('');

  return (
    '<div class="view">' +
      '<section class="section">' +
        '<div class="roster-view-head">' +
          '<h3 style="margin-right:auto">Kader-Verwaltung</h3>' +
          '<div class="field"><label>Teamname</label><input class="input" type="text" id="teamNameInput" value="' + esc(state.teamName) + '"></div>' +
        '</div>' +
        '<div class="table-wrap"><table class="table roster-table"><thead><tr><th>Nr.</th><th>Name</th><th>Position</th><th style="text-align:center">Aktiv</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<button class="btn btn-secondary" data-act="add-player">+ Spieler hinzufügen</button>' +
      '</section>' +
      '<section class="section">' +
        '<div class="section-head"><h3>Wertigkeiten für die Bilanz</h3><button class="btn btn-secondary" data-act="reset-weights">Zurücksetzen</button></div>' +
        '<div class="weight-columns">' +
          '<div><h6>Angriff</h6><div class="weight-list">' + attWeightRows + '</div></div>' +
          '<div><h6>Abwehr</h6><div class="weight-list">' + defWeightRows + '</div></div>' +
        '</div>' +
        '<div class="table-footnote">Bilanz eines Spielers = Summe der Wertigkeiten seiner eigenen Aktionen - im Spiel (Auswertung) bzw. im Schnitt pro Spiel (Saison). "Gegner Fehlwurf" fließt nie ein, da die Aktion keinem eigenen Spieler zugeordnet wird.</div>' +
      '</section>' +
    '</div>'
  );
}

function renderNewGameDialog() {
  if (!newGameDialog) return '';
  var d = newGameDialog;
  var activeRoster = sortedRoster(state.roster.filter(function (p) { return p.active; }));
  var kaderRows = activeRoster.map(function (p) {
    var checked = d.rosterIds.indexOf(p.id) > -1;
    return (
      '<label class="check-row"><input type="checkbox" data-act="toggle-kader-pick" data-id="' + p.id + '"' + (checked ? ' checked' : '') + '>' +
      '<span>' + (p.nr != null ? p.nr + ' · ' : '') + esc(p.name || '(ohne Namen)') + '</span></label>'
    );
  }).join('');

  return (
    '<div class="dialog-backdrop" data-act="backdrop-new-game">' +
      '<div class="dialog">' +
        '<div class="dialog-title">Neues Spiel</div>' +
        '<div class="field"><label>Gegner</label><input class="input" type="text" id="ngOpponent" value="' + esc(d.opponent) + '" placeholder="Gegner eintragen"></div>' +
        '<div class="field"><label>Heim / Auswärts</label><div class="seg">' +
          '<button type="button" class="seg-opt' + (d.homeAway === 'Heim' ? ' active' : '') + '" data-act="set-homeaway" data-value="Heim">Heim</button>' +
          '<button type="button" class="seg-opt' + (d.homeAway === 'Auswärts' ? ' active' : '') + '" data-act="set-homeaway" data-value="Auswärts">Auswärts</button>' +
        '</div></div>' +
        '<div class="field"><label>Datum</label><input class="input" type="date" id="ngDate" value="' + esc(d.date) + '"></div>' +
        '<div class="field"><label>Halbzeitlänge (min)</label><input class="input" type="number" min="15" max="35" id="ngHalfMinutes" value="' + esc(d.halfMinutes) + '"></div>' +
        '<div class="field"><label>Kader für dieses Spiel</label><div class="dialog-kader">' + (kaderRows || '<div style="padding:10px;opacity:.6;font-size:13px">Keine aktiven Spieler im Kader.</div>') + '</div></div>' +
        (d.error ? '<div class="dialog-error">' + esc(d.error) + '</div>' : '') +
        '<div class="dialog-actions">' +
          '<button class="btn btn-secondary" data-act="close-new-game">Abbrechen</button>' +
          '<button class="btn btn-primary" data-act="submit-new-game">Spiel starten</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function renderEndGameDialog() {
  if (!endGameDialog || !state.currentGame) return '';
  var g = state.currentGame;
  var stats = computeStats(g);
  var us = 0;
  Object.keys(stats).forEach(function (id) { us += stats[id].tore; });
  return (
    '<div class="dialog-backdrop" data-act="backdrop-end-game">' +
      '<div class="dialog">' +
        '<div class="dialog-title">Spiel beenden?</div>' +
        '<div class="dialog-body">Der Spielstand gegen ' + esc(g.opponent) + ' (' + us + ':' + g.them + ') wird ins Saison-Archiv übernommen. Das Spiel kann danach nicht mehr weiter erfasst werden.</div>' +
        '<div class="dialog-actions">' +
          '<button class="btn btn-secondary" data-act="close-end-game">Abbrechen</button>' +
          '<button class="btn btn-primary" data-act="confirm-end-game">Spiel beenden</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function renderPlayerPickerDialog() {
  if (!twPicker || !state.currentGame) return '';
  var g = state.currentGame;
  var a = ACTION_BY_CODE[twPicker.code];
  var pos = a ? a.pickPos : null;
  var candidates = sortedRoster(state.roster.filter(function (p) {
    return p.pos === pos && g.rosterIds.indexOf(p.id) > -1;
  }));
  var rows = candidates.map(function (p) {
    return (
      '<button class="picker-row" data-act="pick-player-for-event" data-id="' + p.id + '">' +
        '<span class="picker-nr">' + (p.nr != null ? p.nr : '–') + '</span>' +
        '<span>' + esc(p.name || '(ohne Namen)') + '</span>' +
      '</button>'
    );
  }).join('');
  return (
    '<div class="dialog-backdrop" data-act="backdrop-player-picker">' +
      '<div class="dialog">' +
        '<div class="dialog-title">Torwart auswählen</div>' +
        (candidates.length
          ? '<div class="picker-list">' + rows + '</div>'
          : '<div class="dialog-body">Kein Torwart (Position TW) im Kader für dieses Spiel hinterlegt. Trage die Position in der Kader-Verwaltung ein.</div>') +
        '<div class="dialog-actions"><button class="btn btn-secondary" data-act="close-player-picker">Abbrechen</button></div>' +
      '</div>' +
    '</div>'
  );
}

function render() {
  var body;
  if (state.view === 'live') body = renderLive();
  else if (state.view === 'eval') body = renderEval();
  else if (state.view === 'season') body = renderSeason();
  else body = renderRoster();

  document.getElementById('root').innerHTML =
    '<div class="page">' + renderHeader() + body + '</div>' +
    renderNewGameDialog() + renderEndGameDialog() + renderPlayerPickerDialog();
}

/* ══════════════════════ event delegation ══════════════════════ */

document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-act]');
  if (!el) return;
  var act = el.getAttribute('data-act');
  switch (act) {
    case 'switch-tab': switchView(el.getAttribute('data-view')); break;
    case 'select-player': selectPlayer(el.getAttribute('data-id')); break;
    case 'record': recordEvent(el.getAttribute('data-code')); break;
    case 'record-opp': recordOppEvent(el.getAttribute('data-code')); break;
    case 'open-player-picker': openPlayerPicker(el.getAttribute('data-code')); break;
    case 'close-player-picker': closePlayerPicker(); break;
    case 'backdrop-player-picker': if (e.target === el) closePlayerPicker(); break;
    case 'pick-player-for-event': pickPlayerForEvent(el.getAttribute('data-id')); break;
    case 'undo': undoLast(); break;
    case 'remove-log': removeEvent(el.getAttribute('data-id')); break;
    case 'toggle-clock': toggleClock(); break;
    case 'next-half': nextHalf(); break;
    case 'them-plus': themDelta(1); break;
    case 'them-minus': themDelta(-1); break;
    case 'sort': state.sort = el.getAttribute('data-key'); save(); render(); break;
    case 'season-sort': sortSeason(el.getAttribute('data-key')); break;
    case 'open-new-game': openNewGameDialog(); break;
    case 'close-new-game': closeNewGameDialog(); break;
    case 'backdrop-new-game': if (e.target === el) closeNewGameDialog(); break;
    case 'submit-new-game': submitNewGame(); break;
    case 'open-end-game': openEndGameDialog(); break;
    case 'close-end-game': closeEndGameDialog(); break;
    case 'backdrop-end-game': if (e.target === el) closeEndGameDialog(); break;
    case 'confirm-end-game': confirmEndGame(); break;
    case 'add-player': addRosterPlayer(); break;
    case 'reset-weights': resetWeights(); break;
    case 'delete-player':
      if (confirm('Diesen Spieler wirklich aus dem Kader entfernen?')) deleteRosterPlayer(el.getAttribute('data-id'));
      break;
    case 'delete-game':
      if (confirm('Dieses Spiel endgültig aus dem Archiv löschen? Die Saisonwerte werden entsprechend angepasst.')) deleteArchiveGame(el.getAttribute('data-id'));
      break;
    case 'set-homeaway':
      if (newGameDialog) { newGameDialog.homeAway = el.getAttribute('data-value'); render(); }
      break;
    case 'toggle-kader-pick':
      if (newGameDialog) {
        var id = el.getAttribute('data-id');
        var idx = newGameDialog.rosterIds.indexOf(id);
        if (el.checked && idx === -1) newGameDialog.rosterIds.push(id);
        else if (!el.checked && idx > -1) newGameDialog.rosterIds.splice(idx, 1);
      }
      break;
  }
});

document.addEventListener('input', function (e) {
  var t = e.target;
  if (t.id === 'ngOpponent' && newGameDialog) { newGameDialog.opponent = t.value; return; }
  if (t.id === 'ngDate' && newGameDialog) { newGameDialog.date = t.value; return; }
  if (t.id === 'ngHalfMinutes' && newGameDialog) { newGameDialog.halfMinutes = t.value; return; }
  if (t.id === 'teamNameInput') { state.teamName = t.value; save(); return; }
  var weightCode = t.getAttribute('data-weight');
  if (weightCode) {
    var wv = Number(t.value);
    state.weights[weightCode] = isNaN(wv) ? 0 : wv;
    save();
    return;
  }
  var field = t.getAttribute('data-field');
  if (!field) return;
  var id = t.getAttribute('data-id');
  var p = playerById(id);
  if (!p) return;
  if (field === 'nr') p.nr = t.value === '' ? null : Number(t.value);
  else if (field === 'name') p.name = t.value;
  save();
});

document.addEventListener('change', function (e) {
  var t = e.target;
  var field = t.getAttribute('data-field');
  if (!field) return;
  var id = t.getAttribute('data-id');
  var p = playerById(id);
  if (!p) return;
  if (field === 'pos') p.pos = t.value;
  else if (field === 'active') {
    p.active = t.checked;
    var row = t.closest('tr');
    if (row) row.classList.toggle('inactive', !p.active);
  }
  save();
});

render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    // was this page already controlled? if not, the first install claiming it
    // is no reason to reload - only a genuine version change is
    var hadController = !!navigator.serviceWorker.controller;
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
      reg.update();
    }).catch(function () { /* offline caching unavailable */ });
  });
}
