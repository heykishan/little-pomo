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

const themeMap = {
  coral:   { start: '#ff6b6b', end: '#ff8e53', mid: '#ff7a5f', glow: 'rgba(255,107,107,0.35)', soft: 'rgba(255,107,107,0.12)' },
  violet:  { start: '#7c3aed', end: '#a78bfa', mid: '#8b5cf6', glow: 'rgba(124,58,237,0.35)',   soft: 'rgba(124,58,237,0.12)' },
  cyan:    { start: '#06b6d4', end: '#22d3ee', mid: '#0ea5e9', glow: 'rgba(6,182,212,0.35)',     soft: 'rgba(6,182,212,0.12)' },
  emerald: { start: '#10b981', end: '#34d399', mid: '#059669', glow: 'rgba(16,185,129,0.35)',    soft: 'rgba(16,185,129,0.12)' },
  rose:    { start: '#f43f5e', end: '#fb7185', mid: '#e11d48', glow: 'rgba(244,63,94,0.35)',     soft: 'rgba(244,63,94,0.12)' },
  amber:   { start: '#f59e0b', end: '#fbbf24', mid: '#d97706', glow: 'rgba(245,158,11,0.35)',    soft: 'rgba(245,158,11,0.12)' },
};

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
  root.style.setProperty('--accent-start', t.start);
  root.style.setProperty('--accent-end',   t.end);
  root.style.setProperty('--accent-mid',   t.mid);
  root.style.setProperty('--accent-glow',  t.glow);
  root.style.setProperty('--accent-soft',  t.soft);
}

function applyAppearance(mode) {
  document.documentElement.dataset.appearance = mode;
}

// Header toggle button
themeToggleBtn.addEventListener('click', () => {
  const next = state.settings.appearance === 'dark' ? 'light' : 'dark';
  state.settings.appearance = next;
  applyAppearance(next);
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

  document.querySelectorAll('.swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === s.theme);
  });

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

// Color swatches
document.querySelectorAll('.swatch').forEach(sw => {
  sw.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    state.settings.theme = sw.dataset.color;
  });
});

// Appearance buttons (in settings modal)
document.querySelectorAll('.appear-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.appear-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.settings.appearance = btn.dataset.appear;
    applyAppearance(btn.dataset.appear);
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
