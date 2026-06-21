// js/app.js — Main application controller for app.html

import CONFIG from './config.js';
import { loadSession, clearSession, initiateSpotifyAuth, initiateAppleAuth, initiateYouTubeAuth, handleSpotifyCallback } from './auth.js';
import { ingestTasteData } from './taste.js';
import { generateBlendedQueue, createRecalculationDebouncer } from './algorithm.js';
import { player } from './player.js';
import { initAudioContext, initPeer, activateMic, deactivateMic, setGuestMicVolume, setMasterMicVolume, setMasterMusicVolume, activeMics, connectDataChannelToHost, listenForGuestDataConnections, setHostPeerId } from './karaoke.js';
import vocalRemover from './vocals.js';
import { fetchLyrics, startLyricSync, stopLyricSync, clearLyrics } from './lyrics.js';
import { createParty, joinParty, startParty, updateVibe, updateCoverage, updateVocalVolume, toggleKaraoke, leaveParty, isHostSession, getCurrentRoom, buildRecapStats } from './room.js';
import { getQueue, getRoomMembers, updateMemberMicStatus } from './supabase.js';
import { startRealtime, stopRealtime } from './realtime.js';
import {
  showScreen, showToast, showLoading, hideLoading, showErrorModal,
  renderLanding, renderHome, renderWaitingRoomHost, renderWaitingRoomGuest,
  renderVibeSelector, renderCoverageSlider, renderVocalVolumeSlider, updateMembersList,
  renderNowPlaying, updatePlaybackUI, updateQueuePreview, renderQueueScreen,
  openLyricsPanel, closeLyricsPanel, openKaraokePanel, closeKaraokePanel,
  updateMicButton, updateIngestionProgress, renderRecap, initSliders,
  updateSliderFill, animateMemberJoin,
} from './ui.js';
import { registerServiceWorker, initInstallPrompt } from './pwa.js';

// ─── App State ────────────────────────────────────────────────────────────────

let currentQueue = [];
let currentMembers = [];
let micActive = false;
let recalcDebounced = null;

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  await registerServiceWorker();
  initInstallPrompt();
  initSliders();
  bindGlobalEvents();

  // Handle Spotify OAuth callback
  const url = new URL(window.location.href);
  if (url.searchParams.has('code') && url.searchParams.has('state')) {
    await handleAuthCallback(url);
    return;
  }

  // Handle room join deep link (/join/XXXXXX)
  const joinMatch = window.location.pathname.match(/\/join\/([A-Z0-9]{6})/i);
  if (joinMatch) {
    sessionStorage.setItem('pending_join_code', joinMatch[1].toUpperCase());
  }

  // Restore session
  const session = loadSession();
  if (session?.accessToken) {
    window.viblendSession = session;
    await onAuthSuccess(session, false);
  } else {
    showScreen('landing');
    renderLanding();
  }
}

// ─── OAuth Callback Handling ──────────────────────────────────────────────────

async function handleAuthCallback(url) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    showScreen('landing');
    renderLanding();
    showToast('Authentication cancelled', 'error');
    window.history.replaceState({}, '', '/');
    return;
  }

  try {
    showLoading('Connecting to Spotify...', 30);
    const session = await handleSpotifyCallback(code, state);
    window.history.replaceState({}, '', '/app');
    hideLoading();
    await onAuthSuccess(session, true);
  } catch (e) {
    hideLoading();
    showScreen('landing');
    renderLanding();
    showToast('Login failed — please try again', 'error');
    window.history.replaceState({}, '', '/');
  }
}

// ─── Auth Flow ────────────────────────────────────────────────────────────────

window.addEventListener('viblend:auth', async (e) => {
  const { platform } = e.detail;
  try {
    showLoading('Connecting...', 10);
    if (platform === 'spotify') {
      await initiateSpotifyAuth(); // Redirects away
    } else if (platform === 'apple') {
      const session = await initiateAppleAuth();
      hideLoading();
      await onAuthSuccess(session, true);
    } else if (platform === 'youtube') {
      const session = await initiateYouTubeAuth();
      hideLoading();
      await onAuthSuccess(session, true);
    }
  } catch (e) {
    hideLoading();
    showToast('Connection failed — please try again', 'error');
    console.error('Auth error:', e);
  }
});

async function onAuthSuccess(session, runIngestion = true) {
  // Navigate to home
  showScreen('home');
  renderHome(session);

  // Ingestion runs in background
  if (runIngestion && !session.tasteData) {
    ingestTasteData((pct, msg) => {
      // We could show this somewhere subtle if needed
      console.log(`Taste ingestion: ${pct}% — ${msg}`);
    }).then(tasteData => {
      console.log(`Taste ingested: ${tasteData.tracks.length} tracks`);
    }).catch(e => {
      console.warn('Taste ingestion failed:', e);
    });
  }

  // Check for pending join link
  const pendingCode = sessionStorage.getItem('pending_join_code');
  if (pendingCode) {
    sessionStorage.removeItem('pending_join_code');
    await handleJoinParty(pendingCode);
  }
}

// ─── Create Party ─────────────────────────────────────────────────────────────

window.addEventListener('viblend:create-party', async () => {
  try {
    showLoading('Creating party...', 20);
    const { room } = await createParty();
    window.currentRoom = room;

    showLoading('Reading your music...', 50);
    if (!window.viblendSession.tasteData) {
      await ingestTasteData((pct, msg) => updateLoadingProgress(50 + pct * 0.4, msg));
    }

    hideLoading();
    await enterWaitingRoomHost(room);
  } catch (e) {
    hideLoading();
    showToast('Could not create party — please try again', 'error');
    console.error('Create party error:', e);
  }
});

async function enterWaitingRoomHost(room) {
  currentMembers = await getRoomMembers(room.id);
  showScreen('waiting');
  renderWaitingRoomHost(room, window.viblendSession);
  updateMembersList(currentMembers, true);

  // Init WebRTC peer
  const myPeerId = await initPeer(room.id, window.viblendSession.userSessionId, true).catch(e => {
    console.warn('Peer init failed:', e);
    return null;
  });

  // Listen for guest data connections (taste data sharing)
  listenForGuestDataConnections(currentMembers, onAllTasteDataReady);

  // Start realtime
  startRealtime(room.id, {
    onMemberJoined: async (member) => {
      currentMembers = await getRoomMembers(room.id);
      updateMembersList(currentMembers, true);
      animateMemberJoin(member.user_session_id);
      showToast(`${member.display_name} joined the party! 🎉`, 'success', 2000);

      // Check member count
      if (currentMembers.length > CONFIG.MAX_ROOM_MEMBERS) {
        showToast('Party is at maximum capacity (4)', 'warning');
      }
    },
    onMemberUpdated: (member) => {
      const idx = currentMembers.findIndex(m => m.user_session_id === member.user_session_id);
      if (idx >= 0) currentMembers[idx] = member;
      updateMembersList(currentMembers, true);
    },
    onMemberLeft: async () => {
      currentMembers = await getRoomMembers(room.id);
      updateMembersList(currentMembers, true);
    },
  });

  // Wire up waiting room controls
  wireWaitingRoomControls(room);

  // Init audio context (host only)
  await initAudioContext();
}

function wireWaitingRoomControls(room) {
  // Vibe change
  window.addEventListener('viblend:vibe-change', async (e) => {
    await updateVibe(e.detail.vibe);
    showToast(`Vibe changed to ${e.detail.vibe}`, 'info', 1500);
  });

  // Coverage change (debounced)
  recalcDebounced = createRecalculationDebouncer(async (value) => {
    await updateCoverage(value);
    if (currentQueue.length > 0) {
      showToast('Recalculating queue...', 'info', 1000);
      await runAlgorithm();
    }
  }, CONFIG.COVERAGE_DEBOUNCE_MS);

  window.addEventListener('viblend:coverage-change', (e) => {
    recalcDebounced(e.detail.value);
  });

  // Vocal volume
  window.addEventListener('viblend:vocal-change', (e) => {
    updateVocalVolume(e.detail.value);
    vocalRemover.setVocalVolume(e.detail.value);
  });

  // Start party
  document.getElementById('btn-start-party')?.addEventListener('click', async () => {
    if (currentMembers.length < 2) {
      showToast('Invite at least 1 friend to start!', 'warning');
      return;
    }
    showLoading('Blending your music...', 30);
    await runAlgorithm();
    await startParty();
    hideLoading();
    enterNowPlaying();
  });
}

async function onAllTasteDataReady(members) {
  // All guests have shared taste data — enable start button
  const startBtn = document.getElementById('btn-start-party');
  if (startBtn) startBtn.disabled = false;
  showToast('All members ready — tap Start Party!', 'success');

  // Pre-generate queue in background
  await runAlgorithm().catch(e => console.warn('Pre-gen queue error:', e));
}

async function runAlgorithm() {
  const room = getCurrentRoom();
  const session = window.viblendSession;
  if (!room || !session) return;

  const members = window.partyData?.members || [
    { sessionId: session.userSessionId, displayName: session.displayName, platform: session.platform, tasteData: session.tasteData, isHost: true }
  ];

  currentQueue = await generateBlendedQueue({
    members,
    vibe: room.vibe,
    coveragePercent: room.coverage_percent,
    roomId: room.id,
    hostSessionId: session.userSessionId,
    onStatus: (msg) => showToast(msg, 'info', 1500),
  });

  return currentQueue;
}

// ─── Join Party ───────────────────────────────────────────────────────────────

window.addEventListener('viblend:join-party', async (e) => {
  await handleJoinParty(e.detail.code);
});

async function handleJoinParty(code) {
  try {
    showLoading('Joining party...', 20);
    const { room } = await joinParty(code);
    window.currentRoom = room;

    // Ingest taste data in background
    showLoading('Analysing your music taste...', 40);
    if (!window.viblendSession.tasteData) {
      await ingestTasteData((pct, msg) => updateLoadingProgress(40 + pct * 0.5, msg));
    }

    hideLoading();
    await enterWaitingRoomGuest(room);
  } catch (e) {
    hideLoading();
    const msg = e.message === 'ROOM_FULL'     ? 'This party is full — maximum 4 people.'
              : e.message === 'ROOM_NOT_FOUND' ? 'Room not found — check the code and try again.'
              : e.message === 'ROOM_ENDED'     ? 'This party has ended.'
              : 'Could not join party — please check the code.';
    showToast(msg, 'error');
    console.error('Join party error:', e);
  }
}

async function enterWaitingRoomGuest(room) {
  currentMembers = await getRoomMembers(room.id);
  showScreen('waiting');
  renderWaitingRoomGuest(room);
  updateMembersList(currentMembers, false);

  // Connect to host peer
  const myPeerId = await initPeer(room.id, window.viblendSession.userSessionId, false).catch(() => null);

  // Send taste data to host when host peer_id is available
  const hostMember = currentMembers.find(m => m.is_host);
  if (hostMember?.peer_id) {
    setHostPeerId(hostMember.peer_id);
    connectDataChannelToHost(hostMember.peer_id, window.viblendSession.tasteData, window.viblendSession.userSessionId);
  }

  // Update guest status in banner
  const banner = document.getElementById('guest-status-banner');
  if (banner) banner.textContent = 'Ready! Waiting for host to start…';

  // Start realtime
  startRealtime(room.id, {
    onPartyStarted: async () => {
      currentQueue = await getQueue(room.id);
      enterNowPlaying();
    },
    onMemberJoined: async (member) => {
      currentMembers = await getRoomMembers(room.id);
      updateMembersList(currentMembers, false);
    },
    onMemberUpdated: async (member) => {
      // If host peer_id appeared
      if (member.is_host && member.peer_id && !hostMember?.peer_id) {
        setHostPeerId(member.peer_id);
        connectDataChannelToHost(member.peer_id, window.viblendSession.tasteData, window.viblendSession.userSessionId);
      }
      const idx = currentMembers.findIndex(m => m.user_session_id === member.user_session_id);
      if (idx >= 0) currentMembers[idx] = member;
      updateMembersList(currentMembers, false);
    },
    onPartyEnded: () => {
      showScreen('recap');
      renderRecap({ songsPlayed: 0, totalDurationMs: 0, memberCount: currentMembers.length });
    },
    onQueueUpdate: (queue) => { currentQueue = queue; },
    onSongChange: (idx) => {
      const room = getCurrentRoom();
      if (room) room.current_song_index = idx;
      const track = currentQueue[idx];
      if (track) updateNowPlayingTrack(track, idx);
    },
    onVocalVolumeChange: (v) => {
      vocalRemover.setVocalVolume(v);
      const slider = document.getElementById('vocals-mini-slider');
      if (slider) { slider.value = v; updateSliderFill(slider); }
    },
    onKaraokeToggle: (enabled) => { toggleKaraokeUI(enabled); },
    onMicStatusChanged: (member) => {
      currentMembers = currentMembers.map(m => m.user_session_id === member.user_session_id ? member : m);
      updateMicIndicators();
    },
  });
}

// ─── Now Playing ──────────────────────────────────────────────────────────────

async function enterNowPlaying() {
  const room = getCurrentRoom();
  const isHost = isHostSession();

  if (currentQueue.length === 0) {
    currentQueue = await getQueue(room.id).catch(() => []);
  }

  if (currentMembers.length === 0) {
    currentMembers = await getRoomMembers(room.id).catch(() => []);
  }

  const idx = room?.current_song_index ?? 0;
  const track = currentQueue[idx];

  showScreen('nowplaying');

  renderNowPlaying({ track: track || {}, room, members: currentMembers, isHost });
  updateQueuePreview(currentQueue, idx);

  if (isHost && track) {
    // Init player
    await player.init(window.viblendSession.platform, currentQueue, room.id, window.viblendSession.userSessionId);
    player.currentIndex = idx;
    await player.play(track).catch(e => showToast('Playback error: ' + e.message, 'error'));

    // Player state sync
    player.onStateChange(state => {
      updatePlaybackUI(state);
      startLyricSync(() => state.positionMs);
    });

    player.onTrackEnd(() => {
      player.advanceQueue();
    });

    // Vocal removal init
    vocalRemover.setVocalVolume(room?.vocal_volume ?? 100);
  }

  // Wire playback controls
  wireNowPlayingControls(isHost);

  // Fetch lyrics
  if (track) {
    fetchLyrics(track).catch(() => {});
  }

  // Host realtime updates for now-playing screen
  if (isHost) {
    startRealtime(room.id, {
      onMemberJoined: async (member) => {
        currentMembers = await getRoomMembers(room.id);
        renderNowPlaying({ track: currentQueue[room.current_song_index], room, members: currentMembers, isHost });
      },
      onMemberUpdated: (member) => {
        currentMembers = currentMembers.map(m => m.user_session_id === member.user_session_id ? member : m);
        updateMicIndicators();
      },
      onMemberPeerIdUpdated: async (member) => {
        // New guest connected — initiate WebRTC audio call if mic is active
        showToast(`${member.display_name} connected!`, 'info', 1500);
      },
      onVibeChange: async (vibe) => {
        document.body.style.animation = 'vibe-flash 0.5s ease';
        setTimeout(() => document.body.style.animation = '', 500);
        await runAlgorithm();
        showToast(`Vibe: ${vibe}`, 'info', 1500);
      },
      onCoverageChange: async () => {
        recalcDebounced?.(getCurrentRoom()?.coverage_percent);
      },
      onVocalVolumeChange: (v) => {
        vocalRemover.setVocalVolume(v);
      },
      onQueueUpdate: (queue) => {
        currentQueue = queue;
        updateQueuePreview(queue, room.current_song_index);
        showToast('Queue updated ✓', 'success', 2000);
      },
      onSongChange: (idx) => {
        if (!isHost) updateNowPlayingTrack(currentQueue[idx], idx);
      },
      onPartyEnded: enterRecap,
    });
  }
}

function wireNowPlayingControls(isHost) {
  // Play/pause
  document.getElementById('btn-play-pause')?.addEventListener('click', async () => {
    const state = player.getState();
    if (state.isPlaying) await player.pause();
    else await player.resume();
  });

  // Prev / Next
  document.getElementById('btn-prev')?.addEventListener('click', () => player.previousTrack());
  document.getElementById('btn-next')?.addEventListener('click', () => player.advanceQueue());

  // Seek
  window.addEventListener('viblend:seek', (e) => {
    const state = player.getState();
    player.seek(e.detail.fraction * state.durationMs);
  });

  // Vocal change
  window.addEventListener('viblend:vocal-change', (e) => {
    vocalRemover.setVocalVolume(e.detail.value);
    updateVocalVolume(e.detail.value);
  });

  // Mic FAB
  document.getElementById('mic-fab')?.addEventListener('click', async () => {
    const room = getCurrentRoom();
    if (!micActive) {
      try {
        await activateMic(room.id, window.viblendSession.userSessionId);
        micActive = true;
        updateMicButton(true);
      } catch (e) {
        if (e.message !== 'mic-denied') showToast('Microphone unavailable', 'error');
      }
    } else {
      await deactivateMic(room.id, window.viblendSession.userSessionId);
      micActive = false;
      updateMicButton(false);
    }
  });

  // Lyrics button
  document.getElementById('btn-lyrics')?.addEventListener('click', () => {
    const track = currentQueue[getCurrentRoom()?.current_song_index ?? 0];
    openLyricsPanel(track);
  });

  // Karaoke button
  document.getElementById('btn-karaoke')?.addEventListener('click', () => {
    openKaraokePanel(isHostSession(), currentMembers);
  });

  document.getElementById('karaoke-close')?.addEventListener('click', closeKaraokePanel);
  document.getElementById('lyrics-close')?.addEventListener('click', closeLyricsPanel);

  // Mic volume (host)
  window.addEventListener('viblend:mic-volume', (e) => {
    const { sessionId, volume } = e.detail;
    // Find peer ID for this session
    const member = currentMembers.find(m => m.user_session_id === sessionId);
    if (member?.peer_id) setGuestMicVolume(member.peer_id, volume, getCurrentRoom()?.id, sessionId);
  });

  window.addEventListener('viblend:mic-mute', (e) => {
    const { sessionId, muted } = e.detail;
    const member = currentMembers.find(m => m.user_session_id === sessionId);
    if (member?.peer_id) setGuestMicVolume(member.peer_id, muted ? 0 : 1, null, null);
  });

  // Global volume sliders
  document.getElementById('master-mic-volume')?.addEventListener('input', (e) => {
    setMasterMicVolume(parseInt(e.target.value) / 100);
    updateSliderFill(e.target);
  });

  document.getElementById('master-music-volume')?.addEventListener('input', (e) => {
    setMasterMusicVolume(parseInt(e.target.value) / 100);
    updateSliderFill(e.target);
  });

  // Karaoke toggle
  document.getElementById('karaoke-toggle')?.addEventListener('change', async (e) => {
    await toggleKaraoke(e.target.checked);
    toggleKaraokeUI(e.target.checked);
  });

  // Nav buttons
  document.getElementById('nav-nowplaying')?.addEventListener('click', () => showScreen('nowplaying'));
  document.getElementById('nav-queue')?.addEventListener('click', () => {
    const room = getCurrentRoom();
    renderQueueScreen(currentQueue, room?.current_song_index ?? 0, room?.vibe, room?.coverage_percent, isHostSession());
    showScreen('queue');
  });

  // Refresh queue
  document.getElementById('btn-refresh-queue')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh-queue');
    btn?.classList.add('spinning');
    await runAlgorithm();
    const room = getCurrentRoom();
    renderQueueScreen(currentQueue, room?.current_song_index ?? 0, room?.vibe, room?.coverage_percent, isHostSession());
    setTimeout(() => btn?.classList.remove('spinning'), 600);
    showToast('Queue refreshed', 'success', 1500);
  });

  // Remove queue item
  window.addEventListener('viblend:remove-queue-item', async (e) => {
    const { id } = e.detail;
    const { removeQueueItem } = await import('./supabase.js');
    await removeQueueItem(id).catch(() => {});
    currentQueue = currentQueue.filter(t => t.id !== id);
    const room = getCurrentRoom();
    renderQueueScreen(currentQueue, room?.current_song_index ?? 0, room?.vibe, room?.coverage_percent, true);
  });
}

function updateNowPlayingTrack(track, idx) {
  if (!track) return;
  const room = getCurrentRoom();
  renderNowPlaying({ track, room, members: currentMembers, isHost: isHostSession() });
  updateQueuePreview(currentQueue, idx);
  clearLyrics();
  fetchLyrics(track).catch(() => {});
}

function updateMicIndicators() {
  const fab = document.getElementById('mic-fab');
  const othersActive = currentMembers.some(m => m.is_mic_active && m.user_session_id !== window.viblendSession?.userSessionId);
  if (fab) {
    fab.classList.toggle('others-active', othersActive && !micActive);
  }
}

function toggleKaraokeUI(enabled) {
  // Show/hide karaoke controls
  const karaokeSection = document.getElementById('karaoke-section');
  if (karaokeSection) karaokeSection.style.display = enabled ? 'block' : 'none';
  showToast(enabled ? 'Karaoke mode on 🎤' : 'Karaoke mode off', 'info', 1500);
}

// ─── Recap ────────────────────────────────────────────────────────────────────

async function enterRecap() {
  stopRealtime();
  clearLyrics();
  stopLyricSync();
  player.destroy();

  const stats = await buildRecapStats(currentQueue, currentMembers);
  showScreen('recap');
  renderRecap(stats);

  document.getElementById('btn-new-party')?.addEventListener('click', () => {
    leaveParty().then(() => {
      showScreen('home');
      renderHome(window.viblendSession);
    });
  });

  document.getElementById('btn-done')?.addEventListener('click', () => {
    leaveParty().then(() => {
      showScreen('home');
      renderHome(window.viblendSession);
    });
  });

  document.getElementById('btn-share-ig')?.addEventListener('click', () => {
    const canvas = document.getElementById('share-canvas');
    if (!canvas) return;
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'viblend-party.png'; a.click();
      URL.revokeObjectURL(url);
    });
  });
}

// ─── Global error wiring ──────────────────────────────────────────────────────

function bindGlobalEvents() {
  window.addEventListener('viblend:webrtc-error', () => {
    showToast('Connection issue — retrying…', 'warning');
    setTimeout(async () => {
      const room = getCurrentRoom();
      if (room) {
        await initPeer(room.id, window.viblendSession.userSessionId, isHostSession()).catch(() => {});
      }
    }, 3000);
  });

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    leaveParty().catch(() => {});
    clearSession();
  });

  // Settings button
  document.getElementById('btn-settings')?.addEventListener('click', () => {
    showToast('Settings coming soon', 'info', 1500);
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', boot);
