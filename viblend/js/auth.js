// js/auth.js — Platform OAuth flows: Spotify PKCE, Apple MusicKit, YouTube GIS

import CONFIG from './config.js';

// ─── Shared Session ───────────────────────────────────────────────────────────

function initSession(overrides = {}) {
  if (!window.viblendSession) {
    window.viblendSession = {
      platform: null,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      userId: null,
      displayName: null,
      avatarUrl: null,
      userSessionId: crypto.randomUUID(),
      tasteData: null,
    };
  }
  Object.assign(window.viblendSession, overrides);
  sessionStorage.setItem('viblend_session', JSON.stringify(window.viblendSession));
}

export function loadSession() {
  try {
    const raw = sessionStorage.getItem('viblend_session');
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.accessToken) return null;
    window.viblendSession = s;
    return s;
  } catch { return null; }
}

export function clearSession() {
  sessionStorage.removeItem('viblend_session');
  window.viblendSession = null;
}

function scheduleTokenRefresh(platform, expiresIn) {
  const refreshIn = Math.max((expiresIn - 300) * 1000, 10000);
  setTimeout(async () => {
    try {
      if (platform === 'spotify') await refreshSpotifyToken();
      else if (platform === 'youtube') await refreshYouTubeToken();
    } catch (e) {
      console.error('Token refresh failed:', e);
    }
  }, refreshIn);
}

// ─── Spotify PKCE ─────────────────────────────────────────────────────────────

function base64urlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generatePKCE() {
  const verifier = base64urlEncode(crypto.getRandomValues(new Uint8Array(64)));
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64urlEncode(hash);
  return { verifier, challenge };
}

export async function initiateSpotifyAuth() {
  const { verifier, challenge } = await generatePKCE();
  const state = crypto.randomUUID();
  sessionStorage.setItem('spotify_code_verifier', verifier);
  sessionStorage.setItem('spotify_state', state);

  const params = new URLSearchParams({
    client_id: CONFIG.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: CONFIG.SPOTIFY_REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: [
      'user-read-private', 'user-read-email',
      'user-top-read', 'user-read-recently-played',
      'user-library-read', 'streaming',
      'user-modify-playback-state', 'user-read-playback-state',
    ].join(' '),
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

export async function handleSpotifyCallback(code, returnedState) {
  const verifier = sessionStorage.getItem('spotify_code_verifier');
  const expectedState = sessionStorage.getItem('spotify_state');
  if (returnedState !== expectedState) throw new Error('State mismatch');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: CONFIG.SPOTIFY_REDIRECT_URI,
      client_id: CONFIG.SPOTIFY_CLIENT_ID,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) throw new Error('Spotify token exchange failed');
  const tokens = await res.json();

  const profile = await spotifyFetch('/me', tokens.access_token);
  initSession({
    platform: 'spotify',
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiresAt: Date.now() + tokens.expires_in * 1000,
    userId: profile.id,
    displayName: profile.display_name || profile.id,
    avatarUrl: profile.images?.[0]?.url || null,
  });

  sessionStorage.removeItem('spotify_code_verifier');
  sessionStorage.removeItem('spotify_state');
  scheduleTokenRefresh('spotify', tokens.expires_in);
  return window.viblendSession;
}

export async function refreshSpotifyToken() {
  const session = window.viblendSession;
  if (!session?.refreshToken) throw new Error('No refresh token');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
      client_id: CONFIG.SPOTIFY_CLIENT_ID,
    }),
  });

  if (!res.ok) throw new Error('Spotify refresh failed');
  const tokens = await res.json();
  session.accessToken = tokens.access_token;
  if (tokens.refresh_token) session.refreshToken = tokens.refresh_token;
  session.tokenExpiresAt = Date.now() + tokens.expires_in * 1000;
  sessionStorage.setItem('viblend_session', JSON.stringify(session));
  scheduleTokenRefresh('spotify', tokens.expires_in);
}

export async function spotifyFetch(path, token, retried = false) {
  const t = token || window.viblendSession?.accessToken;
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${t}` },
  });

  if (res.status === 401 && !retried) {
    await refreshSpotifyToken();
    return spotifyFetch(path, window.viblendSession.accessToken, true);
  }
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '1');
    await sleep(retryAfter * 1000);
    return spotifyFetch(path, t, retried);
  }
  if (!res.ok) throw new Error(`Spotify API ${res.status}: ${path}`);
  return res.json();
}

// ─── Apple MusicKit ───────────────────────────────────────────────────────────

export async function initiateAppleAuth() {
  await loadScript('https://js-cdn.music.apple.com/musickit/v3/musickit.js');

  await MusicKit.configure({
    developerToken: CONFIG.APPLE_DEVELOPER_TOKEN,
    app: { name: 'Viblend', build: '1.0.0' },
  });

  const music = MusicKit.getInstance();
  await music.authorize();

  const userToken = music.musicUserToken;
  if (!userToken) throw new Error('Apple Music auth failed — no user token');

  sessionStorage.setItem('apple_music_user_token', userToken);
  initSession({
    platform: 'apple',
    accessToken: userToken,
    refreshToken: null,
    tokenExpiresAt: null,
    userId: 'apple_' + crypto.randomUUID().slice(0, 8),
    displayName: 'Apple Music User',
    avatarUrl: null,
  });

  return window.viblendSession;
}

export function getAppleMusicInstance() {
  return window.MusicKit?.getInstance?.() || null;
}

// ─── YouTube / Google Identity Services ───────────────────────────────────────

let ytTokenClient = null;
let ytTokenResolve = null;
let ytTokenReject = null;
let ytRefreshTimer = null;

export async function initiateYouTubeAuth() {
  await loadScript('https://accounts.google.com/gsi/client');

  return new Promise((resolve, reject) => {
    ytTokenResolve = resolve;
    ytTokenReject = reject;

    ytTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.YOUTUBE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
      callback: (tokenResponse) => handleGoogleToken(tokenResponse),
    });

    ytTokenClient.requestAccessToken();
  });
}

async function handleGoogleToken(tokenResponse) {
  if (tokenResponse.error) {
    ytTokenReject?.(new Error(tokenResponse.error));
    return;
  }

  const token = tokenResponse.access_token;
  const expiresIn = parseInt(tokenResponse.expires_in || '3600');

  // Fetch YouTube profile
  let displayName = 'YouTube User';
  let avatarUrl = null;
  try {
    const profileRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&key=${CONFIG.YOUTUBE_API_KEY}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const profile = await profileRes.json();
    const channel = profile.items?.[0];
    if (channel) {
      displayName = channel.snippet.title;
      avatarUrl = channel.snippet.thumbnails?.default?.url || null;
    }
  } catch { /* non-critical */ }

  initSession({
    platform: 'youtube',
    accessToken: token,
    refreshToken: null,
    tokenExpiresAt: Date.now() + expiresIn * 1000,
    userId: 'yt_' + crypto.randomUUID().slice(0, 8),
    displayName,
    avatarUrl,
  });

  scheduleTokenRefresh('youtube', expiresIn);
  ytTokenResolve?.(window.viblendSession);
}

async function refreshYouTubeToken() {
  if (!ytTokenClient) return;
  return new Promise((resolve, reject) => {
    ytTokenResolve = resolve;
    ytTokenReject = reject;
    ytTokenClient.requestAccessToken({ prompt: '' });
  });
}

export async function youtubeFetch(url, retried = false) {
  const token = window.viblendSession?.accessToken;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401 && !retried) {
    await refreshYouTubeToken();
    return youtubeFetch(url, true);
  }
  if (res.status === 429) {
    await backoff(1000, 4, () => youtubeFetch(url, retried));
    return youtubeFetch(url, retried);
  }
  if (!res.ok) throw new Error(`YouTube API ${res.status}`);
  return res.json();
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function backoff(baseMs, maxRetries, fn) {
  for (let i = 0; i < maxRetries; i++) {
    await sleep(baseMs * Math.pow(2, i));
    try { return await fn(); } catch (e) {
      if (i === maxRetries - 1) throw e;
    }
  }
}

export { sleep, backoff, loadScript };
