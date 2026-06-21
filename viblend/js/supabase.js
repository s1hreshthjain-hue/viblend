// js/supabase.js — Supabase client and all database/realtime operations

import CONFIG from './config.js';

let supabaseClient = null;

function getClient() {
  if (supabaseClient) return supabaseClient;
  if (!window.supabase) throw new Error('Supabase JS not loaded');
  supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return supabaseClient;
}

// ─── Rooms ────────────────────────────────────────────────────────────────────

export async function createRoom({ hostUserId, displayName, avatarUrl, vibe = 'hype', coveragePercent = 75 }) {
  const sb = getClient();
  const code = generateRoomCode();
  const { data, error } = await sb.from('rooms').insert({
    code,
    host_user_id: hostUserId,
    host_display_name: displayName,
    host_avatar_url: avatarUrl,
    vibe,
    coverage_percent: coveragePercent,
    vocal_volume: 100,
    status: 'waiting',
    current_song_index: 0,
    karaoke_enabled: false,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function getRoomByCode(code) {
  const sb = getClient();
  const { data, error } = await sb.from('rooms')
    .select('*').eq('code', code.toUpperCase()).neq('status', 'ended').single();
  if (error) throw error;
  return data;
}

export async function getRoomById(id) {
  const sb = getClient();
  const { data, error } = await sb.from('rooms').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function updateRoom(roomId, updates) {
  const sb = getClient();
  const { data, error } = await sb.from('rooms').update(updates).eq('id', roomId).select().single();
  if (error) throw error;
  return data;
}

export async function endRoom(roomId) {
  const sb = getClient();
  const { error } = await sb.from('rooms').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', roomId);
  if (error) throw error;
}

// ─── Room Members ─────────────────────────────────────────────────────────────

export async function joinRoomAsHost({ roomId, userSessionId, displayName, avatarUrl, platform, peerId }) {
  const sb = getClient();
  const { data, error } = await sb.from('room_members').insert({
    room_id: roomId,
    user_session_id: userSessionId,
    display_name: displayName,
    avatar_url: avatarUrl,
    platform,
    peer_id: peerId || null,
    is_mic_active: false,
    mic_volume: 1.0,
    is_host: true,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function joinRoomAsGuest({ roomId, userSessionId, displayName, avatarUrl, platform, peerId }) {
  const sb = getClient();

  // Check room exists and not full
  const { data: members } = await sb.from('room_members').select('id').eq('room_id', roomId);
  if (members && members.length >= CONFIG.MAX_ROOM_MEMBERS) {
    throw new Error('ROOM_FULL');
  }

  const { data, error } = await sb.from('room_members').insert({
    room_id: roomId,
    user_session_id: userSessionId,
    display_name: displayName,
    avatar_url: avatarUrl,
    platform,
    peer_id: peerId || null,
    is_mic_active: false,
    mic_volume: 1.0,
    is_host: false,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function updateMemberPeerId(userSessionId, roomId, peerId) {
  const sb = getClient();
  const { error } = await sb.from('room_members')
    .update({ peer_id: peerId }).eq('user_session_id', userSessionId).eq('room_id', roomId);
  if (error) throw error;
}

export async function updateMemberMicStatus(userSessionId, roomId, isActive) {
  const sb = getClient();
  const { error } = await sb.from('room_members')
    .update({ is_mic_active: isActive, last_seen_at: new Date().toISOString() })
    .eq('user_session_id', userSessionId).eq('room_id', roomId);
  if (error) throw error;
}

export async function updateMemberMicVolume(userSessionId, roomId, volume) {
  const sb = getClient();
  const { error } = await sb.from('room_members')
    .update({ mic_volume: volume }).eq('user_session_id', userSessionId).eq('room_id', roomId);
  if (error) throw error;
}

export async function updateMemberHeartbeat(userSessionId, roomId) {
  const sb = getClient();
  const { error } = await sb.from('room_members')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('user_session_id', userSessionId).eq('room_id', roomId);
  if (error) console.warn('Heartbeat update failed:', error);
}

export async function removeRoomMember(userSessionId, roomId) {
  const sb = getClient();
  const { error } = await sb.from('room_members')
    .delete().eq('user_session_id', userSessionId).eq('room_id', roomId);
  if (error) throw error;
}

export async function getRoomMembers(roomId) {
  const sb = getClient();
  const { data, error } = await sb.from('room_members').select('*').eq('room_id', roomId).order('joined_at');
  if (error) throw error;
  return data || [];
}

// ─── Room Queue ───────────────────────────────────────────────────────────────

export async function writeQueue(roomId, tracks) {
  const sb = getClient();
  // Delete existing unplayed queue entries
  await sb.from('room_queue').delete().eq('room_id', roomId).eq('played', false);

  const rows = tracks.map((t, i) => ({
    room_id: roomId,
    position: i,
    platform: t.platform,
    track_id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    album_art_url: t.albumArtUrl,
    duration_ms: t.durationMs,
    energy: t.energy,
    valence: t.valence,
    tempo: t.tempo,
    danceability: t.danceability,
    coverage_score: t.coverageScore,
    mood_score: t.moodScore,
    played: false,
  }));

  const { error } = await sb.from('room_queue').insert(rows);
  if (error) throw error;
}

export async function getQueue(roomId) {
  const sb = getClient();
  const { data, error } = await sb.from('room_queue')
    .select('*').eq('room_id', roomId).order('position');
  if (error) throw error;
  return data || [];
}

export async function markSongPlayed(roomId, position) {
  const sb = getClient();
  const { error } = await sb.from('room_queue')
    .update({ played: true }).eq('room_id', roomId).eq('position', position);
  if (error) throw error;
}

export async function updateQueueOrder(roomId, tracks) {
  const sb = getClient();
  const updates = tracks.map((t, i) => sb.from('room_queue').update({ position: i }).eq('id', t.dbId));
  await Promise.all(updates);
}

export async function removeQueueItem(dbId) {
  const sb = getClient();
  const { error } = await sb.from('room_queue').delete().eq('id', dbId);
  if (error) throw error;
}

// ─── Signals ──────────────────────────────────────────────────────────────────

export async function sendSignal({ roomId, fromSessionId, toSessionId = null, signalType, payload }) {
  const sb = getClient();
  const { error } = await sb.from('room_signals').insert({
    room_id: roomId,
    from_session_id: fromSessionId,
    to_session_id: toSessionId,
    signal_type: signalType,
    payload,
  });
  if (error) console.error('Signal send error:', error);
}

// ─── Realtime Subscriptions ───────────────────────────────────────────────────

export function subscribeToRoom(roomId, callbacks) {
  const sb = getClient();
  const channels = [];

  // Channel 1: rooms table
  const roomChannel = sb.channel(`room:${roomId}`)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}`
    }, (payload) => callbacks.onRoomUpdate?.(payload.new))
    .subscribe();
  channels.push(roomChannel);

  // Channel 2: room_members table
  const membersChannel = sb.channel(`members:${roomId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}`
    }, (payload) => callbacks.onMemberJoined?.(payload.new))
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}`
    }, (payload) => callbacks.onMemberUpdated?.(payload.new))
    .on('postgres_changes', {
      event: 'DELETE', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}`
    }, (payload) => callbacks.onMemberLeft?.(payload.old))
    .subscribe();
  channels.push(membersChannel);

  // Channel 3: room_signals table
  const signalsChannel = sb.channel(`signals:${roomId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'room_signals', filter: `room_id=eq.${roomId}`
    }, (payload) => callbacks.onSignal?.(payload.new))
    .subscribe();
  channels.push(signalsChannel);

  return () => channels.forEach(ch => sb.removeChannel(ch));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0, I/1 ambiguity
  let code = '';
  for (let i = 0; i < CONFIG.ROOM_CODE_LENGTH; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export { getClient as getSupabase };
