'use strict';

/* ══════════════════════ constants ══════════════════════ */

var STORAGE_KEY = 'handball-wurfbild-v1';

// The goal is split into 3 × 3 zones, read from the shooter's perspective.
var ZONES = [
  { code: 'ol', label: 'oben links',  row: 'oben',  col: 'links'  },
  { code: 'om', label: 'oben Mitte',  row: 'oben',  col: 'Mitte'  },
  { code: 'or', label: 'oben rechts', row: 'oben',  col: 'rechts' },
  { code: 'ml', label: 'Mitte links', row: 'Mitte', col: 'links'  },
  { code: 'mm', label: 'Mitte',       row: 'Mitte', col: 'Mitte'  },
  { code: 'mr', label: 'Mitte rechts',row: 'Mitte', col: 'rechts' },
  { code: 'ul', label: 'unten links', row: 'unten', col: 'links'  },
  { code: 'um', label: 'unten Mitte', row: 'unten', col: 'Mitte'  },
  { code: 'ur', label: 'unten rechts',row: 'unten', col: 'rechts' }
];
var ZONE_BY_CODE = {};
ZONES.forEach(function (z) { ZONE_BY_CODE[z.code] = z; });
var ROWS = ['oben', 'Mitte', 'unten'];
var COLS = ['links', 'Mitte', 'rechts'];

/* ══════════════════════ helpers ══════════════════════ */

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
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
  return p[2] + '.' + p[1] + '.' + p[0];
}
function fmtDateShort(iso) {
  if (!iso) return '';
  var p = iso.split('-');
  if (p.length !== 3) return iso;
  return p[2] + '.' + p[1] + '.';
}
function pct(n, total) { return total ? Math.round((n / total) * 100) : 0; }
function playerLabel(p) {
  if (!p) return '—';
  return (p.nr != null ? p.nr + ' ' : '') + (p.name || '(ohne Namen)');
}
function playerKey(p) {
  // Used to merge the same opponent player across several games.
  return (p.nr != null ? p.nr : '') + '|' + String(p.name || '').trim().toLowerCase();
}
function sortPlayers(list) {
  return list.slice().sort(function (a, b) {
    var an = a.nr == null ? Infinity : a.nr, bn = b.nr == null ? Infinity : b.nr;
    if (an !== bn) return an - bn;
    return String(a.name || '').localeCompare(String(b.name || ''), 'de');
  });
}

/* ══════════════════════ state & persistence ══════════════════════ */

function defaultState() {
  return {
    currentGame: null,
    archive: [],
    view: 'live',
    sel: null,
    archiveOpp: '',
    archiveGame: null
  };
}

var state = load();
var newGameDialog = null;   // { opponent, homeAway, date, reuseRoster, error }
var playerDialog = null;    // { id|null, nr, name, error }
var endGameDialog = false;

function load() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    var parsed = JSON.parse(raw);
    var def = defaultState();
    Object.keys(def).forEach(function (k) { if (parsed[k] === undefined) parsed[k] = def[k]; });
    if (!Array.isArray(parsed.archive)) parsed.archive = [];
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
    players: fields.players || [],
    shots: []
  };
}

function gamePlayer(game, id) {
  for (var i = 0; i < game.players.length; i++) if (game.players[i].id === id) return game.players[i];
  return null;
}

// Aggregates one or more games into a single picture:
// players merged by number + name, zone counts per player and in total.
function analyse(games) {
  var players = {};
  var order = [];
  var total = 0;
  var zoneTotals = {};
  ZONES.forEach(function (z) { zoneTotals[z.code] = 0; });

  games.forEach(function (game) {
    var keyById = {};
    game.players.forEach(function (p) {
      var key = playerKey(p);
      keyById[p.id] = key;
      if (!players[key]) {
        players[key] = { key: key, nr: p.nr, name: p.name, goals: 0, zones: {}, games: 0 };
        ZONES.forEach(function (z) { players[key].zones[z.code] = 0; });
        order.push(key);
      }
      players[key].games++;
    });
    game.shots.forEach(function (s) {
      var key = keyById[s.playerId];
      if (!key || !ZONE_BY_CODE[s.zone]) return;
      players[key].goals++;
      players[key].zones[s.zone]++;
      zoneTotals[s.zone]++;
      total++;
    });
  });

  var list = order.map(function (k) { return players[k]; });
  return { players: list, total: total, zones: zoneTotals, games: games.length };
}

function topZone(zones) {
  var best = null;
  ZONES.forEach(function (z) {
    if (best === null || zones[z.code] > zones[best]) best = z.code;
  });
  return zones[best] ? best : null;
}
function rowColSums(zones) {
  var rows = {}, cols = {};
  ROWS.forEach(function (r) { rows[r] = 0; });
  COLS.forEach(function (c) { cols[c] = 0; });
  ZONES.forEach(function (z) { rows[z.row] += zones[z.code]; cols[z.col] += zones[z.code]; });
  return { rows: rows, cols: cols };
}

function lastRosterAgainst(opponent) {
  var name = String(opponent || '').trim().toLowerCase();
  if (!name) return null;
  for (var i = state.archive.length - 1; i >= 0; i--) {
    var g = state.archive[i];
    if (String(g.opponent).trim().toLowerCase() === name && g.players.length) return g.players;
  }
  return null;
}
function knownOpponents() {
  var seen = {}, list = [];
  state.archive.slice().reverse().forEach(function (g) {
    var k = String(g.opponent).trim().toLowerCase();
    if (!seen[k]) { seen[k] = true; list.push(g.opponent); }
  });
  return list;
}

/* ══════════════════════ actions ══════════════════════ */

function switchView(v) { state.view = v; save(); render(); }
function selectPlayer(id) { state.sel = state.sel === id ? null : id; save(); render(); }

function recordShot(zone) {
  var g = state.currentGame;
  if (!g || !state.sel || !ZONE_BY_CODE[zone]) return;
  if (!gamePlayer(g, state.sel)) { state.sel = null; render(); return; }
  g.shots.push({ id: uid('s'), playerId: state.sel, zone: zone });
  save(); render();
}
function undoLast() {
  var g = state.currentGame;
  if (!g || !g.shots.length) return;
  g.shots.pop();
  save(); render();
}
function removeShot(id) {
  var g = state.currentGame;
  if (!g) return;
  g.shots = g.shots.filter(function (s) { return s.id !== id; });
  save(); render();
}

/* new game */
function openNewGameDialog() {
  newGameDialog = { opponent: '', homeAway: 'Heim', date: todayISO(), reuseRoster: true, error: '' };
  render();
  var el = document.getElementById('ngOpponent');
  if (el) el.focus();
}
function closeNewGameDialog() { newGameDialog = null; render(); }
function submitNewGame() {
  if (!newGameDialog) return;
  var opp = (newGameDialog.opponent || '').trim();
  if (!opp) { newGameDialog.error = 'Bitte einen Gegner eintragen.'; render(); return; }
  var players = [];
  if (newGameDialog.reuseRoster) {
    var prev = lastRosterAgainst(opp);
    if (prev) players = prev.map(function (p) { return { id: uid('p'), nr: p.nr, name: p.name }; });
  }
  if (state.currentGame) state.archive.push(state.currentGame);
  state.currentGame = createGame({ opponent: opp, homeAway: newGameDialog.homeAway, date: newGameDialog.date || todayISO(), players: players });
  state.view = 'live';
  state.sel = null;
  newGameDialog = null;
  save(); render();
}

/* end game */
function openEndGameDialog() { if (state.currentGame) { endGameDialog = true; render(); } }
function closeEndGameDialog() { endGameDialog = false; render(); }
function confirmEndGame() {
  if (state.currentGame) {
    state.archive.push(state.currentGame);
    state.archiveGame = state.currentGame.id;
    state.archiveOpp = '';
    state.currentGame = null;
  }
  endGameDialog = false;
  state.view = 'archive';
  state.sel = null;
  save(); render();
}

/* opponent players */
function openPlayerDialog(id) {
  var g = state.currentGame;
  if (!g) return;
  var p = id ? gamePlayer(g, id) : null;
  playerDialog = { id: p ? p.id : null, nr: p && p.nr != null ? String(p.nr) : '', name: p ? p.name : '', error: '' };
  render();
  var el = document.getElementById('pdNr');
  if (el) el.focus();
}
function closePlayerDialog() { playerDialog = null; render(); }
function submitPlayerDialog(addAnother) {
  var g = state.currentGame;
  if (!g || !playerDialog) return;
  var name = (playerDialog.name || '').trim();
  var nrRaw = String(playerDialog.nr || '').trim();
  var nr = nrRaw === '' ? null : Number(nrRaw);
  if (nrRaw !== '' && (isNaN(nr) || nr < 0 || nr > 99)) { playerDialog.error = 'Rückennummer bitte zwischen 0 und 99.'; render(); return; }
  if (nr == null && !name) { playerDialog.error = 'Bitte Nummer oder Name eintragen.'; render(); return; }
  if (playerDialog.id) {
    var p = gamePlayer(g, playerDialog.id);
    if (p) { p.nr = nr; p.name = name; }
    playerDialog = null;
  } else {
    var np = { id: uid('p'), nr: nr, name: name };
    g.players.push(np);
    if (addAnother) playerDialog = { id: null, nr: '', name: '', error: '' };
    else { playerDialog = null; state.sel = np.id; }
  }
  save(); render();
  if (addAnother) { var el = document.getElementById('pdNr'); if (el) el.focus(); }
}
function deletePlayer(id) {
  var g = state.currentGame;
  if (!g) return;
  g.players = g.players.filter(function (p) { return p.id !== id; });
  g.shots = g.shots.filter(function (s) { return s.playerId !== id; });
  if (state.sel === id) state.sel = null;
  playerDialog = null;
  save(); render();
}

/* archive */
function setArchiveOpp(opp) { state.archiveOpp = opp; state.archiveGame = null; save(); render(); }
function selectArchiveGame(id) { state.archiveGame = state.archiveGame === id ? null : id; save(); render(); }
function deleteArchiveGame(id) {
  state.archive = state.archive.filter(function (g) { return g.id !== id; });
  if (state.archiveGame === id) state.archiveGame = null;
  if (state.archiveOpp && !state.archive.some(function (g) { return g.opponent === state.archiveOpp; })) state.archiveOpp = '';
  save(); render();
}
function reopenArchiveGame(id) {
  var idx = -1;
  for (var i = 0; i < state.archive.length; i++) if (state.archive[i].id === id) idx = i;
  if (idx === -1) return;
  var g = state.archive.splice(idx, 1)[0];
  if (state.currentGame) state.archive.push(state.currentGame);
  state.currentGame = g;
  state.archiveGame = null;
  state.view = 'live';
  state.sel = null;
  save(); render();
}

/* ══════════════════════ rendering: shared pieces ══════════════════════ */

function trashIcon() {
  return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6l-.8 13.1a2 2 0 0 1-2 1.9H7.8a2 2 0 0 1-2-1.9L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';
}
function pencilIcon() {
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';
}
function corners() {
  return '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';
}

// zones: {code: count}; opts: { interactive, mini, total, locked, overlay }
function renderGoal(zones, opts) {
  opts = opts || {};
  var max = 0, sum = 0;
  ZONES.forEach(function (z) { max = Math.max(max, zones[z.code] || 0); sum += zones[z.code] || 0; });
  var total = opts.total != null ? opts.total : sum;
  var tiles = ZONES.map(function (z) {
    var n = zones[z.code] || 0;
    var ratio = max ? n / max : 0;
    var heat = n ? Math.round(14 + ratio * 80) : 0;
    var hot = heat >= 58;
    var cls = 'zone' + (hot ? ' hot' : '') + (n ? '' : ' empty');
    var attrs = opts.interactive
      ? ' data-act="shot" data-zone="' + z.code + '"' + (opts.locked ? ' disabled' : '')
      : ' disabled tabindex="-1"';
    var tag = opts.interactive ? 'button' : 'div';
    return (
      '<' + tag + ' class="' + cls + '" style="--heat:' + heat + '%"' + attrs + ' title="' + esc(z.label) + '" aria-label="' + esc(z.label) + ': ' + n + '">' +
        (opts.mini ? '' : '<span class="zone-label">' + esc(z.label) + '</span>') +
        '<span class="zone-count">' + n + '</span>' +
        (opts.mini || !total ? '' : '<span class="zone-pct">' + pct(n, total) + '%</span>') +
      '</' + tag + '>'
    );
  }).join('');
  var overlay = opts.overlay ? '<div class="goal-overlay"><span>' + esc(opts.overlay) + '</span></div>' : '';
  return (
    '<div class="goal-wrap">' +
      '<div class="' + (opts.mini ? 'goal-mini' : 'goal') + (opts.locked ? ' locked' : '') + '">' +
        '<div class="goal-post top"></div><div class="goal-post left"></div><div class="goal-post right"></div>' +
        '<div class="goal-net">' + tiles + '</div>' +
        overlay +
      '</div>' +
      '<div class="goal-line"></div>' +
      (opts.mini ? '' : '<div class="goal-floor"><span>Links</span><span>Blick des Werfers</span><span>Rechts</span></div>') +
    '</div>'
  );
}

function renderHeader() {
  var g = state.currentGame;
  var tabs = [
    { key: 'live', label: 'Erfassen' },
    { key: 'eval', label: 'Auswertung' },
    { key: 'archive', label: 'Archiv' }
  ].map(function (t) {
    return '<button class="tab-btn' + (state.view === t.key ? ' active' : '') + '" data-act="switch-tab" data-view="' + t.key + '">' + t.label + '</button>';
  }).join('');

  var title, meta = '', middle;
  if (g) {
    title = esc(g.opponent);
    meta = '<div class="app-header-meta">' + esc(g.homeAway) + ' · ' + esc(fmtDate(g.date)) + ' · ' + g.players.length + ' Gegenspieler</div>';
    middle =
      '<div class="score-block"><div><div class="score-display">' + g.shots.length + '</div><div class="score-label">Gegentore</div></div></div>' +
      '<button class="header-btn warn" data-act="open-end-game">Spiel beenden</button>';
  } else {
    title = 'Kein aktives Spiel';
    middle = '<button class="header-btn fill" data-act="open-new-game">+ Neues Spiel</button>';
  }

  return (
    '<header class="app-header">' +
      '<div class="app-header-title"><div class="app-header-kicker">Wurfbild · Gegner</div><div class="app-header-match">' + title + '</div>' + meta + '</div>' +
      middle +
      '<div class="tabs">' + tabs + '</div>' +
      '<a class="header-btn header-link" href="../index.html" title="Zur Spielanalyse wechseln">Spielanalyse ↗</a>' +
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

/* ══════════════════════ rendering: live ══════════════════════ */

function renderLive() {
  var g = state.currentGame;
  if (!g) {
    return '<div class="view">' + renderEmptyState('Es läuft aktuell kein Spiel. Starte ein neues Spiel, um das Wurfbild der Gegenspieler zu erfassen.', true) + '</div>';
  }
  var players = sortPlayers(g.players);
  var goalsBy = {};
  var zonesBy = {};
  var teamZones = {};
  ZONES.forEach(function (z) { teamZones[z.code] = 0; });
  g.shots.forEach(function (s) {
    goalsBy[s.playerId] = (goalsBy[s.playerId] || 0) + 1;
    if (!zonesBy[s.playerId]) { zonesBy[s.playerId] = {}; ZONES.forEach(function (z) { zonesBy[s.playerId][z.code] = 0; }); }
    if (ZONE_BY_CODE[s.zone]) { zonesBy[s.playerId][s.zone]++; teamZones[s.zone]++; }
  });

  var rosterHtml = players.map(function (p) {
    var on = state.sel === p.id;
    var n = goalsBy[p.id] || 0;
    return (
      '<button class="roster-item' + (on ? ' active' : '') + '" data-act="select-player" data-id="' + p.id + '">' +
        '<span class="roster-nr">' + (p.nr != null ? p.nr : '–') + '</span>' +
        '<span class="roster-name">' + esc(p.name || '(ohne Namen)') + '</span>' +
        '<span class="roster-tally"><span class="roster-tally-n">' + n + '</span><span class="roster-tally-l">' + (n === 1 ? 'Tor' : 'Tore') + '</span></span>' +
      '</button>'
    );
  }).join('');
  if (!players.length) rosterHtml = '<div class="roster-empty">Noch keine Gegenspieler. Lege die Spieler mit Rückennummer an – Namen sind optional.</div>';

  var selPlayer = state.sel ? gamePlayer(g, state.sel) : null;
  var zones = selPlayer ? (zonesBy[selPlayer.id] || {}) : teamZones;
  if (selPlayer && !zonesBy[selPlayer.id]) { zones = {}; ZONES.forEach(function (z) { zones[z.code] = 0; }); }

  var log = g.shots.slice().reverse().slice(0, 8).map(function (s, i) {
    var p = gamePlayer(g, s.playerId);
    var z = ZONE_BY_CODE[s.zone];
    return (
      '<div class="log-row">' +
        '<span class="log-idx">#' + (g.shots.length - i) + '</span>' +
        '<span class="log-text"><strong>' + esc(playerLabel(p)) + '</strong> · <span class="log-zone">' + esc(z ? z.label : s.zone) + '</span></span>' +
        '<button class="log-remove" data-act="remove-shot" data-id="' + s.id + '" title="Treffer löschen" aria-label="Treffer löschen">' + trashIcon() + '</button>' +
      '</div>'
    );
  }).join('');

  var goalTitle = selPlayer ? esc(playerLabel(selPlayer)) : 'Alle Gegenspieler';
  var goalSub = selPlayer ? 'Torbereich antippen, um den Treffer zu buchen' : (players.length ? 'Links einen Gegenspieler antippen' : 'Zuerst Gegenspieler anlegen');

  return (
    '<div class="live-grid">' +
      '<section class="roster-panel"><h6>Gegenspieler antippen</h6>' + rosterHtml +
        '<button class="btn btn-secondary roster-add" data-act="open-player-dialog">+ Gegenspieler hinzufügen</button>' +
        (selPlayer ? '<button class="btn btn-secondary roster-add" data-act="open-player-dialog" data-id="' + selPlayer.id + '">' + pencilIcon() + ' ' + esc(playerLabel(selPlayer)) + ' bearbeiten</button>' : '') +
      '</section>' +
      '<section class="record-panel">' +
        '<div class="record-head">' +
          '<div class="record-head-title">' + goalTitle + '</div>' +
          '<div class="record-head-hint">' + goalSub + '</div>' +
          '<button class="btn btn-secondary record-undo" data-act="undo"' + (g.shots.length ? '' : ' disabled') + '>Letzten Treffer zurück</button>' +
        '</div>' +
        '<div class="blueprint goal-card">' + corners() +
          '<div class="goal-head"><h4>Tor</h4><span class="goal-sub">' + (selPlayer ? (goalsBy[selPlayer.id] || 0) + ' Treffer' : g.shots.length + ' Gegentore gesamt') + '</span><span class="goal-sub right">9 Bereiche</span></div>' +
          renderGoal(zones, { interactive: true, locked: !selPlayer, overlay: selPlayer ? '' : (players.length ? 'Gegenspieler wählen' : 'Gegenspieler anlegen') }) +
        '</div>' +
        '<div class="log-section"><h6>Protokoll · ' + g.shots.length + ' Treffer</h6>' + (log || '<div class="roster-empty">Noch keine Treffer erfasst.</div>') + '</div>' +
      '</section>' +
    '</div>'
  );
}

/* ══════════════════════ rendering: analysis (shared by eval + archive) ══════════════════════ */

function renderAnalysis(games, opts) {
  opts = opts || {};
  var a = analyse(games);
  var players = sortPlayers(a.players);
  var top = topZone(a.zones);
  var rc = rowColSums(a.zones);
  var scorer = players.slice().sort(function (x, y) { return y.goals - x.goals; })[0];

  var kpis = [
    { label: 'Gegentore', value: String(a.total), sub: a.games > 1 ? 'in ' + a.games + ' Spielen · Ø ' + (a.total / a.games).toFixed(1) + ' pro Spiel' : 'im Spiel erfasst' },
    { label: 'Torgefährlichster', value: scorer && scorer.goals ? esc(playerLabel(scorer)) : '–', sub: scorer && scorer.goals ? scorer.goals + ' Tore · ' + pct(scorer.goals, a.total) + '% aller Gegentore' : 'Noch keine Treffer', text: true },
    { label: 'Häufigster Bereich', value: top ? esc(ZONE_BY_CODE[top].label) : '–', sub: top ? a.zones[top] + ' Treffer · ' + pct(a.zones[top], a.total) + '%' : 'Noch keine Treffer', text: true },
    { label: 'Werfer mit Toren', value: String(players.filter(function (p) { return p.goals; }).length), sub: 'von ' + players.length + ' Gegenspielern' }
  ];
  var kpiHtml = kpis.map(function (k) {
    return '<div class="blueprint kpi-card">' + corners() + '<div class="kpi-label">' + k.label + '</div><div class="kpi-value' + (k.text ? ' text' : '') + '">' + k.value + '</div><div class="kpi-sub">' + k.sub + '</div></div>';
  }).join('');

  function distRows(labels, sums) {
    var max = 1;
    labels.forEach(function (l) { max = Math.max(max, sums[l]); });
    return labels.map(function (l) {
      return (
        '<div class="dist-row"><span class="dist-name">' + esc(l) + '</span>' +
          '<span class="dist-track"><span class="dist-fill" style="width:' + (sums[l] / max) * 100 + '%"></span></span>' +
          '<span class="dist-value">' + sums[l] + ' · ' + pct(sums[l], a.total) + '%</span></div>'
      );
    }).join('');
  }

  var cards = players.slice().sort(function (x, y) { return y.goals - x.goals || (x.nr == null ? 99 : x.nr) - (y.nr == null ? 99 : y.nr); }).map(function (p) {
    var t = topZone(p.zones);
    var foot = p.goals ? 'Meist ' + esc(ZONE_BY_CODE[t].label) + ' (' + p.zones[t] + ')' : 'Kein Treffer';
    if (a.games > 1) foot += ' · ' + p.games + ' Sp.';
    return (
      '<div class="blueprint player-card">' + corners() +
        '<div class="player-card-head"><span class="player-card-nr">' + (p.nr != null ? p.nr : '–') + '</span><span class="player-card-name">' + esc(p.name || '(ohne Namen)') + '</span><span class="player-card-n">' + p.goals + '</span></div>' +
        renderGoal(p.zones, { mini: true }) +
        '<div class="player-card-foot">' + foot + '</div>' +
      '</div>'
    );
  }).join('');

  var rows = players.slice().sort(function (x, y) { return y.goals - x.goals; }).map(function (p) {
    var t = topZone(p.zones);
    var prc = rowColSums(p.zones);
    var share = pct(p.goals, a.total);
    return (
      '<tr>' +
        '<td style="white-space:nowrap"><span class="nr">' + (p.nr != null ? p.nr : '–') + '</span>' + esc(p.name || '(ohne Namen)') + '</td>' +
        (a.games > 1 ? '<td class="num soft">' + p.games + '</td>' : '') +
        '<td class="num strong">' + p.goals + '</td>' +
        '<td><div class="quote-cell"><span class="quote-num">' + share + '%</span><span class="quote-track"><span class="quote-fill" style="width:' + share + '%"></span></span></div></td>' +
        '<td>' + (t ? esc(ZONE_BY_CODE[t].label) : '–') + '</td>' +
        '<td class="num soft">' + prc.rows.oben + '</td><td class="num soft">' + prc.rows.Mitte + '</td><td class="num soft">' + prc.rows.unten + '</td>' +
        '<td class="num soft">' + prc.cols.links + '</td><td class="num soft">' + prc.cols.Mitte + '</td><td class="num soft">' + prc.cols.rechts + '</td>' +
      '</tr>'
    );
  }).join('');

  return (
    '<div class="kpi-grid">' + kpiHtml + '</div>' +
    '<div class="analysis-grid">' +
      '<section class="section"><div class="section-head"><h3>Wurfbild gesamt</h3><span class="section-hint">' + esc(opts.hint || '') + '</span></div>' +
        '<div class="blueprint goal-card">' + corners() +
          '<div class="goal-head"><h4>Tor</h4><span class="goal-sub">' + a.total + ' Gegentore</span><span class="goal-sub right">Anteil je Bereich</span></div>' +
          renderGoal(a.zones) +
        '</div>' +
      '</section>' +
      '<section class="section"><h3>Verteilung</h3>' +
        '<div class="blueprint dist-card">' + corners() +
          '<div class="dist-group">Höhe</div><div class="dist-list">' + distRows(ROWS, rc.rows) + '</div>' +
          '<div class="dist-group">Seite (Blick des Werfers)</div><div class="dist-list">' + distRows(COLS, rc.cols) + '</div>' +
        '</div>' +
      '</section>' +
    '</div>' +
    '<section class="section"><h3>Wurfbild pro Gegenspieler</h3>' +
      (cards ? '<div class="player-grid">' + cards + '</div>' : '<div class="roster-empty">Keine Gegenspieler erfasst.</div>') +
    '</section>' +
    '<section class="section"><h3>Gegenspieler im Vergleich</h3>' +
      '<div class="table-wrap"><table class="table" style="min-width:820px"><thead>' +
        '<tr><th style="border-bottom:0"></th>' + (a.games > 1 ? '<th style="border-bottom:0"></th>' : '') + '<th style="border-bottom:0"></th><th style="border-bottom:0"></th><th style="border-bottom:0"></th><th colspan="3" style="color:var(--color-accent-700)">Höhe</th><th colspan="3" style="color:var(--color-accent-700)">Seite</th></tr>' +
        '<tr><th>Spieler</th>' + (a.games > 1 ? '<th>Spiele</th>' : '') + '<th>Tore</th><th>Anteil</th><th>Häufigster Bereich</th><th>Oben</th><th>Mitte</th><th>Unten</th><th>Links</th><th>Mitte</th><th>Rechts</th></tr>' +
      '</thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="table-footnote">Seiten sind aus Sicht des Werfers angegeben: „links“ ist die linke Torseite vom Werfer aus gesehen, für den Torwart also rechts.</div>' +
    '</section>'
  );
}

function renderEval() {
  var g = state.currentGame;
  if (!g) {
    return '<div class="view">' + renderEmptyState('Es läuft aktuell kein Spiel. Sobald ein Spiel läuft, erscheint hier die Auswertung. Abgeschlossene Spiele findest du im Archiv.', true) + '</div>';
  }
  return '<div class="view">' + renderAnalysis([g], { hint: esc(g.opponent) + ' · ' + fmtDate(g.date) }) + '</div>';
}

/* ══════════════════════ rendering: archive ══════════════════════ */

function renderArchive() {
  var g = state.currentGame;
  var opps = knownOpponents();
  var counts = {};
  state.archive.forEach(function (game) { counts[game.opponent] = (counts[game.opponent] || 0) + 1; });

  var chips = '<button class="chip' + (!state.archiveOpp ? ' active' : '') + '" data-act="archive-opp" data-opp="">Alle Gegner <span class="chip-n">' + state.archive.length + '</span></button>' +
    opps.map(function (o) {
      return '<button class="chip' + (state.archiveOpp === o ? ' active' : '') + '" data-act="archive-opp" data-opp="' + esc(o) + '">' + esc(o) + ' <span class="chip-n">' + counts[o] + '</span></button>';
    }).join('');

  var newTile = '<button class="blueprint new-game-card" data-act="open-new-game">' + corners() + '<span class="new-game-plus">+</span><span class="new-game-label">Neues Spiel</span></button>';
  var liveTile = '';
  if (g && (!state.archiveOpp || state.archiveOpp === g.opponent)) {
    liveTile = (
      '<div class="blueprint game-card dark">' + corners() +
        '<div class="game-card-head"><span>' + fmtDateShort(g.date) + '</span><span>' + esc(g.homeAway) + '</span></div>' +
        '<div class="game-card-opp">' + esc(g.opponent) + '</div>' +
        '<div class="game-card-result"><span class="game-card-score">' + g.shots.length + '</span><span class="game-card-unit">Gegentore</span><span class="tag tag-outline" style="margin-left:auto">Laufend</span></div>' +
      '</div>'
    );
  }

  var filtered = state.archive.filter(function (game) { return !state.archiveOpp || game.opponent === state.archiveOpp; });
  var tiles = filtered.slice().reverse().map(function (game) {
    var sel = state.archiveGame === game.id;
    return (
      '<button class="blueprint game-card' + (sel ? ' selected' : '') + '" data-act="archive-game" data-id="' + game.id + '">' + corners() +
        '<div class="game-card-head"><span>' + fmtDateShort(game.date) + '</span><span>' + esc(game.homeAway) + '</span></div>' +
        '<div class="game-card-opp">' + esc(game.opponent) + '</div>' +
        '<div class="game-card-result"><span class="game-card-score">' + game.shots.length + '</span><span class="game-card-unit">Gegentore · ' + game.players.length + ' Spieler</span></div>' +
      '</button>'
    );
  }).join('');

  var detail = '';
  var selGame = null;
  if (state.archiveGame) {
    for (var i = 0; i < state.archive.length; i++) if (state.archive[i].id === state.archiveGame) selGame = state.archive[i];
  }
  if (selGame) {
    detail =
      '<section class="section">' +
        '<div class="archive-detail-head"><h3>' + esc(selGame.opponent) + ' · ' + fmtDate(selGame.date) + '</h3>' +
          '<button class="btn btn-secondary" data-act="reopen-game" data-id="' + selGame.id + '">Weiter erfassen</button>' +
          '<button class="btn btn-danger" data-act="delete-game" data-id="' + selGame.id + '">' + trashIcon() + ' Spiel löschen</button>' +
        '</div>' +
      '</section>' +
      renderAnalysis([selGame], { hint: esc(selGame.homeAway) + ' · Einzelspiel' });
  } else if (filtered.length) {
    var label = state.archiveOpp ? 'Wurfbild gegen ' + esc(state.archiveOpp) : 'Wurfbild aller Gegner';
    detail =
      '<section class="section"><div class="archive-detail-head"><h3>' + label + '</h3><span class="section-hint">' + filtered.length + ' ' + (filtered.length === 1 ? 'Spiel' : 'Spiele') + ' zusammengefasst · Spiel antippen für Details</span></div></section>' +
      renderAnalysis(filtered, { hint: state.archiveOpp ? 'Gleiche Rückennummer + Name werden über Spiele hinweg zusammengeführt' : 'Alle archivierten Spiele' });
  } else if (!state.archive.length) {
    detail = renderEmptyState('Noch keine Spiele archiviert. Beende ein laufendes Spiel über „Spiel beenden“, dann erscheint es hier – sortiert nach Gegner.', !g);
  }

  return (
    '<div class="view">' +
      '<section class="section"><div class="section-head"><h3>Archiv</h3><span class="section-hint">Nach Gegner filtern</span></div><div class="filter-chips">' + chips + '</div></section>' +
      '<section class="section"><h3>Spiele</h3><div class="game-grid">' + newTile + liveTile + tiles + '</div></section>' +
      detail +
    '</div>'
  );
}

/* ══════════════════════ rendering: dialogs ══════════════════════ */

function renderNewGameDialog() {
  if (!newGameDialog) return '';
  var d = newGameDialog;
  var opps = knownOpponents();
  var prev = lastRosterAgainst(d.opponent);
  var datalist = opps.length ? '<datalist id="oppList">' + opps.map(function (o) { return '<option value="' + esc(o) + '"></option>'; }).join('') + '</datalist>' : '';
  return (
    '<div class="dialog-backdrop" data-act="backdrop-new-game">' +
      '<div class="dialog">' +
        '<div class="dialog-title">Neues Spiel</div>' +
        '<div class="field"><label>Gegner</label><input class="input" type="text" id="ngOpponent" value="' + esc(d.opponent) + '" placeholder="Gegner eintragen"' + (opps.length ? ' list="oppList"' : '') + ' autocomplete="off">' + datalist + '</div>' +
        '<div class="field"><label>Heim / Auswärts</label><div class="seg">' +
          '<button type="button" class="seg-opt' + (d.homeAway === 'Heim' ? ' active' : '') + '" data-act="set-homeaway" data-value="Heim">Heim</button>' +
          '<button type="button" class="seg-opt' + (d.homeAway === 'Auswärts' ? ' active' : '') + '" data-act="set-homeaway" data-value="Auswärts">Auswärts</button>' +
        '</div></div>' +
        '<div class="field"><label>Datum</label><input class="input" type="date" id="ngDate" value="' + esc(d.date) + '"></div>' +
        (prev
          ? '<label class="check-row"><input type="checkbox" id="ngReuse"' + (d.reuseRoster ? ' checked' : '') + '><span>Gegenspieler vom letzten Spiel übernehmen (' + prev.length + ')</span></label>'
          : '<div class="dialog-hint">Die Gegenspieler legst du danach direkt beim Erfassen an. Spielst du später erneut gegen diesen Gegner, kannst du den Kader übernehmen.</div>') +
        (d.error ? '<div class="dialog-error">' + esc(d.error) + '</div>' : '') +
        '<div class="dialog-actions">' +
          '<button class="btn btn-secondary" data-act="close-new-game">Abbrechen</button>' +
          '<button class="btn btn-primary" data-act="submit-new-game">Spiel starten</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function renderPlayerDialog() {
  if (!playerDialog || !state.currentGame) return '';
  var d = playerDialog;
  var editing = !!d.id;
  return (
    '<div class="dialog-backdrop" data-act="backdrop-player">' +
      '<div class="dialog">' +
        '<div class="dialog-title">' + (editing ? 'Gegenspieler bearbeiten' : 'Gegenspieler hinzufügen') + '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Nr.</label><input class="input" type="number" inputmode="numeric" min="0" max="99" id="pdNr" value="' + esc(d.nr) + '" placeholder="–"></div>' +
          '<div class="field"><label>Name (optional)</label><input class="input" type="text" id="pdName" value="' + esc(d.name) + '" placeholder="Name"></div>' +
        '</div>' +
        (d.error ? '<div class="dialog-error">' + esc(d.error) + '</div>' : '') +
        '<div class="dialog-actions">' +
          (editing ? '<button class="btn btn-danger" data-act="delete-player" data-id="' + d.id + '">' + trashIcon() + ' Entfernen</button>' : '') +
          '<button class="btn btn-secondary" data-act="close-player-dialog">Abbrechen</button>' +
          (editing ? '' : '<button class="btn btn-secondary" data-act="submit-player-more">Speichern + weiterer</button>') +
          '<button class="btn btn-primary" data-act="submit-player">' + (editing ? 'Speichern' : 'Hinzufügen') + '</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function renderEndGameDialog() {
  if (!endGameDialog || !state.currentGame) return '';
  var g = state.currentGame;
  return (
    '<div class="dialog-backdrop" data-act="backdrop-end-game">' +
      '<div class="dialog">' +
        '<div class="dialog-title">Spiel beenden?</div>' +
        '<div class="dialog-body">Das Spiel gegen ' + esc(g.opponent) + ' mit ' + g.shots.length + ' erfassten Gegentoren wird ins Archiv übernommen. Du kannst es dort später wieder öffnen und weiter erfassen.</div>' +
        '<div class="dialog-actions">' +
          '<button class="btn btn-secondary" data-act="close-end-game">Abbrechen</button>' +
          '<button class="btn btn-primary" data-act="confirm-end-game">Spiel beenden</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function render() {
  var body;
  if (state.view === 'live') body = renderLive();
  else if (state.view === 'eval') body = renderEval();
  else body = renderArchive();

  document.getElementById('root').innerHTML =
    '<div class="page">' + renderHeader() + body + '</div>' +
    renderNewGameDialog() + renderPlayerDialog() + renderEndGameDialog();
}

/* ══════════════════════ event delegation ══════════════════════ */

document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-act]');
  if (!el) return;
  var act = el.getAttribute('data-act');
  switch (act) {
    case 'switch-tab': switchView(el.getAttribute('data-view')); break;
    case 'select-player': selectPlayer(el.getAttribute('data-id')); break;
    case 'shot': recordShot(el.getAttribute('data-zone')); break;
    case 'undo': undoLast(); break;
    case 'remove-shot': removeShot(el.getAttribute('data-id')); break;
    case 'open-new-game': openNewGameDialog(); break;
    case 'close-new-game': closeNewGameDialog(); break;
    case 'backdrop-new-game': if (e.target === el) closeNewGameDialog(); break;
    case 'submit-new-game': submitNewGame(); break;
    case 'set-homeaway': if (newGameDialog) { newGameDialog.homeAway = el.getAttribute('data-value'); render(); } break;
    case 'open-end-game': openEndGameDialog(); break;
    case 'close-end-game': closeEndGameDialog(); break;
    case 'backdrop-end-game': if (e.target === el) closeEndGameDialog(); break;
    case 'confirm-end-game': confirmEndGame(); break;
    case 'open-player-dialog': openPlayerDialog(el.getAttribute('data-id')); break;
    case 'close-player-dialog': closePlayerDialog(); break;
    case 'backdrop-player': if (e.target === el) closePlayerDialog(); break;
    case 'submit-player': submitPlayerDialog(false); break;
    case 'submit-player-more': submitPlayerDialog(true); break;
    case 'delete-player':
      if (confirm('Diesen Gegenspieler samt seiner Treffer entfernen?')) deletePlayer(el.getAttribute('data-id'));
      break;
    case 'archive-opp': setArchiveOpp(el.getAttribute('data-opp') || ''); break;
    case 'archive-game': selectArchiveGame(el.getAttribute('data-id')); break;
    case 'reopen-game': reopenArchiveGame(el.getAttribute('data-id')); break;
    case 'delete-game':
      if (confirm('Dieses Spiel endgültig aus dem Archiv löschen?')) deleteArchiveGame(el.getAttribute('data-id'));
      break;
  }
});

document.addEventListener('input', function (e) {
  var t = e.target;
  if (newGameDialog) {
    if (t.id === 'ngOpponent') {
      newGameDialog.opponent = t.value;
      // re-render only the reuse hint when a known opponent is typed
      var had = !!document.getElementById('ngReuse');
      var has = !!lastRosterAgainst(t.value);
      if (had !== has) { var pos = t.selectionStart; render(); var el = document.getElementById('ngOpponent'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (err) { /* ignore */ } } }
      return;
    }
    if (t.id === 'ngDate') { newGameDialog.date = t.value; return; }
  }
  if (playerDialog) {
    if (t.id === 'pdNr') { playerDialog.nr = t.value; return; }
    if (t.id === 'pdName') { playerDialog.name = t.value; return; }
  }
});

document.addEventListener('change', function (e) {
  var t = e.target;
  if (t.id === 'ngReuse' && newGameDialog) newGameDialog.reuseRoster = t.checked;
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') {
    if (playerDialog && (e.target.id === 'pdNr' || e.target.id === 'pdName')) { e.preventDefault(); submitPlayerDialog(!playerDialog.id); }
    else if (newGameDialog && e.target.id === 'ngOpponent') { e.preventDefault(); submitNewGame(); }
  }
  if (e.key === 'Escape') {
    if (playerDialog) closePlayerDialog();
    else if (newGameDialog) closeNewGameDialog();
    else if (endGameDialog) closeEndGameDialog();
  }
});

render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline caching unavailable */ });
  });
}
