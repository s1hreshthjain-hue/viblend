// js/realtime.js — All Supabase real-time subscriptions and event routing

import { subscribeToRoom, getQueue } from './supabase.js';
import { getCurrentRoom } from './room.js';

let unsubscribe = null;
const handlers = {};

// ─── Subscribe ────────────────────────────────────────────────────────────────

export function startRealtime(roomId, roomHandlers) {
  Object.assign(handlers, roomHandlers);

  unsubscribe = subscribeToRoom(roomId, {
    onRoomUpdate: handleRoomUpdate,
    onMemberJoined: handleMemberJoined,
    onMemberUpdated: handleMemberUpdated,
    onMemberLeft: handleMemberLeft,
    onSignal: handleSignal,
  });
}

export function stopRealtime() {
  unsubscribe?.();
  unsubscribe = null;
}

// ─── Room Updates ─────────────────────────────────────────────────────────────

async function handleRoomUpdate(newRoom) {
  const prev = getCurrentRoom();

  // Song changed
  if (prev && newRoom.current_song_index !== prev.current_song_index) {
    handlers.onSongChange?.(newRoom.current_song_index);
    // Sync local room state
    if (prev) prev.current_song_index = newRoom.current_song_index;
  }

  // Vibe changed
  if (prev && newRoom.vibe !== prev.vibe) {
    handlers.onVibeChange?.(newRoom.vibe);
    if (prev) prev.vibe = newRoom.vibe;
  }

  // Coverage changed
  if (prev && newRoom.coverage_percent !== prev.coverage_percent) {
    handlers.onCoverageChange?.(newRoom.coverage_percent);
    if (prev) prev.coverage_percent = newRoom.coverage_percent;
  }

  // Vocal volume changed
  if (prev && newRoom.vocal_volume !== prev.vocal_volume) {
    handlers.onVocalVolumeChange?.(newRoom.vocal_volume);
    if (prev) prev.vocal_volume = newRoom.vocal_volume;
  }

  // Karaoke toggled
  if (prev && newRoom.karaoke_enabled !== prev.karaoke_enabled) {
    handlers.onKaraokeToggle?.(newRoom.karaoke_enabled);
    if (prev) prev.karaoke_enabled = newRoom.karaoke_enabled;
  }

  // Party ended
  if (newRoom.status === 'ended' && prev?.status !== 'ended') {
    handlers.onPartyEnded?.();
  }

  // Party started
  if (newRoom.status === 'playing' && prev?.status === 'waiting') {
    handlers.onPartyStarted?.();
  }

  handlers.onRoomUpdate?.(newRoom);
}

// ─── Member Events ────────────────────────────────────────────────────────────

function handleMemberJoined(member) {
  handlers.onMemberJoined?.(member);
}

function handleMemberUpdated(member) {
  const session = window.viblendSession;

  // Another member's peer_id updated → host should initiate WebRTC
  if (member.peer_id && member.user_session_id !== session?.userSessionId) {
    handlers.onMemberPeerIdUpdated?.(member);
  }

  // Mic status changed
  handlers.onMicStatusChanged?.(member);

  handlers.onMemberUpdated?.(member);
}

function handleMemberLeft(member) {
  handlers.onMemberLeft?.(member);
}

// ─── Signal Events ────────────────────────────────────────────────────────────

async function handleSignal(signal) {
  const mySessionId = window.viblendSession?.userSessionId;

  // Ignore signals not meant for us
  if (signal.to_session_id && signal.to_session_id !== mySessionId) return;

  // Ignore our own signals
  if (signal.from_session_id === mySessionId) return;

  switch (signal.signal_type) {
    case 'queue_update': {
      try {
        const queue = await getQueue(signal.room_id);
        handlers.onQueueUpdate?.(queue);
      } catch (e) {
        console.error('Queue fetch error:', e);
      }
      break;
    }

    case 'song_change': {
      handlers.onSongChange?.(signal.payload?.songIndex);
      break;
    }

    case 'vibe_change': {
      handlers.onVibeChange?.(signal.payload?.vibe);
      break;
    }

    case 'coverage_change': {
      handlers.onCoverageChange?.(signal.payload?.coveragePercent);
      break;
    }

    case 'karaoke_toggle': {
      handlers.onKaraokeToggle?.(signal.payload?.enabled);
      break;
    }

    case 'member_event': {
      handlers.onMemberEvent?.(signal.payload);
      break;
    }

    default:
      handlers.onSignal?.(signal);
  }
}
