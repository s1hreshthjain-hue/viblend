// js/room.js — Room creation, joining, lifecycle, heartbeat

import CONFIG from './config.js';
import {
  createRoom, getRoomByCode, getRoomById,
  joinRoomAsHost, joinRoomAsGuest, updateRoom,
  removeRoomMember, updateMemberHeartbeat, endRoom, getRoomMembers,
} from './supabase.js';

// ─── State ────────────────────────────────────────────────────────────────────

let heartbeatTimer = null;
let currentRoom = null;
let currentMember = null;

export function getCurrentRoom() { return currentRoom; }
export function getCurrentMember() { return currentMember; }
export function isHostSession() { return currentMember?.is_host === true; }

// ─── Create Party (Host) ──────────────────────────────────────────────────────

export async function createParty({ vibe = 'hype', coveragePercent = 75 } = {}) {
  const session = window.viblendSession;
  if (!session) throw new Error('Not authenticated');

  currentRoom = await createRoom({
    hostUserId: session.userId,
    displayName: session.displayName,
    avatarUrl: session.avatarUrl,
    vibe,
    coveragePercent,
  });

  currentMember = await joinRoomAsHost({
    roomId: currentRoom.id,
    userSessionId: session.userSessionId,
    displayName: session.displayName,
    avatarUrl: session.avatarUrl,
    platform: session.platform,
    peerId: null,
  });

  sessionStorage.setItem('viblend_room_id', currentRoom.id);
  sessionStorage.setItem('viblend_is_host', 'true');

  startHeartbeat();
  return { room: currentRoom, member: currentMember };
}

// ─── Join Party (Guest) ───────────────────────────────────────────────────────

export async function joinParty(code) {
  const session = window.viblendSession;
  if (!session) throw new Error('Not authenticated');

  // Validate code format
  if (!code || code.length !== CONFIG.ROOM_CODE_LENGTH) {
    throw new Error('INVALID_CODE');
  }

  currentRoom = await getRoomByCode(code.toUpperCase().trim());
  if (!currentRoom) throw new Error('ROOM_NOT_FOUND');
  if (currentRoom.status === 'ended') throw new Error('ROOM_ENDED');

  // Check member count
  const members = await getRoomMembers(currentRoom.id);
  if (members.length >= CONFIG.MAX_ROOM_MEMBERS) throw new Error('ROOM_FULL');

  currentMember = await joinRoomAsGuest({
    roomId: currentRoom.id,
    userSessionId: session.userSessionId,
    displayName: session.displayName,
    avatarUrl: session.avatarUrl,
    platform: session.platform,
    peerId: null,
  });

  sessionStorage.setItem('viblend_room_id', currentRoom.id);
  sessionStorage.setItem('viblend_is_host', 'false');

  startHeartbeat();
  return { room: currentRoom, member: currentMember };
}

// ─── Restore Session ──────────────────────────────────────────────────────────

export async function restoreRoomSession() {
  const roomId = sessionStorage.getItem('viblend_room_id');
  if (!roomId) return null;

  try {
    currentRoom = await getRoomById(roomId);
    if (!currentRoom || currentRoom.status === 'ended') {
      clearRoomSession();
      return null;
    }
    return currentRoom;
  } catch {
    clearRoomSession();
    return null;
  }
}

// ─── Start Party ──────────────────────────────────────────────────────────────

export async function startParty() {
  if (!currentRoom || !isHostSession()) return;
  await updateRoom(currentRoom.id, { status: 'playing' });
  currentRoom.status = 'playing';
}

// ─── Update Room Settings ─────────────────────────────────────────────────────

export async function updateVibe(vibe) {
  if (!currentRoom || !isHostSession()) return;
  await updateRoom(currentRoom.id, { vibe });
  currentRoom.vibe = vibe;
}

export async function updateCoverage(percent) {
  if (!currentRoom || !isHostSession()) return;
  await updateRoom(currentRoom.id, { coverage_percent: percent });
  currentRoom.coverage_percent = percent;
}

export async function updateVocalVolume(percent) {
  if (!currentRoom) return;
  await updateRoom(currentRoom.id, { vocal_volume: percent });
  currentRoom.vocal_volume = percent;
}

export async function toggleKaraoke(enabled) {
  if (!currentRoom || !isHostSession()) return;
  await updateRoom(currentRoom.id, { karaoke_enabled: enabled });
  currentRoom.karaoke_enabled = enabled;
}

export async function advanceSong(newIndex) {
  if (!currentRoom || !isHostSession()) return;
  await updateRoom(currentRoom.id, { current_song_index: newIndex });
  currentRoom.current_song_index = newIndex;
}

// ─── Leave / End Party ────────────────────────────────────────────────────────

export async function leaveParty() {
  stopHeartbeat();
  const session = window.viblendSession;
  if (currentRoom && session) {
    await removeRoomMember(session.userSessionId, currentRoom.id).catch(() => {});
    if (isHostSession()) {
      await endRoom(currentRoom.id).catch(() => {});
    }
  }
  clearRoomSession();
}

function clearRoomSession() {
  currentRoom = null;
  currentMember = null;
  sessionStorage.removeItem('viblend_room_id');
  sessionStorage.removeItem('viblend_is_host');
}

// ─── Heartbeat ────────────────────────────────────────────────────────────────

function startHeartbeat() {
  stopHeartbeat();
  const session = window.viblendSession;
  if (!session || !currentRoom) return;

  heartbeatTimer = setInterval(async () => {
    await updateMemberHeartbeat(session.userSessionId, currentRoom.id).catch(() => {});
  }, CONFIG.HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ─── Room Code QR ─────────────────────────────────────────────────────────────

export function generateRoomQR(code, containerId, size = 128) {
  const container = document.getElementById(containerId);
  if (!container || typeof QRCode === 'undefined') return;

  container.innerHTML = '';
  new QRCode(container, {
    text: `${CONFIG.APP_URL}/join/${code}`,
    width: size,
    height: size,
    colorDark: '#5B4DDE',
    colorLight: '#0F0E1A',
    correctLevel: QRCode.CorrectLevel.M,
  });
}

export function getRoomShareURL(code) {
  return `${CONFIG.APP_URL}/join/${code}`;
}

export function getRoomWhatsAppURL(code) {
  const url = getRoomShareURL(code);
  const text = encodeURIComponent(`Join my Viblend party! 🎵\nRoom code: ${code}\n${url}`);
  return `https://wa.me/?text=${text}`;
}

// ─── Recap Stats ──────────────────────────────────────────────────────────────

export async function buildRecapStats(queue, members) {
  const played = queue.filter(t => t.played);
  const totalDurationMs = played.reduce((sum, t) => sum + (t.duration_ms || 0), 0);
  const highestCoverage = played.reduce((best, t) =>
    (t.coverage_score || 0) > (best?.coverage_score || 0) ? t : best, null);

  return {
    songsPlayed: played.length,
    totalDurationMs,
    highestCoverageSong: highestCoverage,
    memberCount: members.length,
    members,
  };
}
