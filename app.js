/* ======================================================
   LITTLE POMO — App
   ====================================================== */

'use strict';

// ── State ──────────────────────────────────────────────

const state = {
  // Timer
  mode: 'pomo',          // 'pomo' | 'short' | 'long'
  running: false,
  totalSeconds: 25 * 60,
  remainingSeconds: 25 * 60,
  rafId: null,           // requestAnimationFrame id
  startTime: null,       // performance.now() when timer last started
  startRemaining: 0,     // remainingSeconds at last start
  sessionsCompleted: 0,

  // Tasks
  tasks: [],
  activeTaskId: null,

  // Settings
  settings: {
    pomoDuration: 25,
    shortBreak: 5,
    longBreak: 15,
    longBreakInterval: 4,
    autoStartBreaks: false,
    autoStartPomos: false,
    soundEnabled: true,
    volume: 70,
    notifEnabled: false,
    theme: 'coral',
    appearance: 'dark',
  },
};

// ── DOM refs ────────────────────────────────────────────

const $ = id => document.getElementById(id);
const minuteHand     = $('minuteHand');
const secondHand     = $('secondHand');
const progressArc    = $('progressArc');
const glowRing       = $('glowRing');
const digitalTime    = $('digitalTime');
const startBtn       = $('startBtn');
const resetBtn       = $('resetBtn');
const skipBtn        = $('skipBtn');
const iconPlay       = startBtn.querySelector('.icon-play');
const iconPause      = startBtn.querySelector('.icon-pause');
const modeTabs       = document.querySelectorAll('.mode-tab');
const dotsContainer  = $('dotsContainer');
const taskInput      = $('taskInput');
const addTaskBtn     = $('addTaskBtn');
const taskList       = $('taskList');
const taskCount      = $('taskCount');
const activeTaskText = $('activeTaskText');

// Settings modal
const settingsBtn    = $('settingsBtn');
const modalOverlay   = $('modalOverlay');
const modalClose     = $('modalClose');
const saveSettings   = $('saveSettings');

// Appearance toggle
const themeToggleBtn = $('themeToggleBtn');

// Info modal
const infoBtn          = $('infoBtn');
const infoModalOverlay = $('infoModalOverlay');
const infoModalClose   = $('infoModalClose');

// Completion
const completionOverlay = $('completionOverlay');
const completionBtn     = $('completionBtn');
const completionTitle   = $('completionTitle');
const completionSub     = $('completionSub');
const completionEmoji   = $('completionEmoji');

// ── Arc constants ───────────────────────────────────────

const ARC_RADIUS = 140;
const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_RADIUS; // ≈ 879.6

// ── Helpers ─────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, '0'); }

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${pad(m)}:${pad(s)}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ── Clock markers (generated once) ─────────────────────

function buildMarkers() {
  const majorContainer  = $('clockMarkers');
  const minorContainer  = $('minuteMarkers');

  // 12 major (hour) markers
  for (let i = 0; i < 12; i++) {
    const el = document.createElement('div');
    el.className = 'marker marker-major';
    const angle = (i / 12) * 360;
    el.style.transform = `rotate(${angle}deg)`;
    majorContainer.appendChild(el);
  }

  // 60 minor (minute) markers — skip positions that overlap major markers
  for (let i = 0; i < 60; i++) {
    if (i % 5 === 0) continue; // skip, already covered by major
    const el = document.createElement('div');
    el.className = 'marker marker-minor';
    const angle = (i / 60) * 360;
    el.style.transform = `rotate(${angle}deg)`;
    minorContainer.appendChild(el);
  }
}

// ── Clock rendering ─────────────────────────────────────
// elapsedExact: precise elapsed seconds including sub-second fraction (for smooth hands)
// remainingWhole: integer remaining seconds (for digital display)

function renderClock(elapsedExact, total, remainingWhole) {
  // ── Minute hand: sweeps 0°→360° over the full session
  const minuteAngle = (elapsedExact / total) * 360;

  // ── Second hand: continuous sweep within each second (no ticking)
  const secondAngle = (elapsedExact % 60 / 60) * 360;

  minuteHand.style.transform = `translateX(-50%) rotate(${minuteAngle}deg)`;
  secondHand.style.transform = `translateX(-50%) rotate(${secondAngle}deg)`;

  // ── Progress arc (use precise fraction)
  const fraction = (total - elapsedExact) / total;
  const offset = ARC_CIRCUMFERENCE * Math.max(0, fraction);
  progressArc.style.strokeDashoffset = offset;

  // ── Digital display uses whole seconds only
  const display = Math.max(0, remainingWhole);
  digitalTime.textContent = formatTime(display);

  // ── Page title: contextual when running
  if (state.running) {
    const modeLabel = state.mode === 'pomo' ? 'Pomo' : state.mode === 'short' ? 'Short Break' : 'Long Break';
    document.title = `${modeLabel} In Progress... — Little Pomo`;
  } else {
    document.title = 'Little Pomo';
  }
}

// ── Session dots ────────────────────────────────────────

function renderDots() {
  const dots = dotsContainer.querySelectorAll('.dot');
  const interval = state.settings.longBreakInterval;
  const filled = state.sessionsCompleted % interval;

  // Resize dots array if interval changed
  if (dots.length !== interval) {
    dotsContainer.innerHTML = '';
    for (let i = 0; i < interval; i++) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dotsContainer.appendChild(dot);
    }
  }

  dotsContainer.querySelectorAll('.dot').forEach((dot, i) => {
    dot.classList.toggle('filled', i < filled);
  });
}

// ── Timer logic ─────────────────────────────────────────

function getModeSeconds() {
  const s = state.settings;
  if (state.mode === 'pomo')  return s.pomoDuration * 60;
  if (state.mode === 'short') return s.shortBreak * 60;
  return s.longBreak * 60;
}

function setMode(mode) {
  state.mode = mode;
  stop();
  state.totalSeconds = getModeSeconds();
  state.remainingSeconds = state.totalSeconds;
  renderClock(0, state.totalSeconds, state.remainingSeconds);
  modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
}

function tick(now) {
  const elapsedSinceStart = (now - state.startTime) / 1000; // seconds, fractional
  const elapsedTotal = state.totalSeconds - state.startRemaining + elapsedSinceStart;
  const remainingExact = state.totalSeconds - elapsedTotal;
  const remainingWhole = Math.ceil(remainingExact); // counts down: 25:00, 24:59 …

  if (remainingExact <= 0) {
    // Snap to zero, then complete
    renderClock(state.totalSeconds, state.totalSeconds, 0);
    state.remainingSeconds = 0;
    handleComplete();
    return;
  }

  state.remainingSeconds = remainingWhole;
  renderClock(elapsedTotal, state.totalSeconds, remainingWhole);
  state.rafId = requestAnimationFrame(tick);
}

// ── Tab visibility — resume rAF loop when tab becomes visible again ──
// Browsers throttle/pause rAF in hidden tabs. The wall-clock math in tick()
// already handles the elapsed time correctly, so we just need to restart the loop.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !state.running) return;
  // Cancel any lingering rAF, then immediately fire tick() to catch up
  cancelAnimationFrame(state.rafId);
  state.rafId = requestAnimationFrame(tick);
});

function start() {
  if (state.running) return;
  state.running = true;
  iconPlay.classList.add('hidden');
  iconPause.classList.remove('hidden');
  glowRing.classList.add('running');

  // Record the wall-clock start point and how many seconds were left
  state.startTime = performance.now();
  state.startRemaining = state.remainingSeconds;
  state.rafId = requestAnimationFrame(tick);
}

function pause() {
  if (!state.running) return;
  state.running = false;
  cancelAnimationFrame(state.rafId);
  state.rafId = null;
  iconPlay.classList.remove('hidden');
  iconPause.classList.add('hidden');
  glowRing.classList.remove('running');
  document.title = 'Little Pomo';
}

function stop() {
  pause();
}

function reset() {
  stop();
  state.remainingSeconds = state.totalSeconds;
  const elapsed = state.totalSeconds - state.remainingSeconds;
  renderClock(elapsed, state.totalSeconds, state.remainingSeconds);
}

function skip() {
  stop();
  handleComplete(true); // true = skipped, not auto
}

function handleComplete(skipped = false) {
  state.running = false;
  iconPlay.classList.remove('hidden');
  iconPause.classList.add('hidden');
  glowRing.classList.remove('running');

  if (!skipped) playChime();

  if (state.mode === 'pomo') {
    state.sessionsCompleted++;
    if (state.activeTaskId) {
      const task = state.tasks.find(t => t.id === state.activeTaskId);
      if (task) {
        task.pomos++;
        renderTaskList();
      }
    }
    renderDots();

    const isLongBreak = state.sessionsCompleted % state.settings.longBreakInterval === 0;

    if (!skipped) {
      showCompletion(
        '🎉',
        'Session Complete!',
        isLongBreak ? 'Nice work — time for a long break!' : 'Time for a short break!'
      );
    }

    // Next mode
    if (isLongBreak) {
      state.mode = 'long';
    } else {
      state.mode = 'short';
    }
  } else {
    // Break ended → back to pomo
    if (!skipped) {
      showCompletion('💪', 'Break Over!', 'Ready for the next session?');
    }
    state.mode = 'pomo';
  }

  state.totalSeconds = getModeSeconds();
  state.remainingSeconds = state.totalSeconds;
  renderClock(0, state.totalSeconds, state.remainingSeconds);
  modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === state.mode));

  if (!skipped) {
    const autoStart = state.mode === 'pomo'
      ? state.settings.autoStartPomos
      : state.settings.autoStartBreaks;
    if (autoStart) setTimeout(() => start(), 3500);
  }

  document.title = 'Little Pomo';
}

// ── Completion overlay ──────────────────────────────────

function showCompletion(emoji, title, sub) {
  completionEmoji.textContent = emoji;
  completionTitle.textContent = title;
  completionSub.textContent = sub;
  completionOverlay.classList.add('show');
}

completionBtn.addEventListener('click', () => {
  completionOverlay.classList.remove('show');
});

// ── Sound ───────────────────────────────────────────────

function playChime() {
  if (!state.settings.soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const vol = state.settings.volume / 100;

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol * 0.35, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.start(t);
      osc.stop(t + 0.65);
    });
  } catch (e) {
    // Audio not supported or blocked
  }
}

// ── Task management ─────────────────────────────────────

function addTask(text) {
  if (!text.trim()) return;
  const task = {
    id: uid(),
    text: text.trim(),
    done: false,
    pomos: 0,
  };
  state.tasks.push(task);

  // Auto-select if no task active
  if (!state.activeTaskId) {
    state.activeTaskId = task.id;
  }

  renderTaskList();
  renderActiveTask();
  taskInput.value = '';
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  if (state.activeTaskId === id) {
    state.activeTaskId = state.tasks[0]?.id || null;
  }
  renderTaskList();
  renderActiveTask();
}

function toggleDone(id) {
  const task = state.tasks.find(t => t.id === id);
  if (task) task.done = !task.done;
  renderTaskList();
}

function setActiveTask(id) {
  state.activeTaskId = id;
  renderTaskList();
  renderActiveTask();
}

function renderActiveTask() {
  const task = state.tasks.find(t => t.id === state.activeTaskId);
  if (task) {
    activeTaskText.textContent = task.text;
    activeTaskText.classList.add('has-task');
  } else {
    activeTaskText.textContent = 'No task selected';
    activeTaskText.classList.remove('has-task');
  }
}

function renderTaskList() {
  taskList.innerHTML = '';
  const total = state.tasks.length;
  taskCount.textContent = `${total} task${total !== 1 ? 's' : ''}`;

  state.tasks.forEach(task => {
    const li = document.createElement('li');
    li.className = 'task-item' +
      (task.done ? ' done' : '') +
      (task.id === state.activeTaskId ? ' active-item' : '');
    li.dataset.id = task.id;

    li.innerHTML = `
      <div class="task-checkbox"></div>
      <span class="task-text">${escHtml(task.text)}</span>
      ${task.pomos > 0 ? `<span class="task-pomo-count">🍅 ${task.pomos}</span>` : ''}
      <button class="task-delete" aria-label="Delete task">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;

    // Checkbox toggle done
    li.querySelector('.task-checkbox').addEventListener('click', e => {
      e.stopPropagation();
      toggleDone(task.id);
    });

    // Click on item = set active
    li.addEventListener('click', () => setActiveTask(task.id));

    // Delete
    li.querySelector('.task-delete').addEventListener('click', e => {
      e.stopPropagation();
      deleteTask(task.id);
    });

    taskList.appendChild(li);
  });
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Settings ────────────────────────────────────────────

// hex → {r,g,b}
function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function makeGlow(hex, a)  { const {r,g,b} = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; }

// palette(start, end, mid, swatches, env, lightEnv)
// env      — dark-mode background environment
// lightEnv — optional light-mode override (only for palettes that own their light world)
//            when absent, light mode uses the neutral CSS defaults
function palette(start, end, mid, swatches, env, lightEnv) {
  return {
    start, end, mid,
    glow: makeGlow(start, 0.35),
    soft: makeGlow(start, 0.12),
    swatches,
    env,
    lightEnv: lightEnv || null,
  };
}

const themeMap = {
  // ── Classic single-colour themes ──────────────────────
  // These keep the default dark background but tint surfaces subtly
  coral:   palette('#ff6b6b', '#ff8e53', '#ff7a5f', ['#ff6b6b', '#ff8e53'],
    { bg: '#160e0e', surface: '#201212', surface2: '#2a1818', surface3: '#361e1e', orb1: '#ff6b6b', orb2: '#ff8e53',
      text: '#f8f0f0', textMuted: '#c09098', textDim: '#806068' }),
  violet:  palette('#7c3aed', '#a78bfa', '#8b5cf6', ['#7c3aed', '#a78bfa'],
    { bg: '#0e0b18', surface: '#130f20', surface2: '#1b1529', surface3: '#241c35', orb1: '#7c3aed', orb2: '#a78bfa',
      text: '#f0f0fc', textMuted: '#9898d0', textDim: '#606098' }),
  cyan:    palette('#06b6d4', '#22d3ee', '#0ea5e9', ['#06b6d4', '#22d3ee'],
    { bg: '#070f14', surface: '#0b1720', surface2: '#101f2a', surface3: '#162837', orb1: '#06b6d4', orb2: '#22d3ee',
      text: '#eef8fc', textMuted: '#7ab8cc', textDim: '#4a7888' }),
  emerald: palette('#10b981', '#34d399', '#059669', ['#10b981', '#34d399'],
    { bg: '#071410', surface: '#0b1d16', surface2: '#10261d', surface3: '#153025', orb1: '#10b981', orb2: '#34d399',
      text: '#eef8f4', textMuted: '#78b8a0', textDim: '#487860' }),
  rose:    palette('#f43f5e', '#fb7185', '#e11d48', ['#f43f5e', '#fb7185'],
    { bg: '#15080c', surface: '#200c12', surface2: '#2a1018', surface3: '#35141f', orb1: '#f43f5e', orb2: '#fb7185',
      text: '#faf0f2', textMuted: '#c890a0', textDim: '#886070' }),
  amber:   palette('#f59e0b', '#fbbf24', '#d97706', ['#f59e0b', '#fbbf24'],
    { bg: '#141006', surface: '#1e170a', surface2: '#281f0e', surface3: '#322713', orb1: '#f59e0b', orb2: '#fbbf24',
      text: '#faf5ec', textMuted: '#c0a870', textDim: '#806840' }),

  // ── Curated palettes ──────────────────────────────────

  // 1. Woodland Rave — deep forest floor, neon accents bleeding through the dark
  woodland: palette('#f95d9b', '#39a0ca', '#c74a82',
    ['#478559', '#161748', '#f95d9b', '#39a0ca'],
    { bg: '#0b0e1a', surface: '#111629', surface2: '#181f35', surface3: '#1e2840', orb1: '#f95d9b', orb2: '#478559',
      text: '#f0f0f8', textMuted: '#8898b8', textDim: '#586080' }),

  // 2. Summit & Bloom — cold alpine night, warm bloom breaking through
  summit: palette('#fea49f', '#fbaf08', '#fd7f7a',
    ['#101357', '#fea49f', '#fbaf08', '#00a0a0', '#007f4f'],
    { bg: '#080b1c', surface: '#0e1228', surface2: '#141933', surface3: '#1a203e', orb1: '#fbaf08', orb2: '#00a0a0',
      text: '#eef0f8', textMuted: '#88a0c0', textDim: '#506080' }),

  // 3. Acid Garden — electric night, synthetic and alive
  acid: palette('#0e0fed', '#8bf0ba', '#5272f4',
    ['#8bf0ba', '#0e0fed', '#94f0f1', '#f2b1d8', '#ffdc6a'],
    { bg: '#05050f', surface: '#09091a', surface2: '#0e0e24', surface3: '#13132d', orb1: '#8bf0ba', orb2: '#0e0fed',
      text: '#f0fff8', textMuted: '#78d0a8', textDim: '#406850' }),

  // 4. Midnight Concrete — urban brutalism, gold light on wet stone
  concrete: palette('#feda6a', '#d4d4dc', '#e8c85a',
    ['#feda6a', '#d4d4dc', '#393f4d', '#1d1e22'],
    { bg: '#111215', surface: '#18191e', surface2: '#1e2028', surface3: '#252730', orb1: '#feda6a', orb2: '#d4d4dc',
      text: '#f4f4f8', textMuted: '#a8a8c0', textDim: '#686878' }),

  // 5. Darkroom — dim red safelight, chemical green, shadows
  darkroom: palette('#00c07f', '#cd5554', '#00a06a',
    ['#cd5554', '#91684a', '#00c07f', '#313d4b'],
    { bg: '#090d0b', surface: '#0f1510', surface2: '#141c15', surface3: '#1a231a', orb1: '#cd5554', orb2: '#00c07f',
      text: '#eef4f0', textMuted: '#88a898', textDim: '#506858' }),

  // 6. Manuscript — ancient parchment, ink, candlelight warmth
  //    Parchment · Bone · Linen · Almond Cream · Almond Silk
  manuscript: palette(
    '#a0876e',   // start: warm ink-brown (derived from Almond Silk, deepened)
    '#c9b8a8',   // end: Almond Cream/Silk midpoint — soft warm taupe
    '#b09880',   // mid
    ['#edede9', '#d6ccc2', '#f5ebe0', '#e3d5ca', '#d5bdaf'],
    // Dark mode: warm near-black with deep parchment undertones
    { bg: '#16120e', surface: '#1e1810', surface2: '#271f15', surface3: '#32281a', orb1: '#d5bdaf', orb2: '#c9b8a8',
      text: '#f0e8dc', textMuted: '#b09070', textDim: '#786050' },
    // Light mode: parchment world — Parchment bg, Bone/Linen surfaces
    { bg: '#edede9', surface: '#f5ebe0', surface2: '#e3d5ca', surface3: '#d6ccc2',
      text: '#2c1f14', textMuted: '#6b5040', textDim: '#9c7e68',
      border: 'rgba(100,70,45,0.12)', borderBright: 'rgba(100,70,45,0.22)',
      clockFace: '#faf6f0', orb1: '#d5bdaf', orb2: '#e3d5ca' }
  ),
};

// Palette metadata (name + swatch order for the UI)
const paletteGroups = [
  {
    label: 'Classic',
    palettes: [
      { key: 'coral',   name: 'Coral',   swatches: ['#ff6b6b', '#ff8e53'] },
      { key: 'violet',  name: 'Violet',  swatches: ['#7c3aed', '#a78bfa'] },
      { key: 'cyan',    name: 'Cyan',    swatches: ['#06b6d4', '#22d3ee'] },
      { key: 'emerald', name: 'Emerald', swatches: ['#10b981', '#34d399'] },
      { key: 'rose',    name: 'Rose',    swatches: ['#f43f5e', '#fb7185'] },
      { key: 'amber',   name: 'Amber',   swatches: ['#f59e0b', '#fbbf24'] },
    ],
  },
  {
    label: 'Curated',
    palettes: [
      { key: 'woodland', name: 'Woodland Rave',      swatches: ['#478559', '#161748', '#f95d9b', '#39a0ca'] },
      { key: 'summit',   name: 'Summit & Bloom',     swatches: ['#101357', '#fea49f', '#fbaf08', '#00a0a0', '#007f4f'] },
      { key: 'acid',     name: 'Acid Garden',        swatches: ['#8bf0ba', '#0e0fed', '#94f0f1', '#f2b1d8', '#ffdc6a'] },
      { key: 'concrete', name: 'Midnight Concrete',  swatches: ['#feda6a', '#d4d4dc', '#393f4d', '#1d1e22'] },
      { key: 'darkroom',   name: 'Darkroom',           swatches: ['#cd5554', '#91684a', '#00c07f', '#313d4b'] },
      { key: 'manuscript', name: 'Manuscript',         swatches: ['#edede9', '#d6ccc2', '#f5ebe0', '#e3d5ca', '#d5bdaf'] },
    ],
  },
];

// ── Persistence ─────────────────────────────────────────

const STORAGE_KEY = 'little-pomo-settings';

function saveSettingsToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
  } catch (e) { /* storage blocked */ }
}

function loadSettingsFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    // Merge saved values into defaults (handles future new keys gracefully)
    Object.assign(state.settings, saved);
  } catch (e) { /* corrupt/missing — use defaults */ }
}

function applyTheme(name) {
  const t = themeMap[name] || themeMap.coral;
  const root = document.documentElement;

  // Accent vars — always applied
  root.style.setProperty('--accent-start', t.start);
  root.style.setProperty('--accent-end',   t.end);
  root.style.setProperty('--accent-mid',   t.mid);
  root.style.setProperty('--accent-glow',  t.glow);
  root.style.setProperty('--accent-soft',  t.soft);

  // Background environment
  if (state.settings.appearance === 'dark') {
    const e = t.env;
    root.style.setProperty('--bg',         e.bg);
    root.style.setProperty('--surface',    e.surface);
    root.style.setProperty('--surface-2',  e.surface2);
    root.style.setProperty('--surface-3',  e.surface3);
    root.style.setProperty('--clock-face', e.bg);
    root.style.setProperty('--clock-rim',  e.surface);
    root.style.setProperty('--orb1-color', e.orb1);
    root.style.setProperty('--orb2-color', e.orb2);
    // Per-palette text colours — push if defined, else use :root CSS defaults
    if (e.text)      root.style.setProperty('--text',       e.text);
    else             root.style.removeProperty('--text');
    if (e.textMuted) root.style.setProperty('--text-muted', e.textMuted);
    else             root.style.removeProperty('--text-muted');
    if (e.textDim)   root.style.setProperty('--text-dim',   e.textDim);
    else             root.style.removeProperty('--text-dim');
    // Border stays at CSS defaults in dark mode
    root.style.removeProperty('--border');
    root.style.removeProperty('--border-bright');
  } else {
    // Light mode — use palette's own light world if it has one, else CSS defaults
    const le = t.lightEnv;
    if (le) {
      root.style.setProperty('--bg',           le.bg);
      root.style.setProperty('--surface',      le.surface);
      root.style.setProperty('--surface-2',    le.surface2);
      root.style.setProperty('--surface-3',    le.surface3);
      root.style.setProperty('--clock-face',   le.clockFace);
      root.style.setProperty('--clock-rim',    le.surface3);
      root.style.setProperty('--orb1-color',   le.orb1);
      root.style.setProperty('--orb2-color',   le.orb2);
      root.style.setProperty('--text',         le.text);
      root.style.setProperty('--text-muted',   le.textMuted);
      root.style.setProperty('--text-dim',     le.textDim);
      root.style.setProperty('--border',       le.border);
      root.style.setProperty('--border-bright',le.borderBright);
    } else {
      // Restore neutral light defaults
      root.style.removeProperty('--bg');
      root.style.removeProperty('--surface');
      root.style.removeProperty('--surface-2');
      root.style.removeProperty('--surface-3');
      root.style.removeProperty('--text');
      root.style.removeProperty('--text-muted');
      root.style.removeProperty('--text-dim');
      root.style.removeProperty('--border');
      root.style.removeProperty('--border-bright');
      root.style.setProperty('--clock-face', '#ffffff');
      root.style.setProperty('--clock-rim',  '#e8e6de');
      root.style.setProperty('--orb1-color', t.start);
      root.style.setProperty('--orb2-color', t.end);
    }
  }
}

function applyAppearance(mode) {
  document.documentElement.dataset.appearance = mode;
}

// Header toggle button
themeToggleBtn.addEventListener('click', () => {
  const next = state.settings.appearance === 'dark' ? 'light' : 'dark';
  state.settings.appearance = next;
  applyAppearance(next);
  applyTheme(state.settings.theme); // re-push bg env for the new mode
  saveSettingsToStorage();
  // Keep settings modal appearance toggle in sync if open
  document.querySelectorAll('.appear-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.appear === next);
  });
});

function populateSettingsUI() {
  const s = state.settings;
  $('pomoDuration').value      = s.pomoDuration;
  $('shortBreak').value        = s.shortBreak;
  $('longBreak').value         = s.longBreak;
  $('longBreakInterval').value = s.longBreakInterval;
  $('autoStartBreaks').checked = s.autoStartBreaks;
  $('autoStartPomos').checked  = s.autoStartPomos;
  $('soundEnabled').checked    = s.soundEnabled;
  $('volumeSlider').value      = s.volume;
  $('volumeValue').textContent = s.volume + '%';
  $('notifEnabled').checked    = s.notifEnabled;

  // Rebuild palette grid so active state is fresh
  buildPaletteGrid();

  document.querySelectorAll('.appear-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.appear === s.appearance);
  });
}

function collectSettings() {
  const s = state.settings;
  s.pomoDuration      = Math.max(1, Math.min(90,  parseInt($('pomoDuration').value)      || 25));
  s.shortBreak        = Math.max(1, Math.min(30,  parseInt($('shortBreak').value)        || 5));
  s.longBreak         = Math.max(1, Math.min(60,  parseInt($('longBreak').value)         || 15));
  s.longBreakInterval = Math.max(2, Math.min(10,  parseInt($('longBreakInterval').value) || 4));
  s.autoStartBreaks   = $('autoStartBreaks').checked;
  s.autoStartPomos    = $('autoStartPomos').checked;
  s.soundEnabled      = $('soundEnabled').checked;
  s.volume            = parseInt($('volumeSlider').value) || 70;
  s.notifEnabled      = $('notifEnabled').checked;
}

// ── Info modal ──────────────────────────────────────────

infoBtn.addEventListener('click', () => {
  infoModalOverlay.classList.add('open');
});

infoModalClose.addEventListener('click', () => {
  infoModalOverlay.classList.remove('open');
});

infoModalOverlay.addEventListener('click', e => {
  if (e.target === infoModalOverlay) infoModalOverlay.classList.remove('open');
});

// ── Settings modal ──────────────────────────────────────

settingsBtn.addEventListener('click', () => {
  populateSettingsUI();
  modalOverlay.classList.add('open');
});

function closeModal() {
  modalOverlay.classList.remove('open');
}

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) closeModal();
});

saveSettings.addEventListener('click', () => {
  collectSettings();
  saveSettingsToStorage();
  applyTheme(state.settings.theme);
  renderDots();

  // Reset current mode duration with new settings
  stop();
  state.totalSeconds = getModeSeconds();
  state.remainingSeconds = state.totalSeconds;
  renderClock(0, state.totalSeconds, state.remainingSeconds);

  // Notification permission
  if (state.settings.notifEnabled && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  closeModal();
});

// Number input buttons
document.querySelectorAll('.num-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = $(btn.dataset.target);
    if (!input) return;
    const delta = parseInt(btn.dataset.delta);
    const min = parseInt(input.min);
    const max = parseInt(input.max);
    const current = parseInt(input.value) || 0;
    input.value = Math.max(min, Math.min(max, current + delta));
  });
});

// Volume slider
$('volumeSlider').addEventListener('input', e => {
  $('volumeValue').textContent = e.target.value + '%';
});

// ── Palette grid (built once, wired on build) ────────────

function buildPaletteGrid() {
  const grid = document.getElementById('paletteGrid');
  if (!grid) return;
  grid.innerHTML = '';

  paletteGroups.forEach(group => {
    // Group label
    const label = document.createElement('p');
    label.className = 'palette-group-label';
    label.textContent = group.label;
    grid.appendChild(label);

    // Row of cards
    const row = document.createElement('div');
    row.className = 'palette-row';

    group.palettes.forEach(p => {
      const card = document.createElement('button');
      card.className = 'palette-card' + (state.settings.theme === p.key ? ' active' : '');
      card.dataset.palette = p.key;
      card.type = 'button';

      // Colour dots
      const dots = document.createElement('div');
      dots.className = 'palette-dots';
      p.swatches.forEach(hex => {
        const dot = document.createElement('span');
        dot.className = 'palette-dot';
        dot.style.background = hex;
        dots.appendChild(dot);
      });

      const name = document.createElement('span');
      name.className = 'palette-name';
      name.textContent = p.name;

      card.appendChild(dots);
      card.appendChild(name);

      card.addEventListener('click', () => {
        document.querySelectorAll('.palette-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        state.settings.theme = p.key;
        applyTheme(p.key);
      });

      row.appendChild(card);
    });

    grid.appendChild(row);
  });
}

// Appearance buttons (in settings modal)
document.querySelectorAll('.appear-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.appear-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.settings.appearance = btn.dataset.appear;
    applyAppearance(btn.dataset.appear);
    applyTheme(state.settings.theme); // re-push bg env for the new mode
  });
});

// ── Control buttons ─────────────────────────────────────

startBtn.addEventListener('click', () => {
  state.running ? pause() : start();
});

resetBtn.addEventListener('click', () => {
  reset();
});

skipBtn.addEventListener('click', () => {
  skip();
});

// Mode tabs
modeTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    setMode(tab.dataset.mode);
  });
});

// ── Task input ──────────────────────────────────────────

addTaskBtn.addEventListener('click', () => {
  addTask(taskInput.value);
});

taskInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') addTask(taskInput.value);
});

// ── Keyboard shortcuts ──────────────────────────────────

document.addEventListener('keydown', e => {
  // Ignore if focused on input
  if (document.activeElement.tagName === 'INPUT') return;

  if (e.code === 'Space') {
    e.preventDefault();
    state.running ? pause() : start();
  } else if (e.code === 'KeyR') {
    reset();
  } else if (e.code === 'KeyS') {
    skip();
  }
});

// ── Init ────────────────────────────────────────────────

function init() {
  loadSettingsFromStorage();
  buildMarkers();
  applyAppearance(state.settings.appearance);
  applyTheme(state.settings.theme);
  state.totalSeconds = getModeSeconds();
  state.remainingSeconds = state.totalSeconds;
  renderClock(0, state.totalSeconds, state.remainingSeconds);
  renderDots();
  renderTaskList();
  renderActiveTask();
}

init();
