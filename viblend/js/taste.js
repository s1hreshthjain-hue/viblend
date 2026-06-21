// js/taste.js — Music taste ingestion from all three platforms (in-memory only)

import CONFIG from './config.js';
import { spotifyFetch, youtubeFetch, getAppleMusicInstance } from './auth.js';

// ─── Main Entry ───────────────────────────────────────────────────────────────

export async function ingestTasteData(onProgress) {
  const session = window.viblendSession;
  if (!session) throw new Error('No session');

  onProgress?.(0, 'Connecting to your music...');

  let tracks = [];
  if (session.platform === 'spotify') {
    tracks = await ingestSpotify(onProgress);
  } else if (session.platform === 'apple') {
    tracks = await ingestApple(onProgress);
  } else if (session.platform === 'youtube') {
    tracks = await ingestYouTube(onProgress);
  }

  session.tasteData = {
    tracks,
    platform: session.platform,
    ingestedAt: new Date(),
  };

  onProgress?.(100, `Found ${tracks.length} tracks`);
  return session.tasteData;
}

// ─── Spotify ──────────────────────────────────────────────────────────────────

async function ingestSpotify(onProgress) {
  onProgress?.(5, 'Fetching your top tracks...');

  const [longTerm, mediumTerm, shortTerm, recent, saved] = await Promise.all([
    spotifyFetch('/me/top/tracks?limit=50&time_range=long_term').catch(() => ({ items: [] })),
    spotifyFetch('/me/top/tracks?limit=50&time_range=medium_term').catch(() => ({ items: [] })),
    spotifyFetch('/me/top/tracks?limit=50&time_range=short_term').catch(() => ({ items: [] })),
    spotifyFetch('/me/player/recently-played?limit=50').catch(() => ({ items: [] })),
    spotifyFetch('/me/tracks?limit=50').catch(() => ({ items: [] })),
  ]);

  onProgress?.(30, 'Analysing listening patterns...');

  const trackMap = new Map();

  const addTracks = (items, weight, isRecent = false) => {
    items.forEach(item => {
      const track = isRecent ? item.track : item;
      if (!track?.id) return;
      if (!trackMap.has(track.id)) {
        trackMap.set(track.id, {
          id: track.id,
          platformTrackUri: `spotify:track:${track.id}`,
          title: track.name,
          artist: track.artists?.[0]?.name || 'Unknown',
          album: track.album?.name || '',
          albumArtUrl: track.album?.images?.[0]?.url || '',
          durationMs: track.duration_ms || 0,
          releaseYear: parseInt(track.album?.release_date?.slice(0, 4) || '2020'),
          platform: 'spotify',
          familiarityWeight: weight,
          energy: 0.6, valence: 0.6, tempo: 120, danceability: 0.6,
        });
      } else {
        const existing = trackMap.get(track.id);
        if (weight > existing.familiarityWeight) existing.familiarityWeight = weight;
      }
    });
  };

  addTracks(longTerm.items || [], 1.0);
  addTracks(mediumTerm.items || [], 0.85);
  addTracks(shortTerm.items || [], 0.9);
  addTracks((recent.items || []), 0.7, true);
  addTracks((saved.items || []).map(i => i.track), 0.6);

  onProgress?.(50, 'Loading audio features...');

  // Batch audio features in groups of 100
  const ids = [...trackMap.keys()];
  const batches = chunkArray(ids, 100);

  for (const batch of batches) {
    try {
      const data = await spotifyFetch(`/audio-features?ids=${batch.join(',')}`);
      (data.audio_features || []).forEach(af => {
        if (!af) return;
        const track = trackMap.get(af.id);
        if (!track) return;
        track.energy = af.energy ?? 0.6;
        track.valence = af.valence ?? 0.6;
        track.tempo = af.tempo ?? 120;
        track.danceability = af.danceability ?? 0.6;
      });
    } catch (e) {
      console.warn('Audio features batch failed:', e);
    }
  }

  onProgress?.(90, 'Finalising taste profile...');
  return [...trackMap.values()];
}

// ─── Apple Music ──────────────────────────────────────────────────────────────

async function ingestApple(onProgress) {
  onProgress?.(5, 'Accessing your Apple Music library...');
  const music = getAppleMusicInstance();
  if (!music) throw new Error('MusicKit not available');

  const [heavyRotation, recentlyPlayed, library] = await Promise.all([
    music.api.music('/v1/me/history/heavy-rotation', { limit: 25 }).catch(() => ({ data: { data: [] } })),
    music.api.music('/v1/me/recent/played/tracks', { limit: 50 }).catch(() => ({ data: { data: [] } })),
    music.api.music('/v1/me/library/songs', { limit: 100 }).catch(() => ({ data: { data: [] } })),
  ]);

  onProgress?.(40, 'Building Apple Music taste profile...');

  const trackMap = new Map();

  const addAppleTracks = (items, weight) => {
    (items || []).forEach(item => {
      const attrs = item.attributes || {};
      const id = item.id || attrs.playParams?.id;
      if (!id) return;
      if (!trackMap.has(id)) {
        const genres = attrs.genreNames || [];
        const { energy, valence } = appleGenreToFeatures(genres);
        trackMap.set(id, {
          id,
          platformTrackUri: id,
          title: attrs.name || 'Unknown',
          artist: attrs.artistName || 'Unknown',
          album: attrs.albumName || '',
          albumArtUrl: (attrs.artwork?.url || '').replace('{w}', '300').replace('{h}', '300'),
          durationMs: attrs.durationInMillis || 0,
          releaseYear: parseInt(attrs.releaseDate?.slice(0, 4) || '2020'),
          platform: 'apple',
          familiarityWeight: weight,
          energy,
          valence,
          tempo: 120,
          danceability: energy * 0.8,
        });
      } else {
        const existing = trackMap.get(id);
        if (weight > existing.familiarityWeight) existing.familiarityWeight = weight;
      }
    });
  };

  addAppleTracks(heavyRotation?.data?.data || [], 1.0);
  addAppleTracks(recentlyPlayed?.data?.data || [], 0.8);
  addAppleTracks(library?.data?.data || [], 0.6);

  onProgress?.(90, 'Finalising taste profile...');
  return [...trackMap.values()];
}

function appleGenreToFeatures(genres) {
  const map = CONFIG.APPLE_GENRE_FEATURES;
  for (const genre of genres) {
    for (const [key, features] of Object.entries(map)) {
      if (genre.toLowerCase().includes(key.toLowerCase())) return features;
    }
  }
  return map['DEFAULT'];
}

// ─── YouTube ──────────────────────────────────────────────────────────────────

async function ingestYouTube(onProgress) {
  onProgress?.(5, 'Loading your YouTube music history...');

  const [liked, likedPlaylist] = await Promise.all([
    youtubeFetch(
      `https://www.googleapis.com/youtube/v3/videos?myRating=like&maxResults=50&part=snippet,contentDetails&videoCategoryId=10`
    ).catch(() => ({ items: [] })),
    youtubeFetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=LL&maxResults=50`
    ).catch(() => ({ items: [] })),
  ]);

  onProgress?.(50, 'Analysing your music taste...');

  const trackMap = new Map();

  const addYTVideos = (items, weight, fromPlaylist = false) => {
    (items || []).forEach(item => {
      let videoId, title, channelTitle;
      if (fromPlaylist) {
        videoId = item.snippet?.resourceId?.videoId;
        title = item.snippet?.title || '';
        channelTitle = item.snippet?.videoOwnerChannelTitle || '';
      } else {
        videoId = item.id;
        title = item.snippet?.title || '';
        channelTitle = item.snippet?.channelTitle || '';
      }

      if (!videoId || trackMap.has(videoId)) return;

      const { energy, valence } = ytKeywordsToFeatures(title + ' ' + channelTitle);
      const thumb = item.snippet?.thumbnails?.high?.url
        || item.snippet?.thumbnails?.default?.url || '';

      trackMap.set(videoId, {
        id: videoId,
        platformTrackUri: videoId,
        title,
        artist: channelTitle,
        album: '',
        albumArtUrl: thumb,
        durationMs: 0,
        releaseYear: parseInt(item.snippet?.publishedAt?.slice(0, 4) || '2020'),
        platform: 'youtube',
        familiarityWeight: weight,
        energy,
        valence,
        tempo: energy > 0.7 ? 130 : 90,
        danceability: energy * 0.85,
      });
    });
  };

  addYTVideos(liked.items || [], 0.85);
  addYTVideos(likedPlaylist.items || [], 0.7, true);

  onProgress?.(90, 'Finalising taste profile...');
  return [...trackMap.values()];
}

function ytKeywordsToFeatures(text) {
  const lower = text.toLowerCase();
  let energy = 0.60;
  let valence = 0.60;

  if (CONFIG.YT_HIGH_ENERGY_KEYWORDS.some(k => lower.includes(k))) energy = 0.80;
  if (CONFIG.YT_LOW_ENERGY_KEYWORDS.some(k => lower.includes(k))) energy = 0.30;
  if (CONFIG.YT_HIGH_VALENCE_KEYWORDS.some(k => lower.includes(k))) valence = 0.75;
  if (CONFIG.YT_LOW_VALENCE_KEYWORDS.some(k => lower.includes(k))) valence = 0.30;

  return { energy, valence };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}
