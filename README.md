# Little Pomo 🍅

A beautiful, minimal Pomodoro timer with an analog clock face. No build step, no dependencies — just open `index.html` in a browser.

![Little Pomo](https://img.shields.io/badge/version-1.0.0-orange?style=flat-square) ![Vanilla JS](https://img.shields.io/badge/vanilla-JS-yellow?style=flat-square) ![Zero deps](https://img.shields.io/badge/dependencies-zero-green?style=flat-square)

## Features

- **Analog clock centerpiece** — smooth, continuously sweeping hands driven by `requestAnimationFrame` (no ticking)
- **Animated progress arc** — gradient ring around the clock counts down the session
- **Three modes** — Pomodoro, Short Break, Long Break with auto-progression
- **Task management** — add tasks, set an active focus, track completed pomodoros per task
- **Session dots** — visual tracker toward your next long break
- **Settings** — configurable durations, auto-start, sound alerts, volume, browser notifications
- **6 accent themes** — Coral, Violet, Cyan, Emerald, Rose, Amber (persisted to `localStorage`)
- **Keyboard shortcuts** — play/pause, reset, skip without touching the mouse
- **Chime sound** — pleasant 4-note chord via Web Audio API (no audio files needed)
- **Zero dependencies** — pure HTML, CSS, and vanilla JS

## Getting Started

```bash
git clone https://github.com/heykishan/little-pomo.git
cd little-pomo
open index.html   # macOS
# or just double-click index.html in your file explorer
```

No install, no build, no server required.

## Keyboard Shortcuts

| Key       | Action              |
|-----------|---------------------|
| `Space`   | Play / Pause timer  |
| `R`       | Reset current timer |
| `S`       | Skip to next session|

> Shortcuts are disabled when the task input field is focused.

## How It Works

The Pomodoro Technique is a time management method:

1. Pick a task and start a **25-minute** focus session
2. Work without distractions until the timer rings
3. Take a **5-minute** short break
4. Every 4 sessions, take a **15-minute** long break

Little Pomo tracks your sessions with dots and automatically queues the correct break type.

## Settings

All settings are saved to `localStorage` and persist across refreshes.

| Setting | Default | Description |
|---|---|---|
| Pomodoro duration | 25 min | Length of a focus session |
| Short break | 5 min | Break after each session |
| Long break | 15 min | Break after N sessions |
| Long break interval | 4 | Sessions before a long break |
| Auto-start breaks | Off | Start breaks automatically |
| Auto-start pomodoros | Off | Start next session automatically |
| Sound alerts | On | Chime on session complete |
| Volume | 70% | Chime volume |
| Browser notifications | Off | System notifications (requires permission) |
| Accent theme | Coral | UI color theme |

## File Structure

```
little-pomo/
├── index.html   # Markup and modal templates
├── style.css    # All styles (~700 lines, CSS custom properties for theming)
└── app.js       # Timer logic, clock rendering, task & settings management
```

## Browser Support

Any modern browser (Chrome, Firefox, Safari, Edge). Requires:
- `requestAnimationFrame` — for smooth clock hands
- `localStorage` — for settings persistence
- Web Audio API — for the chime sound (fails silently if unavailable)

## License

MIT
