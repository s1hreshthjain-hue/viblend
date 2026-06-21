// js/ui.js — Screen navigation, all UI rendering, event wiring

import CONFIG from './config.js';
import { getRoomShareURL, getRoomWhatsAppURL, generateRoomQR } from './room.js';
import { fetchLyrics, startLyricSync, stopLyricSync, clearLyrics } from './lyrics.js';
import vocalRemover from './vocals.js';

// ─── Screen Manager ───────────────────────────────────────────────────────────

const SCREENS = ['landing', 'home', 'waiting', 'nowplaying', 'queue', 'recap'];
let currentScreen = null;
let navBarVisible = false;

export function showScreen(id, options = {}) {
  SCREENS.forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) { el.classList.remove('active'); el.style.display = 'none'; }
  });

  const el = document.getElementById(`screen-${id}`);
  if (!el) { console.warn(`Screen not found: screen-${id}`); return; }

  el.style.display = 'flex';
  el.classList.add('active');
  currentScreen = id;

  if (options.scrollTop !== false) el.scrollTop = 0;
  if (options.animation) el.classList.add(`anim-${options.animation}`);

  // Nav bar visibility
  const showNav = ['nowplaying', 'queue', 'waiting'].includes(id);
  setNavBarVisible(showNav);

  // Update nav active states
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.screen === id);
  });
}

export function setNavBarVisible(visible) {
  const nav = document.getElementById('nav-bar');
  if (nav) nav.classList.toggle('visible', visible);
  navBarVisible = visible;
}

// ─── Toast System ─────────────────────────────────────────────────────────────

let toastQueue = [];
let toastContainer = null;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);
    }
  }
  return toastContainer;
}

export function showToast(message, type = 'info', duration = 3000) {
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' }[type] || '';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toast-out 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

window.addEventListener('viblend:toast', e => showToast(e.detail.message, e.detail.type, e.detail.duration));

// ─── Loading Overlay ──────────────────────────────────────────────────────────

export function showLoading(message = 'Loading...', progress = null) {
  let overlay = document.getElementById('loading-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `
      <div class="loading-spinner"></div>
      <div class="loading-text" id="loading-msg">${message}</div>
      ${progress !== null ? `
        <div class="loading-progress">
          <div class="loading-progress-fill" id="loading-progress-fill" style="width:${progress}%"></div>
        </div>` : ''}
    `;
    document.body.appendChild(overlay);
  } else {
    const msg = overlay.querySelector('#loading-msg');
    if (msg) msg.textContent = message;
    updateLoadingProgress(progress);
  }
}

export function updateLoadingProgress(percent, message = null) {
  const fill = document.getElementById('loading-progress-fill');
  if (fill && percent !== null) fill.style.width = `${percent}%`;
  const msg = document.getElementById('loading-msg');
  if (msg && message) msg.textContent = message;
}

export function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.remove();
}

// ─── Error Modal ──────────────────────────────────────────────────────────────

export function showErrorModal(title, body, actions = []) {
  const existing = document.getElementById('error-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'error-modal-overlay';
  overlay.className = 'modal-overlay center';

  const actionsHTML = actions.length
    ? actions.map(a => `<button class="btn-primary" onclick="${a.fn}">${a.label}</button>`).join('')
    : '<button class="btn-secondary" onclick="document.getElementById(\'error-modal-overlay\').remove()">Dismiss</button>';

  overlay.innerHTML = `
    <div class="modal center">
      <div class="modal-title">${title}</div>
      <div class="modal-body">${body}</div>
      <div class="modal-actions">${actionsHTML}</div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ─── Connection Banner ────────────────────────────────────────────────────────

export function showConnectionBanner(message) {
  let banner = document.getElementById('connection-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'connection-banner';
    banner.className = 'connection-banner';
    document.body.appendChild(banner);
  }
  banner.textContent = message;
  banner.classList.add('visible');
}

export function hideConnectionBanner() {
  const banner = document.getElementById('connection-banner');
  if (banner) banner.classList.remove('visible');
}

// ─── SCREEN 1: Landing ────────────────────────────────────────────────────────

export function renderLanding() {
  document.getElementById('btn-spotify')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('viblend:auth', { detail: { platform: 'spotify' } }));
  });
  document.getElementById('btn-apple')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('viblend:auth', { detail: { platform: 'apple' } }));
  });
  document.getElementById('btn-youtube')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('viblend:auth', { detail: { platform: 'youtube' } }));
  });
}

// ─── SCREEN 2: Home ──────────────────────────────────────────────────────────

export function renderHome(session) {
  // Avatar
  const avatarEl = document.getElementById('home-avatar');
  if (avatarEl) {
    if (session.avatarUrl) {
      avatarEl.innerHTML = `<img src="${session.avatarUrl}" alt="${session.displayName}" />`;
    } else {
      avatarEl.textContent = session.displayName?.[0]?.toUpperCase() || '?';
    }
  }

  // Platform badge
  const badgeEl = document.getElementById('home-platform-badge');
  if (badgeEl) {
    badgeEl.className = `platform-badge ${session.platform}`;
    badgeEl.innerHTML = getPlatformIcon(session.platform, 10);
  }

  // Bind create party button
  document.getElementById('btn-create-party')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('viblend:create-party'));
  });

  // Bind join party card — shows input
  const joinCard = document.getElementById('btn-join-party');
  const joinInputWrap = document.getElementById('join-input-wrap');
  joinCard?.addEventListener('click', () => {
    joinInputWrap?.classList.toggle('visible');
    document.getElementById('join-code-input')?.focus();
  });

  // Join go button
  document.getElementById('btn-join-go')?.addEventListener('click', handleJoinSubmit);
  document.getElementById('join-code-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleJoinSubmit();
  });

  // How it works toggle
  document.getElementById('how-toggle')?.addEventListener('click', () => {
    document.getElementById('how-steps')?.classList.toggle('visible');
  });
}

function handleJoinSubmit() {
  const input = document.getElementById('join-code-input');
  const code = input?.value?.trim().toUpperCase();
  if (!code || code.length !== 6) {
    showToast('Enter a 6-character room code', 'error');
    input?.focus();
    return;
  }
  window.dispatchEvent(new CustomEvent('viblend:join-party', { detail: { code } }));
}

// ─── SCREEN 3: Waiting Room ───────────────────────────────────────────────────

export function renderWaitingRoomHost(room, session) {
  // Room code display
  const codeEl = document.getElementById('room-code-display');
  if (codeEl) codeEl.textContent = room.code;

  // QR code
  generateRoomQR(room.code, 'qr-container');

  // Share buttons
  const whatsappBtn = document.getElementById('btn-whatsapp');
  if (whatsappBtn) whatsappBtn.href = getRoomWhatsAppURL(room.code);

  const copyBtn = document.getElementById('btn-copy-code');
  copyBtn?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(room.code).catch(() => {});
    showToast('Room code copied!', 'success', 1500);
  });

  // Vibe selector
  renderVibeSelector(room.vibe);

  // Coverage slider
  renderCoverageSlider(room.coverage_percent);

  // Vocal volume slider
  renderVocalVolumeSlider(room.vocal_volume ?? 100);

  // Start party button (initially disabled)
  const startBtn = document.getElementById('btn-start-party');
  if (startBtn) startBtn.disabled = true;
}

export function renderWaitingRoomGuest(room) {
  const codeEl = document.getElementById('room-code-display');
  if (codeEl) codeEl.textContent = room.code;

  // Show guest state — hide host-only controls
  document.getElementById('vibe-section')?.classList.add('hidden');
  document.getElementById('coverage-section')?.classList.add('hidden');
  document.getElementById('vocal-section')?.classList.add('hidden');
  document.getElementById('start-party-section')?.classList.add('hidden');

  // Show guest waiting banner
  const bannerEl = document.getElementById('guest-status-banner');
  if (bannerEl) {
    bannerEl.textContent = 'Analysing your music taste...';
    bannerEl.className = 'guest-waiting-banner';
  }
}

export function renderVibeSelector(selectedVibe) {
  const grid = document.getElementById('vibe-grid');
  if (!grid) return;

  grid.innerHTML = CONFIG.VIBES.map(v => `
    <button class="vibe-tile ${v.id === selectedVibe ? 'selected' : ''}" data-vibe="${v.id}">
      <span class="vibe-emoji">${v.emoji}</span>
      <span class="vibe-label">${v.label}</span>
    </button>
  `).join('');

  grid.querySelectorAll('.vibe-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      grid.querySelectorAll('.vibe-tile').forEach(t => t.classList.remove('selected'));
      tile.classList.add('selected');
      window.dispatchEvent(new CustomEvent('viblend:vibe-change', { detail: { vibe: tile.dataset.vibe } }));
    });
  });
}

export function renderCoverageSlider(value = 75) {
  const slider = document.getElementById('coverage-slider');
  const display = document.getElementById('coverage-value');
  const desc = document.getElementById('coverage-desc');

  if (slider) {
    slider.value = value;
    updateSliderFill(slider);
    slider.addEventListener('input', () => {
      updateSliderFill(slider);
      const v = parseInt(slider.value);
      if (display) display.textContent = v + '%';
      updateCoverageDesc(desc, v);
      updateCoveragePresets(v);
      window.dispatchEvent(new CustomEvent('viblend:coverage-change', { detail: { value: v } }));
    });
  }
  if (display) display.textContent = value + '%';
  updateCoverageDesc(desc, value);
  updateCoveragePresets(value);

  // Preset pills
  document.querySelectorAll('.preset-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const v = parseInt(pill.dataset.value);
      if (slider) { slider.value = v; updateSliderFill(slider); }
      if (display) display.textContent = v + '%';
      updateCoverageDesc(desc, v);
      updateCoveragePresets(v);
      window.dispatchEvent(new CustomEvent('viblend:coverage-change', { detail: { value: v } }));
    });
  });
}

function updateCoverageDesc(el, v) {
  if (!el) return;
  if (v <= 25)      el.textContent = 'Deep cuts — songs from individual members may appear';
  else if (v <= 50) el.textContent = 'Balanced mix of shared and personal favourites';
  else if (v <= 75) el.textContent = 'Songs most of the group knows and loves';
  else              el.textContent = 'Only songs everyone in the room recognises';
}

function updateCoveragePresets(v) {
  document.querySelectorAll('.preset-pill').forEach(pill => {
    pill.classList.toggle('selected', parseInt(pill.dataset.value) === v);
  });
}

export function renderVocalVolumeSlider(value = 100) {
  const slider = document.getElementById('vocal-slider');
  const modeLabel = document.getElementById('vocal-mode-label');

  if (slider) {
    slider.value = value;
    updateSliderFill(slider);
    slider.addEventListener('input', () => {
      const v = parseInt(slider.value);
      updateSliderFill(slider);
      updateVocalModeLabel(modeLabel, v);
      window.dispatchEvent(new CustomEvent('viblend:vocal-change', { detail: { value: v } }));
    });
  }
  updateVocalModeLabel(modeLabel, value);
}

function updateVocalModeLabel(el, v) {
  if (!el) return;
  if (v === 0)       { el.textContent = 'Instrumental'; el.className = 'vocal-mode-label instrumental'; }
  else if (v === 100){ el.textContent = 'Original'; el.className = 'vocal-mode-label original'; }
  else               { el.textContent = `Blend (${v}% vocals)`; el.className = 'vocal-mode-label blend'; }
}

export function updateMembersList(members, isHost) {
  const list = document.getElementById('members-list');
  if (!list) return;

  list.innerHTML = members.map(m => `
    <div class="member-card" data-session="${m.user_session_id}" id="member-${m.user_session_id}">
      <div class="member-avatar">
        <div class="avatar">${m.avatar_url
          ? `<img src="${m.avatar_url}" alt="${m.display_name}" />`
          : (m.display_name?.[0]?.toUpperCase() || '?')}
        </div>
        <div class="platform-badge ${m.platform}">${getPlatformIcon(m.platform, 10)}</div>
      </div>
      <div class="member-info">
        <div class="member-name">${escHtml(m.display_name || 'Anonymous')}${m.is_host ? ' <span class="chip chip-orange" style="font-size:10px;padding:2px 6px">Host</span>' : ''}</div>
        <div class="member-platform">${capitalize(m.platform || '')}</div>
      </div>
      <div class="member-status">
        <div class="status-dot ${getTasteStatus(m)}"></div>
        <span style="font-size:12px;color:var(--text-tertiary)">${getTasteStatusLabel(m)}</span>
      </div>
    </div>
  `).join('');

  // Check if we can enable start party button
  if (isHost) {
    const allReady = members.length > 1 && members.every(m => m.taste_ready !== false);
    const startBtn = document.getElementById('btn-start-party');
    if (startBtn) startBtn.disabled = !(members.length >= 2);
  }
}

function getTasteStatus(m) {
  if (m.is_host) return 'host';
  if (m.taste_ready) return 'ready';
  return 'loading';
}

function getTasteStatusLabel(m) {
  if (m.is_host) return 'Host';
  if (m.taste_ready) return 'Ready';
  return 'Loading...';
}

export function animateMemberJoin(sessionId) {
  const card = document.getElementById(`member-${sessionId}`);
  if (card) { card.classList.add('anim-member-join'); }
}

// ─── SCREEN 4: Now Playing ────────────────────────────────────────────────────

export function renderNowPlaying({ track, room, members, isHost }) {
  if (!track) return;

  // Album art
  const art = document.getElementById('nowplaying-art');
  if (art) {
    art.src = track.album_art_url || track.albumArtUrl || '';
    art.onerror = () => art.style.background = 'var(--bg-elevated)';
    extractAlbumColor(art);
    art.classList.add('playing');
  }

  // Track info
  setText('nowplaying-title', track.title);
  setText('nowplaying-artist', track.artist);

  // Coverage badge
  const covBadge = document.getElementById('coverage-badge');
  if (covBadge && track.coverage_score !== undefined) {
    const pct = Math.round((track.coverage_score || 0) * 100);
    covBadge.innerHTML = `<span>👥</span> ${pct}% of the room knows this`;
  }

  // Member avatars in top bar
  renderMemberAvatars(members);

  // Room code small
  setText('room-code-small', room?.code || '');

  // Vocals slider (mini)
  const vocalsSlider = document.getElementById('vocals-mini-slider');
  if (vocalsSlider) {
    vocalsSlider.value = room?.vocal_volume ?? 100;
    updateSliderFill(vocalsSlider);
    vocalsSlider.addEventListener('input', () => {
      const v = parseInt(vocalsSlider.value);
      updateSliderFill(vocalsSlider);
      updateVocalsMiniIcon(v);
      window.dispatchEvent(new CustomEvent('viblend:vocal-change', { detail: { value: v } }));
    });
    updateVocalsMiniIcon(room?.vocal_volume ?? 100);
  }

  // Playback controls (host only can interact)
  if (!isHost) {
    document.querySelectorAll('.ctrl-btn').forEach(btn => {
      btn.disabled = true;
      btn.style.opacity = '0.3';
    });
    const progressBar = document.getElementById('progress-bar-wrap');
    if (progressBar) progressBar.style.pointerEvents = 'none';
  }

  // Progress bar seek (host only)
  if (isHost) {
    const progressWrap = document.getElementById('progress-bar-wrap');
    progressWrap?.addEventListener('click', (e) => {
      const rect = progressWrap.getBoundingClientRect();
      const fraction = (e.clientX - rect.left) / rect.width;
      window.dispatchEvent(new CustomEvent('viblend:seek', { detail: { fraction } }));
    });
  }

  // Lyrics fetch
  clearLyrics();
  fetchLyrics(track).then(() => {
    // Start sync after lyrics load
  }).catch(() => {});
}

function updateVocalsMiniIcon(v) {
  const icon = document.getElementById('vocals-mini-icon');
  if (!icon) return;
  icon.textContent = v === 0 ? '🔇' : v < 50 ? '🎼' : v < 90 ? '🎤' : '🎵';
}

export function updatePlaybackUI(state) {
  const { isPlaying, positionMs, durationMs } = state;

  // Play/pause icon
  const playBtn = document.getElementById('btn-play-pause');
  if (playBtn) playBtn.innerHTML = isPlaying
    ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
    : `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`;

  // Progress bar
  const fill = document.getElementById('progress-bar-fill');
  const handle = document.getElementById('progress-handle');
  if (fill && durationMs > 0) {
    const pct = Math.min(100, (positionMs / durationMs) * 100);
    fill.style.width = `${pct}%`;
    if (handle) handle.style.left = `${pct}%`;
  }

  // Timestamps
  setText('progress-elapsed', formatTime(positionMs));
  setText('progress-total', formatTime(durationMs));
}

function extractAlbumColor(imgEl) {
  imgEl.addEventListener('load', () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    const ctx = canvas.getContext('2d');
    try {
      ctx.drawImage(imgEl, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0;
      const len = data.length / 4;
      for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i+1]; b += data[i+2]; }
      r = Math.round(r / len); g = Math.round(g / len); b = Math.round(b / len);
      const glow = `rgba(${r},${g},${b},0.4)`;
      imgEl.style.boxShadow = `0 20px 60px rgba(0,0,0,0.7), 0 0 60px ${glow}`;
      imgEl.style.setProperty('--album-glow', glow);
    } catch { /* cross-origin, ignore */ }
  }, { once: true });
}

export function renderMemberAvatars(members) {
  const row = document.getElementById('member-avatars-row');
  if (!row) return;
  row.innerHTML = members.slice(0, 4).map(m => `
    <div class="avatar" title="${escHtml(m.display_name || '')}" style="position:relative">
      ${m.avatar_url
        ? `<img src="${m.avatar_url}" alt="${m.display_name}" />`
        : (m.display_name?.[0]?.toUpperCase() || '?')}
      ${m.is_mic_active ? '<span style="position:absolute;bottom:0;right:0;width:8px;height:8px;border-radius:50%;background:var(--red-mic);border:1.5px solid var(--bg-primary)"></span>' : ''}
    </div>
  `).join('');
}

export function updateQueuePreview(queue, currentIndex) {
  const container = document.getElementById('queue-preview-list');
  if (!container) return;

  const upcoming = queue.slice(currentIndex, currentIndex + 6);
  container.innerHTML = upcoming.map((t, i) => {
    const isCurrent = i === 0;
    return `
      <div class="queue-row ${isCurrent ? 'current' : ''}">
        <img class="queue-row-art" src="${t.album_art_url || ''}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
        <div class="queue-row-info">
          <div class="queue-row-title">${escHtml(t.title)}</div>
          <div class="queue-row-artist">${escHtml(t.artist)}</div>
          <div class="queue-row-coverage">${Math.round((t.coverage_score || 0) * 100)}% know this</div>
        </div>
        <span class="platform-icon-sm">${getPlatformEmoji(t.platform)}</span>
      </div>
    `;
  }).join('');
}

// ─── SCREEN 5: Lyrics Panel ───────────────────────────────────────────────────

export function openLyricsPanel(track) {
  const panel = document.getElementById('lyrics-panel');
  if (!panel) return;

  setText('lyrics-panel-title', track?.title || '');
  setText('lyrics-panel-artist', track?.artist || '');

  // Vocal slider in lyrics panel
  const slider = document.getElementById('lyrics-vocal-slider');
  if (slider) {
    slider.value = window.currentRoom?.vocal_volume ?? 100;
    updateSliderFill(slider);
    slider.addEventListener('input', () => {
      const v = parseInt(slider.value);
      updateSliderFill(slider);
      window.dispatchEvent(new CustomEvent('viblend:vocal-change', { detail: { value: v } }));
    });
  }

  panel.classList.add('visible');

  // Drag to close
  let startY = 0;
  panel.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
  panel.addEventListener('touchend', e => {
    if (e.changedTouches[0].clientY - startY > 80) closeLyricsPanel();
  }, { passive: true });
}

export function closeLyricsPanel() {
  document.getElementById('lyrics-panel')?.classList.remove('visible');
}

// ─── SCREEN 6: Karaoke Panel ──────────────────────────────────────────────────

export function openKaraokePanel(isHost, members) {
  const panel = document.getElementById('karaoke-panel');
  if (!panel) return;

  if (isHost) {
    renderKaraokeHostView(members);
  } else {
    renderKaraokeGuestView(members);
  }

  panel.classList.add('visible');
}

export function closeKaraokePanel() {
  document.getElementById('karaoke-panel')?.classList.remove('visible');
}

function renderKaraokeHostView(members) {
  const hostView = document.getElementById('karaoke-host-view');
  const guestView = document.getElementById('karaoke-guest-view');
  if (hostView) hostView.style.display = 'block';
  if (guestView) guestView.style.display = 'none';

  const micCount = members.filter(m => m.is_mic_active).length;
  setText('mic-count-badge', micCount.toString());

  const micList = document.getElementById('mic-member-list');
  if (!micList) return;

  micList.innerHTML = members.map(m => `
    <div class="mic-member" id="mic-member-${m.user_session_id}">
      <div class="mic-member-top">
        <div class="avatar" style="width:36px;height:36px;font-size:13px">
          ${m.avatar_url ? `<img src="${m.avatar_url}" alt="" />` : (m.display_name?.[0]?.toUpperCase() || '?')}
        </div>
        <div class="mic-member-info">
          <div class="mic-member-name">${escHtml(m.display_name || 'Member')}</div>
        </div>
        <div class="mic-active-dot ${m.is_mic_active ? 'active' : ''}"></div>
        <div class="vu-meter ${m.is_mic_active ? '' : 'idle'}" id="vu-${m.user_session_id}">
          ${[1,2,3,4,5].map(i => `<div class="vu-bar"></div>`).join('')}
        </div>
      </div>
      <div class="mic-member-controls">
        <input type="range" class="viblend-slider" min="0" max="100" value="${Math.round((m.mic_volume || 1) * 100)}"
          data-session="${m.user_session_id}" id="vol-${m.user_session_id}" />
        <button class="btn-mute" data-session="${m.user_session_id}" data-muted="false">Mute</button>
      </div>
    </div>
  `).join('');

  // Bind volume sliders
  micList.querySelectorAll('input[type=range]').forEach(slider => {
    updateSliderFill(slider);
    slider.addEventListener('input', () => {
      updateSliderFill(slider);
      const sessionId = slider.dataset.session;
      const vol = parseInt(slider.value) / 100;
      window.dispatchEvent(new CustomEvent('viblend:mic-volume', { detail: { sessionId, volume: vol } }));
    });
  });

  // Bind mute buttons
  micList.querySelectorAll('.btn-mute').forEach(btn => {
    btn.addEventListener('click', () => {
      const muted = btn.dataset.muted === 'true';
      btn.dataset.muted = (!muted).toString();
      btn.classList.toggle('muted', !muted);
      btn.textContent = muted ? 'Mute' : 'Unmute';
      const sessionId = btn.dataset.session;
      window.dispatchEvent(new CustomEvent('viblend:mic-mute', { detail: { sessionId, muted: !muted } }));
    });
  });
}

function renderKaraokeGuestView(members) {
  const hostView = document.getElementById('karaoke-host-view');
  const guestView = document.getElementById('karaoke-guest-view');
  if (hostView) hostView.style.display = 'none';
  if (guestView) guestView.style.display = 'flex';

  // Other mics
  const otherMicsEl = document.getElementById('other-mics');
  if (otherMicsEl) {
    const singing = members.filter(m => m.is_mic_active && !m.is_host_session);
    otherMicsEl.innerHTML = singing.map(m => `
      <div class="other-mic-pill singing">
        🎤 ${escHtml(m.display_name?.split(' ')[0] || 'Someone')}
      </div>
    `).join('');
  }
}

export function updateMicButton(isActive) {
  const fab = document.getElementById('mic-fab');
  const bigBtn = document.getElementById('mic-button-big');

  if (fab) {
    fab.classList.toggle('active', isActive);
    fab.innerHTML = isActive
      ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"/></svg>`
      : `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"/></svg>`;
  }

  if (bigBtn) {
    bigBtn.classList.toggle('active', isActive);
    const label = bigBtn.querySelector('.mic-label');
    if (label) label.textContent = isActive ? 'LIVE' : 'Tap to Sing';
    bigBtn.querySelector('.mic-tap')?.remove();
    if (!isActive) {
      const tap = document.createElement('div');
      tap.textContent = 'Tap to Stop';
      tap.style.cssText = 'font-size:11px;color:inherit;opacity:0.8';
      if (!isActive) tap.textContent = 'Tap to Sing';
      bigBtn.appendChild(tap);
    }
  }
}

// ─── SCREEN 7: Queue ──────────────────────────────────────────────────────────

export function renderQueueScreen(queue, currentIndex, vibe, coveragePct, isHost) {
  // Vibe pill
  const vibePill = document.getElementById('queue-vibe-pill');
  if (vibePill) {
    const v = CONFIG.VIBES.find(x => x.id === vibe);
    vibePill.innerHTML = `${v?.emoji || ''} ${v?.label || vibe} · ${coveragePct}% coverage`;
  }

  const list = document.getElementById('queue-list');
  if (!list) return;

  list.innerHTML = queue.map((t, i) => {
    const isPlaying = i === currentIndex;
    const isPlayed = t.played && i < currentIndex;
    const covPct = Math.round((t.coverage_score || 0) * 100);

    return `
      <div class="queue-item ${isPlaying ? 'playing' : ''} ${isPlayed ? 'played' : ''}" data-pos="${i}" data-id="${t.id}">
        <div class="queue-pos">
          ${isPlayed ? '<span class="queue-played-check">✓</span>' : (i + 1)}
        </div>
        <img class="queue-item-art" src="${t.album_art_url || ''}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
        <div class="queue-item-info">
          <div class="queue-item-title">${escHtml(t.title)}</div>
          <div class="queue-item-artist">${escHtml(t.artist)}</div>
        </div>
        <div class="coverage-bar-wrap">
          <div class="coverage-bar"><div class="coverage-bar-fill" style="width:${covPct}%"></div></div>
          <div class="coverage-pct">${covPct}%</div>
        </div>
        <span title="${capitalize(t.platform || '')}">${getPlatformEmoji(t.platform)}</span>
        ${isHost && !t.played ? `<button class="btn-icon-sm remove-queue-btn" data-id="${t.id}" title="Remove">✕</button>` : ''}
      </div>
    `;
  }).join('');

  // Bind remove buttons (host only)
  if (isHost) {
    list.querySelectorAll('.remove-queue-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('viblend:remove-queue-item', { detail: { id: btn.dataset.id } }));
      });
    });
  }

  // Scroll to current
  const currentEl = list.querySelector('.queue-item.playing');
  currentEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ─── SCREEN 8: Recap ─────────────────────────────────────────────────────────

export function renderRecap(stats) {
  setText('recap-songs-played', stats.songsPlayed || '0');

  const durEl = document.getElementById('recap-duration');
  if (durEl) durEl.textContent = formatDuration(stats.totalDurationMs || 0);

  const songEl = document.getElementById('recap-top-song');
  if (songEl && stats.highestCoverageSong) {
    songEl.textContent = `${stats.highestCoverageSong.title} — ${Math.round((stats.highestCoverageSong.coverage_score || 0) * 100)}% crowd coverage`;
  }

  setText('recap-member-count', (stats.memberCount || 0) + ' people');

  // Confetti
  startConfetti();

  // Generate share card
  generateShareCard(stats);
}

function generateShareCard(stats) {
  const canvas = document.getElementById('share-canvas');
  if (!canvas) return;
  canvas.width = 480; canvas.height = 854;
  const ctx = canvas.getContext('2d');

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, 854);
  grad.addColorStop(0, '#1A1035');
  grad.addColorStop(1, '#0F0E1A');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 480, 854);

  // Violet glow
  const radial = ctx.createRadialGradient(240, 200, 0, 240, 200, 300);
  radial.addColorStop(0, 'rgba(91,77,222,0.3)');
  radial.addColorStop(1, 'transparent');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, 480, 854);

  // Logo
  ctx.font = 'bold 48px -apple-system, Helvetica Neue, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText('Vibl', 220, 120);
  ctx.fillStyle = '#5B4DDE';
  ctx.fillText('end', 280, 120);

  // Stats
  ctx.font = 'bold 72px -apple-system';
  ctx.fillStyle = '#5B4DDE';
  ctx.fillText(stats.songsPlayed || 0, 240, 280);
  ctx.font = '20px -apple-system';
  ctx.fillStyle = '#9090B0';
  ctx.fillText('songs played together', 240, 310);

  ctx.font = 'bold 32px -apple-system';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(formatDuration(stats.totalDurationMs || 0), 240, 400);
  ctx.font = '16px -apple-system';
  ctx.fillStyle = '#9090B0';
  ctx.fillText('of music shared', 240, 425);

  ctx.font = '14px -apple-system';
  ctx.fillStyle = '#5A5A7A';
  ctx.fillText('viblend.app', 240, 820);
}

export function startConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#5B4DDE', '#E85D3B', '#1DB954', '#FF0000', '#EEEDFE', '#FFD700'];
  const pieces = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * -canvas.height,
    w: Math.random() * 10 + 6,
    h: Math.random() * 6 + 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    speed: Math.random() * 3 + 2,
    angle: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.2,
    sway: (Math.random() - 0.5) * 1.5,
  }));

  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
      p.y += p.speed;
      p.x += p.sway;
      p.angle += p.spin;
      if (p.y > canvas.height) { p.y = -10; p.x = Math.random() * canvas.width; }
    });
    if (frame < 300) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
    frame++;
  }
  draw();
}

// ─── VU Meter updates from karaoke events ────────────────────────────────────

window.addEventListener('viblend:vu-update', (e) => {
  const { peerId, level } = e.detail;
  const meters = document.querySelectorAll(`[id^="vu-"]`);
  // Try to find meter by session id mapped to peer
  const meter = document.getElementById(`vu-${peerId}`);
  if (!meter) return;

  const bars = meter.querySelectorAll('.vu-bar');
  const levels = [level * 0.6, level * 0.9, level, level * 0.8, level * 0.5];
  bars.forEach((bar, i) => {
    const h = Math.max(4, Math.round(levels[i] * 20));
    bar.style.height = `${h}px`;
    bar.style.background = level > 0.7 ? 'var(--red-mic)' : level > 0.3 ? 'var(--violet)' : 'var(--text-tertiary)';
  });
  meter.classList.toggle('idle', level < 0.05);
});

// ─── Ingestion Progress ───────────────────────────────────────────────────────

export function updateIngestionProgress(percent, message) {
  const msgEl = document.getElementById('ingestion-msg');
  const fillEl = document.getElementById('ingestion-fill');
  if (msgEl) msgEl.textContent = message;
  if (fillEl) fillEl.style.width = `${percent}%`;
}

// ─── Slider fill tracking ─────────────────────────────────────────────────────

export function updateSliderFill(slider) {
  const min = parseFloat(slider.min) || 0;
  const max = parseFloat(slider.max) || 100;
  const val = parseFloat(slider.value) || 0;
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.setProperty('--slider-percent', `${pct}%`);
}

// Init all sliders on page load
export function initSliders() {
  document.querySelectorAll('input[type=range].viblend-slider').forEach(s => {
    updateSliderFill(s);
    s.addEventListener('input', () => updateSliderFill(s));
  });
}

// ─── Mic access error modal ───────────────────────────────────────────────────

window.addEventListener('viblend:mic-denied', () => {
  showErrorModal(
    'Microphone Required',
    'Viblend needs microphone access to enable karaoke. Please allow microphone access in your browser settings and try again.',
    [{ label: 'OK', fn: "document.getElementById('error-modal-overlay').remove()" }]
  );
});

// ─── Global error handler ─────────────────────────────────────────────────────

window.addEventListener('viblend:error', e => {
  const { type, message } = e.detail;
  switch (type) {
    case 'SPOTIFY_PREMIUM_REQUIRED':
      showErrorModal(
        'Spotify Premium Required',
        'Spotify Premium is required to play music through Viblend. Connect a different platform or ask your host to be the music source.',
        [{ label: 'Got it', fn: "document.getElementById('error-modal-overlay').remove()" }]
      );
      break;
    case 'ROOM_FULL':
      showErrorModal('Party is Full', 'This party already has the maximum of 4 people.', []);
      break;
    case 'ROOM_NOT_FOUND':
      showErrorModal('Room Not Found', 'This party has ended or the code is incorrect.', []);
      break;
    default:
      if (message) showToast(message, 'error');
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function formatTime(ms) {
  const total = Math.round((ms || 0) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDuration(ms) {
  const total = Math.round((ms || 0) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

function getPlatformIcon(platform, size = 14) {
  const icons = {
    spotify: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="#1DB954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`,
    apple: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="#FA243C"><path d="M23.997 6.124a.89.89 0 00-.054-.277A5.9 5.9 0 0019.074 2.2a6.7 6.7 0 00-4.879 2.182A6.81 6.81 0 009.26 2.2a5.871 5.871 0 00-4.868 3.647 5.88 5.88 0 00-.289 2.077C4.103 12.76 8.3 17.362 12 21.8c3.7-4.438 7.896-9.04 7.896-13.876a6.03 6.03 0 00-.1-1.045l.201-.755z"/></svg>`,
    youtube: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="#FF0000"><path d="M23.495 6.205a3.007 3.007 0 00-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 00.527 6.205a31.247 31.247 0 00-.522 5.805 31.247 31.247 0 00.522 5.783 3.007 3.007 0 002.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 002.088-2.088 31.247 31.247 0 00.5-5.783 31.247 31.247 0 00-.5-5.805zM9.609 15.601V8.408l6.264 3.602z"/></svg>`,
  };
  return icons[platform] || '🎵';
}

function getPlatformEmoji(platform) {
  return { spotify: '🟢', apple: '🍎', youtube: '▶️' }[platform] || '🎵';
}
