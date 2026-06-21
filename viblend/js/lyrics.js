// js/lyrics.js — LRCLIB integration and synced lyric display

// ─── Lyric State ──────────────────────────────────────────────────────────────

let currentLyrics = []; // Array of { timeMs, text }
let isPlainLyrics = false;
let syncInterval = null;
let lastActiveIndex = -1;

// ─── Fetch from LRCLIB ────────────────────────────────────────────────────────

export async function fetchLyrics(track) {
  currentLyrics = [];
  isPlainLyrics = false;
  lastActiveIndex = -1;

  try {
    const params = new URLSearchParams({
      artist_name: track.artist || '',
      track_name: track.title || '',
      album_name: track.album || '',
    });
    if (track.durationMs) {
      params.set('duration', Math.round(track.durationMs / 1000));
    }

    const res = await fetch(`https://lrclib.net/api/get?${params}`, {
      headers: { 'Lrclib-Client': 'Viblend/1.0' },
    });

    if (!res.ok) {
      renderLyricsUnavailable();
      return;
    }

    const data = await res.json();

    if (data.syncedLyrics) {
      currentLyrics = parseLRC(data.syncedLyrics);
      isPlainLyrics = false;
      renderSyncedLyrics();
    } else if (data.plainLyrics) {
      renderPlainLyrics(data.plainLyrics);
      isPlainLyrics = true;
    } else {
      renderLyricsUnavailable();
    }
  } catch {
    renderLyricsUnavailable();
  }
}

// ─── LRC Parser ───────────────────────────────────────────────────────────────

function parseLRC(lrcString) {
  const lines = lrcString.split('\n');
  const result = [];

  for (const line of lines) {
    const match = line.match(/\[(\d+):(\d+)\.(\d+)\](.*)/);
    if (!match) continue;

    const minutes = parseInt(match[1]);
    const seconds = parseInt(match[2]);
    const centiseconds = parseInt(match[3]);
    const text = match[4].trim();

    const timeMs = (minutes * 60 + seconds) * 1000 + centiseconds * 10;
    if (text) result.push({ timeMs, text });
  }

  return result.sort((a, b) => a.timeMs - b.timeMs);
}

// ─── Render Lyrics UI ─────────────────────────────────────────────────────────

function getLyricsContainer() {
  return document.getElementById('lyrics-lines');
}

export function renderSyncedLyrics() {
  const container = getLyricsContainer();
  if (!container) return;

  container.innerHTML = '';
  currentLyrics.forEach((line, i) => {
    const el = document.createElement('div');
    el.className = 'lyric-line lyric-future';
    el.textContent = line.text;
    el.dataset.index = i;
    container.appendChild(el);
  });

  if (currentLyrics.length === 0) {
    renderLyricsUnavailable();
  }
}

function renderPlainLyrics(text) {
  const container = getLyricsContainer();
  if (!container) return;
  container.innerHTML = '';

  const lines = text.split('\n');
  lines.forEach(line => {
    const el = document.createElement('div');
    el.className = 'lyric-line lyric-plain';
    el.textContent = line || '\u00A0';
    container.appendChild(el);
  });
}

function renderLyricsUnavailable() {
  const container = getLyricsContainer();
  if (!container) return;
  container.innerHTML = '<div class="lyric-unavailable">No lyrics available</div>';
}

// ─── Sync Engine ──────────────────────────────────────────────────────────────

export function startLyricSync(getPositionMs) {
  stopLyricSync();
  if (isPlainLyrics || currentLyrics.length === 0) return;

  syncInterval = setInterval(() => {
    const positionMs = getPositionMs();
    updateActiveLyric(positionMs);
  }, 500);
}

export function stopLyricSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  lastActiveIndex = -1;
}

function updateActiveLyric(positionMs) {
  const container = getLyricsContainer();
  if (!container || currentLyrics.length === 0) return;

  // Find the current lyric line (last line whose timeMs <= positionMs)
  let activeIndex = -1;
  for (let i = 0; i < currentLyrics.length; i++) {
    if (currentLyrics[i].timeMs <= positionMs + 200) {
      activeIndex = i;
    } else {
      break;
    }
  }

  if (activeIndex === lastActiveIndex) return; // No change
  lastActiveIndex = activeIndex;

  const lines = container.querySelectorAll('.lyric-line');
  lines.forEach((el, i) => {
    el.classList.remove('lyric-active', 'lyric-past', 'lyric-future', 'lyric-near');
    if (i < activeIndex) {
      el.classList.add('lyric-past');
    } else if (i === activeIndex) {
      el.classList.add('lyric-active');
    } else if (i === activeIndex + 1 || i === activeIndex - 1) {
      el.classList.add('lyric-near');
    } else {
      el.classList.add('lyric-future');
    }
  });

  // Smooth scroll active line into view
  const activeLine = container.querySelector('.lyric-active');
  if (activeLine) {
    activeLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ─── Clear ────────────────────────────────────────────────────────────────────

export function clearLyrics() {
  stopLyricSync();
  currentLyrics = [];
  isPlainLyrics = false;
  const container = getLyricsContainer();
  if (container) container.innerHTML = '';
}
