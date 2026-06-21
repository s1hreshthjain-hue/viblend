// js/karaoke.js — WebRTC mic system and Web Audio mixer

import CONFIG from './config.js';
import { updateMemberMicStatus, updateMemberMicVolume, updateMemberPeerId } from './supabase.js';

// ─── Audio Context (singleton) ────────────────────────────────────────────────

let audioCtx = null;
let masterGain = null;
let musicGain = null;
export let reverbBuffer = null;

export const activeMics = {}; // peerId → { nodes, sessionId }

export function getAudioContext() { return audioCtx; }
export function getMasterGain() { return masterGain; }
export function getMusicGain() { return musicGain; }

export async function initAudioContext() {
  if (audioCtx) return audioCtx;

  audioCtx = new AudioContext({ latencyHint: 'interactive', sampleRate: CONFIG.SAMPLE_RATE });
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 1.0;
  masterGain.connect(audioCtx.destination);

  musicGain = audioCtx.createGain();
  musicGain.gain.value = CONFIG.MUSIC_GAIN_DEFAULT;
  musicGain.connect(masterGain);

  // Resume on any user gesture
  const resumeCtx = async () => {
    if (audioCtx.state === 'suspended') await audioCtx.resume();
  };
  document.addEventListener('click', resumeCtx, { passive: true });
  document.addEventListener('touchend', resumeCtx, { passive: true });

  await buildReverbBuffer();
  window.viblendAudioCtx = audioCtx;
  return audioCtx;
}

async function buildReverbBuffer() {
  if (!audioCtx) return;
  const duration = 1.2;
  const decay = 2.5;
  const length = audioCtx.sampleRate * duration;
  const buffer = audioCtx.createBuffer(2, length, audioCtx.sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  reverbBuffer = buffer;
}

// ─── PeerJS Setup ─────────────────────────────────────────────────────────────

let peer = null;
let hostPeerId = null;
let micStream = null;
let hostMicNodes = null;
let isHost = false;

export async function initPeer(roomId, sessionId, _isHost) {
  isHost = _isHost;

  if (typeof Peer === 'undefined') {
    await loadScript('https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js');
  }

  peer = new Peer(undefined, {
    host: '0.peerjs.com',
    port: 443,
    secure: true,
    debug: 0,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
      ],
      sdpSemantics: 'unified-plan',
      iceCandidatePoolSize: 10,
    },
  });

  return new Promise((resolve, reject) => {
    peer.on('open', async (id) => {
      await updateMemberPeerId(sessionId, roomId, id).catch(() => {});
      resolve(id);
    });

    peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      window.dispatchEvent(new CustomEvent('viblend:webrtc-error', { detail: err }));
    });

    // Host receives audio calls from guests
    if (isHost) {
      peer.on('call', call => {
        const silentStream = audioCtx?.createMediaStreamDestination().stream;
        call.answer(silentStream);
        call.on('stream', remoteStream => {
          processGuestMic(remoteStream, call.peer, call.metadata?.sessionId);
        });
        call.on('close', () => cleanupGuestMic(call.peer));
        call.on('error', () => cleanupGuestMic(call.peer));
      });
    }

    setTimeout(() => reject(new Error('PeerJS open timeout')), 15000);
  });
}

export function getPeer() { return peer; }
export function getHostPeerId() { return hostPeerId; }
export function setHostPeerId(id) { hostPeerId = id; }

// ─── Guest: Activate Mic ──────────────────────────────────────────────────────

export async function activateMic(roomId, sessionId) {
  if (micStream) return micStream; // already active

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        latency: 0,
        channelCount: 1,
        sampleRate: CONFIG.SAMPLE_RATE,
        sampleSize: 16,
      },
    });

    await updateMemberMicStatus(sessionId, roomId, true).catch(() => {});

    if (isHost) {
      // Host: route directly into audio graph (no WebRTC)
      await ensureAudioCtx();
      hostMicNodes = processGuestMic(micStream, 'host-local', sessionId);
    } else {
      // Guest: call host via WebRTC
      if (!peer || !hostPeerId) throw new Error('No host peer connection');
      const call = peer.call(hostPeerId, micStream, { metadata: { type: 'mic', sessionId } });
      call.on('error', err => console.error('Mic call error:', err));
    }

    // Duck music
    duckMusic(true);
    return micStream;

  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      window.dispatchEvent(new CustomEvent('viblend:mic-denied'));
    }
    throw err;
  }
}

export async function deactivateMic(roomId, sessionId) {
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }

  if (isHost && hostMicNodes) {
    cleanupMicNodes(hostMicNodes);
    hostMicNodes = null;
  }

  await updateMemberMicStatus(sessionId, roomId, false).catch(() => {});

  // Un-duck music if no other mics active
  const anyMicActive = Object.keys(activeMics).length > 0;
  if (!anyMicActive) duckMusic(false);
}

// ─── Voice Processing Chain ───────────────────────────────────────────────────

function processGuestMic(stream, peerId, sessionId) {
  if (!audioCtx) return null;
  const nodes = {};

  nodes.source = audioCtx.createMediaStreamSource(stream);

  nodes.dcFilter = audioCtx.createBiquadFilter();
  nodes.dcFilter.type = 'highpass';
  nodes.dcFilter.frequency.value = 30;

  nodes.highPass = audioCtx.createBiquadFilter();
  nodes.highPass.type = 'highpass';
  nodes.highPass.frequency.value = 100;
  nodes.highPass.Q.value = 0.7;

  nodes.presence = audioCtx.createBiquadFilter();
  nodes.presence.type = 'peaking';
  nodes.presence.frequency.value = 3500;
  nodes.presence.gain.value = 4;
  nodes.presence.Q.value = 1.5;

  nodes.compressor = audioCtx.createDynamicsCompressor();
  nodes.compressor.threshold.value = -18;
  nodes.compressor.knee.value = 20;
  nodes.compressor.ratio.value = 8;
  nodes.compressor.attack.value = 0.002;
  nodes.compressor.release.value = 0.15;

  nodes.limiter = audioCtx.createDynamicsCompressor();
  nodes.limiter.threshold.value = -1.5;
  nodes.limiter.knee.value = 0;
  nodes.limiter.ratio.value = 20;
  nodes.limiter.attack.value = 0.001;
  nodes.limiter.release.value = 0.05;

  nodes.reverb = audioCtx.createConvolver();
  if (reverbBuffer) nodes.reverb.buffer = reverbBuffer;

  nodes.dryGain = audioCtx.createGain();
  nodes.dryGain.gain.value = 0.75;

  nodes.wetGain = audioCtx.createGain();
  nodes.wetGain.gain.value = 0.25;

  nodes.micVolume = audioCtx.createGain();
  nodes.micVolume.gain.value = 1.0;

  // Analyser for VU meter
  nodes.analyser = audioCtx.createAnalyser();
  nodes.analyser.fftSize = 256;

  // Wire the chain
  nodes.source.connect(nodes.dcFilter);
  nodes.dcFilter.connect(nodes.highPass);
  nodes.highPass.connect(nodes.presence);
  nodes.presence.connect(nodes.compressor);
  nodes.compressor.connect(nodes.limiter);
  nodes.limiter.connect(nodes.dryGain);
  nodes.limiter.connect(nodes.reverb);
  nodes.reverb.connect(nodes.wetGain);
  nodes.dryGain.connect(nodes.micVolume);
  nodes.wetGain.connect(nodes.micVolume);
  nodes.micVolume.connect(masterGain);

  nodes.source.connect(nodes.analyser);

  activeMics[peerId] = { nodes, sessionId };

  // Start VU meter animation
  startVUMeter(peerId, nodes.analyser);

  // Duck music when a new mic goes active
  duckMusic(true);

  return nodes;
}

function cleanupGuestMic(peerId) {
  const mic = activeMics[peerId];
  if (!mic) return;
  cleanupMicNodes(mic.nodes);
  delete activeMics[peerId];

  const anyMicActive = Object.keys(activeMics).length > 0;
  if (!anyMicActive) duckMusic(false);
}

function cleanupMicNodes(nodes) {
  Object.values(nodes).forEach(node => {
    try { node.disconnect(); } catch { /* already disconnected */ }
  });
}

// ─── Music Ducking ────────────────────────────────────────────────────────────

function duckMusic(duck) {
  if (!musicGain) return;
  const target = duck ? CONFIG.MUSIC_GAIN_DUCKED : CONFIG.MUSIC_GAIN_DEFAULT;
  const duration = duck ? CONFIG.DUCK_TIME_MS / 1000 : CONFIG.UNDUCK_TIME_MS / 1000;
  musicGain.gain.cancelScheduledValues(audioCtx.currentTime);
  musicGain.gain.linearRampToValueAtTime(target, audioCtx.currentTime + duration);
}

// ─── VU Meter ─────────────────────────────────────────────────────────────────

const vuAnimationFrames = {};

function startVUMeter(peerId, analyser) {
  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  function draw() {
    if (!activeMics[peerId] && peerId !== 'host-local') return;
    analyser.getByteFrequencyData(dataArray);
    const level = dataArray.reduce((a, b) => a + b, 0) / dataArray.length / 255;
    window.dispatchEvent(new CustomEvent('viblend:vu-update', { detail: { peerId, level } }));
    vuAnimationFrames[peerId] = requestAnimationFrame(draw);
  }
  draw();
}

export function stopVUMeter(peerId) {
  if (vuAnimationFrames[peerId]) {
    cancelAnimationFrame(vuAnimationFrames[peerId]);
    delete vuAnimationFrames[peerId];
  }
}

// ─── Host: Per-Member Volume Control ─────────────────────────────────────────

export function setGuestMicVolume(peerId, volume, roomId, sessionId) {
  const mic = activeMics[peerId];
  if (!mic?.nodes?.micVolume) return;
  mic.nodes.micVolume.gain.value = Math.max(0, Math.min(1, volume));
  updateMemberMicVolume(sessionId, roomId, volume).catch(() => {});
}

export function muteGuestMic(peerId) {
  setGuestMicVolume(peerId, 0, null, null);
}

export function setMasterMicVolume(volume) {
  Object.values(activeMics).forEach(({ nodes }) => {
    if (nodes.micVolume) nodes.micVolume.gain.value = volume;
  });
}

export function setMasterMusicVolume(volume) {
  if (!musicGain) return;
  musicGain.gain.cancelScheduledValues(audioCtx.currentTime);
  musicGain.gain.setValueAtTime(volume, audioCtx.currentTime);
}

// ─── Data Channel for Taste Sharing ──────────────────────────────────────────

const dataConnections = {};

export function connectDataChannelToHost(hostPeerId, tasteData, sessionId) {
  if (!peer) return;
  const conn = peer.connect(hostPeerId, { reliable: true });
  dataConnections['host'] = conn;

  conn.on('open', () => {
    // Send taste data in chunks if needed
    const payload = JSON.stringify({
      type: 'TASTE_DATA',
      sessionId,
      tasteData,
    });
    conn.send(payload);
  });

  conn.on('data', (raw) => {
    const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (msg.type === 'QUEUE_READY') {
      window.dispatchEvent(new CustomEvent('viblend:queue-ready'));
    }
  });

  conn.on('error', e => console.error('Data channel error:', e));
}

export function listenForGuestDataConnections(members, onAllReady) {
  if (!peer) return;
  const tasteBySession = {};
  window.partyData = { members: [] };

  peer.on('connection', conn => {
    conn.on('data', (raw) => {
      const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;

      if (msg.type === 'TASTE_DATA') {
        tasteBySession[msg.sessionId] = msg.tasteData;
        window.partyData.members = Object.entries(tasteBySession).map(([sid, td]) => {
          const member = members.find(m => m.user_session_id === sid);
          return { sessionId: sid, displayName: member?.display_name, platform: td?.platform, tasteData: td, isHost: false };
        });

        // Notify all connections that queue is ready (once all data received or timeout)
        const guestCount = members.filter(m => !m.is_host).length;
        if (Object.keys(tasteBySession).length >= guestCount || guestCount === 0) {
          // Add host's own taste data
          const session = window.viblendSession;
          if (session?.tasteData) {
            window.partyData.members.push({
              sessionId: session.userSessionId,
              displayName: session.displayName,
              platform: session.platform,
              tasteData: session.tasteData,
              isHost: true,
            });
          }

          // Broadcast queue ready to all guests
          Object.values(dataConnections).forEach(c => {
            try { c.send(JSON.stringify({ type: 'QUEUE_READY' })); } catch { /* ignore */ }
          });

          onAllReady(window.partyData.members);
        }

        dataConnections[conn.peer] = conn;
      }
    });
  });

  // Timeout fallback — start algorithm with whoever showed up
  setTimeout(() => {
    const session = window.viblendSession;
    if (session?.tasteData && !window.partyData.members.find(m => m.isHost)) {
      window.partyData.members.push({
        sessionId: session.userSessionId,
        displayName: session.displayName,
        platform: session.platform,
        tasteData: session.tasteData,
        isHost: true,
      });
    }
    if (window.partyData.members.length > 0) onAllReady(window.partyData.members);
  }, CONFIG.TASTE_SHARE_TIMEOUT_MS);
}

// ─── Utils ────────────────────────────────────────────────────────────────────

async function ensureAudioCtx() {
  if (!audioCtx) await initAudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}
