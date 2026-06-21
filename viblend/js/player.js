// js/player.js — Unified cross-platform music player

import CONFIG from './config.js';
import { updateRoom, markSongPlayed } from './supabase.js';
import { loadScript } from './auth.js';

// ─── Unified Player Interface ─────────────────────────────────────────────────

class ViblendPlayer {
  constructor() {
    this.platform = null;
    this._impl = null;
    this._onTrackEndCallbacks = [];
    this._onStateChangeCallbacks = [];
    this._stateInterval = null;
    this.currentQueue = [];
    this.currentIndex = 0;
    this.roomId = null;
    this.sessionId = null;
  }

  async init(platform, queue, roomId, sessionId) {
    this.platform = platform;
    this.currentQueue = queue;
    this.roomId = roomId;
    this.sessionId = sessionId;

    if (platform === 'spotify') this._impl = new SpotifyPlayerImpl(this);
    else if (platform === 'apple') this._impl = new ApplePlayerImpl(this);
    else if (platform === 'youtube') this._impl = new YouTubePlayerImpl(this);
    else throw new Error(`Unknown platform: ${platform}`);

    await this._impl.init();
    this._startStatePolling();
  }

  async play(track) {
    if (!this._impl) throw new Error('Player not initialised');
    await this._impl.play(track);
  }

  async pause() { await this._impl?.pause(); }
  async resume() { await this._impl?.resume(); }
  async seek(positionMs) { await this._impl?.seek(positionMs); }

  setVolume(level) { this._impl?.setVolume(Math.max(0, Math.min(1, level))); }

  getState() {
    return this._impl?.getState() || { isPlaying: false, positionMs: 0, durationMs: 0 };
  }

  onTrackEnd(cb) { this._onTrackEndCallbacks.push(cb); }
  onStateChange(cb) { this._onStateChangeCallbacks.push(cb); }

  _fireTrackEnd() {
    this._onTrackEndCallbacks.forEach(cb => cb());
  }

  _fireStateChange(state) {
    this._onStateChangeCallbacks.forEach(cb => cb(state));
  }

  _startStatePolling() {
    clearInterval(this._stateInterval);
    this._stateInterval = setInterval(() => {
      this._fireStateChange(this.getState());
    }, 500);
  }

  async advanceQueue() {
    if (this.currentIndex >= this.currentQueue.length - 1) return;

    await markSongPlayed(this.roomId, this.currentIndex).catch(() => {});
    this.currentIndex++;

    await updateRoom(this.roomId, { current_song_index: this.currentIndex });

    const nextTrack = this.currentQueue[this.currentIndex];
    if (nextTrack) await this.play(nextTrack);
  }

  async previousTrack() {
    const state = this.getState();
    if (state.positionMs > 3000) {
      await this.seek(0);
      return;
    }
    if (this.currentIndex > 0) {
      this.currentIndex--;
      await updateRoom(this.roomId, { current_song_index: this.currentIndex });
      await this.play(this.currentQueue[this.currentIndex]);
    }
  }

  destroy() {
    clearInterval(this._stateInterval);
    this._impl?.destroy?.();
  }
}

// ─── Spotify Implementation ───────────────────────────────────────────────────

class SpotifyPlayerImpl {
  constructor(parent) {
    this.parent = parent;
    this.player = null;
    this.deviceId = null;
    this._state = { isPlaying: false, positionMs: 0, durationMs: 0 };
  }

  async init() {
    await loadScript('https://sdk.scdn.co/spotify-player.js');

    return new Promise((resolve, reject) => {
      window.onSpotifyWebPlaybackSDKReady = () => {
        this.player = new Spotify.Player({
          name: 'Viblend',
          getOAuthToken: cb => cb(window.viblendSession.accessToken),
          volume: 0.8,
        });

        this.player.addListener('ready', ({ device_id }) => {
          this.deviceId = device_id;
          window.spotifyDeviceId = device_id;
          resolve();
        });

        this.player.addListener('not_ready', () => {
          console.warn('Spotify player not ready');
        });

        this.player.addListener('player_state_changed', state => {
          if (!state) return;
          this._state = {
            isPlaying: !state.paused,
            positionMs: state.position,
            durationMs: state.duration,
          };

          // Detect track end
          if (state.position === 0 && state.paused) {
            const prevTracks = state.track_window.previous_tracks;
            const current = state.track_window.current_track;
            if (prevTracks.some(t => t.id === current.id)) {
              this.parent._fireTrackEnd();
              this.parent.advanceQueue();
            }
          }
        });

        this.player.addListener('initialization_error', ({ message }) => reject(new Error(message)));
        this.player.addListener('authentication_error', ({ message }) => reject(new Error(message)));
        this.player.addListener('account_error', ({ message }) => {
          window.dispatchEvent(new CustomEvent('viblend:error', {
            detail: { type: 'SPOTIFY_PREMIUM_REQUIRED', message }
          }));
        });

        this.player.connect();
      };

      if (window.Spotify) window.onSpotifyWebPlaybackSDKReady();
    });
  }

  async play(track) {
    if (!this.deviceId) throw new Error('No Spotify device ready');
    const token = window.viblendSession.accessToken;
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [`spotify:track:${track.resolvedTrackId || track.id}`] }),
    });
  }

  async pause() { await this.player?.pause(); }
  async resume() { await this.player?.resume(); }
  async seek(positionMs) { await this.player?.seek(positionMs); }
  setVolume(level) { this.player?.setVolume(level); }
  getState() { return { ...this._state }; }
  destroy() { this.player?.disconnect(); }
}

// ─── Apple Music Implementation ───────────────────────────────────────────────

class ApplePlayerImpl {
  constructor(parent) {
    this.parent = parent;
    this.music = null;
    this._state = { isPlaying: false, positionMs: 0, durationMs: 0 };
  }

  async init() {
    this.music = window.MusicKit?.getInstance?.();
    if (!this.music) throw new Error('MusicKit not available');

    this.music.addEventListener('playbackStateDidChange', ({ state }) => {
      this._state = {
        isPlaying: state === MusicKit.PlaybackStates.playing,
        positionMs: (this.music.currentPlaybackTime || 0) * 1000,
        durationMs: (this.music.currentPlaybackDuration || 0) * 1000,
      };
      if (state === MusicKit.PlaybackStates.ended) {
        this.parent._fireTrackEnd();
        this.parent.advanceQueue();
      }
    });
  }

  async play(track) {
    await this.music.setQueue({ song: track.resolvedTrackId || track.id });
    await this.music.play();
  }

  async pause() { await this.music.pause(); }
  async resume() { await this.music.play(); }
  async seek(positionMs) { this.music.seekToTime(positionMs / 1000); }
  setVolume(level) { this.music.volume = level; }
  getState() { return { ...this._state }; }
  destroy() { this.music.stop(); }
}

// ─── YouTube Implementation ───────────────────────────────────────────────────

class YouTubePlayerImpl {
  constructor(parent) {
    this.parent = parent;
    this.player = null;
    this._state = { isPlaying: false, positionMs: 0, durationMs: 0 };
    this._pollInterval = null;
  }

  async init() {
    await loadScript('https://www.youtube.com/iframe_api');

    return new Promise((resolve) => {
      const existing = document.getElementById('yt-player-hidden');
      if (existing) existing.remove();

      const div = document.createElement('div');
      div.id = 'yt-player-hidden';
      div.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;';
      document.body.appendChild(div);

      const createPlayer = () => {
        this.player = new YT.Player('yt-player-hidden', {
          height: '1', width: '1',
          playerVars: { autoplay: 0, controls: 0, rel: 0 },
          events: {
            onReady: () => {
              this._startPolling();
              resolve();
            },
            onStateChange: (event) => {
              this._state.isPlaying = event.data === YT.PlayerState.PLAYING;
              if (event.data === YT.PlayerState.ENDED) {
                this.parent._fireTrackEnd();
                this.parent.advanceQueue();
              }
            },
            onError: (e) => console.error('YT player error:', e.data),
          },
        });
      };

      if (window.YT?.Player) createPlayer();
      else window.onYouTubeIframeAPIReady = createPlayer;
    });
  }

  _startPolling() {
    clearInterval(this._pollInterval);
    this._pollInterval = setInterval(() => {
      if (!this.player) return;
      try {
        this._state = {
          isPlaying: this.player.getPlayerState() === YT.PlayerState.PLAYING,
          positionMs: (this.player.getCurrentTime?.() || 0) * 1000,
          durationMs: (this.player.getDuration?.() || 0) * 1000,
        };
      } catch { /* YT player not ready */ }
    }, 500);
  }

  async play(track) {
    const videoId = track.resolvedTrackId || track.id;
    this.player.loadVideoById(videoId);
    this.player.playVideo();
  }

  async pause() { this.player?.pauseVideo(); }
  async resume() { this.player?.playVideo(); }
  async seek(positionMs) { this.player?.seekTo(positionMs / 1000, true); }
  setVolume(level) { this.player?.setVolume(Math.round(level * 100)); }
  getState() { return { ...this._state }; }
  destroy() {
    clearInterval(this._pollInterval);
    this.player?.destroy();
  }
}

// ─── Export singleton ─────────────────────────────────────────────────────────

export const player = new ViblendPlayer();
export default player;
