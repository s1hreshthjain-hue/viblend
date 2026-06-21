// js/algorithm.js — AI blend algorithm, runs entirely on the host browser

import CONFIG from './config.js';
import { writeQueue, sendSignal } from './supabase.js';

// ─── Main Algorithm ───────────────────────────────────────────────────────────

export async function generateBlendedQueue({ members, vibe, coveragePercent, roomId, hostSessionId, onStatus }) {
  onStatus?.('Merging music taste from all members...');

  // Step 1: Build candidate pool
  const { candidateMap, totalMembers } = buildCandidatePool(members);

  onStatus?.('Scoring songs for your crowd...');

  // Step 2: Filter by coverage
  let threshold = coveragePercent / 100;
  let candidates = [...candidateMap.values()].filter(c => c.coverageScore >= threshold);

  let thresholdAdjusted = false;
  while (candidates.length < 15 && threshold > 0.1) {
    threshold -= 0.1;
    candidates = [...candidateMap.values()].filter(c => c.coverageScore >= threshold);
    thresholdAdjusted = true;
  }

  if (thresholdAdjusted) {
    onStatus?.(`Coverage adjusted to ${Math.round(threshold * 100)}% — not enough matches at ${coveragePercent}%`);
  }

  // Step 3: Mood scoring
  onStatus?.('Applying mood filter...');
  candidates = candidates.map(c => ({
    ...c,
    moodScore: computeMoodScore(c, vibe),
  }));

  // Step 4: Final scoring
  candidates = candidates.map(c => ({
    ...c,
    finalScore: (c.moodScore * 0.55) + (c.combinedCoverage * 0.45),
  }));

  // Sort by final score
  candidates.sort((a, b) => b.finalScore - a.finalScore);

  // Step 5: Variety rules
  const final = applyVarietyRules(candidates, 30);

  // Step 6: Resolve platforms
  const resolved = resolvePlatforms(final, members);

  onStatus?.('Writing queue...');
  await writeQueue(roomId, resolved);

  await sendSignal({
    roomId,
    fromSessionId: hostSessionId,
    signalType: 'queue_update',
    payload: { trackCount: resolved.length, vibe, coveragePercent: Math.round(threshold * 100) },
  });

  onStatus?.(`Queue ready — ${resolved.length} songs`);
  return resolved;
}

// ─── Step 1: Candidate Pool ───────────────────────────────────────────────────

function buildCandidatePool(members) {
  const totalMembers = members.length;
  const candidateMap = new Map(); // normalizedKey → candidate

  for (const member of members) {
    if (!member.tasteData?.tracks) continue;

    for (const track of member.tasteData.tracks) {
      const key = normalizeKey(track.title, track.artist);
      if (!key) continue;

      if (!candidateMap.has(key)) {
        candidateMap.set(key, {
          ...track,
          memberCount: 0,
          totalFamiliarityWeight: 0,
          coverageScore: 0,
          avgFamiliarityWeight: 0,
          combinedCoverage: 0,
          resolvedPlatform: track.platform,
          resolvedTrackId: track.id,
          resolvedPlatformUri: track.platformTrackUri,
          platformVersions: [],
        });
      }

      const candidate = candidateMap.get(key);
      candidate.memberCount++;
      candidate.totalFamiliarityWeight += track.familiarityWeight;

      // Keep best quality audio features
      if (track.energy && track.energy !== 0.6) candidate.energy = track.energy;
      if (track.valence && track.valence !== 0.6) candidate.valence = track.valence;
      if (track.tempo && track.tempo !== 120) candidate.tempo = track.tempo;
      if (track.danceability && track.danceability !== 0.6) candidate.danceability = track.danceability;

      // Keep release year from earliest source
      if (track.releaseYear < (candidate.releaseYear || 9999)) candidate.releaseYear = track.releaseYear;

      // Track all platform versions for resolution later
      candidate.platformVersions.push({
        platform: track.platform,
        trackId: track.id,
        platformTrackUri: track.platformTrackUri,
        memberId: member.sessionId,
      });
    }
  }

  // Compute coverage and familiarity scores
  for (const [, candidate] of candidateMap) {
    candidate.coverageScore = candidate.memberCount / totalMembers;
    candidate.avgFamiliarityWeight = candidate.totalFamiliarityWeight / candidate.memberCount;
    candidate.combinedCoverage = (candidate.coverageScore * 0.7) + (candidate.avgFamiliarityWeight * 0.3);
  }

  return { candidateMap, totalMembers };
}

function normalizeKey(title, artist) {
  if (!title || !artist) return null;
  return (title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim() + '|' +
    artist.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()).slice(0, 200);
}

// ─── Step 3: Mood Scoring ─────────────────────────────────────────────────────

function computeMoodScore(track, vibe) {
  const e = clamp(track.energy ?? 0.6);
  const v = clamp(track.valence ?? 0.6);
  const d = clamp(track.danceability ?? 0.6);
  const tempo = track.tempo ?? 120;
  const tempoNorm = clamp((tempo - 60) / (200 - 60));
  const isOldSong = track.releaseYear <= 2010 ? 1.0 : (track.releaseYear <= 2015 ? 0.4 : 0);
  const isBollywood = isBollywoodTrack(track.title, track.artist) ? 1.0 : 0;

  switch (vibe) {
    case 'hype':
      return (e * 0.40) + (d * 0.35) + (tempoNorm * 0.25);
    case 'chill':
      return ((1 - e) * 0.40) + (v * 0.30) + ((1 - tempoNorm) * 0.30);
    case 'bollywood':
      return (d * 0.30) + (v * 0.30) + (e * 0.25) + (isBollywood * 0.15);
    case 'nostalgia':
      return (v * 0.35) + (isOldSong * 0.35) + ((1 - e) * 0.30);
    case 'rnb':
      return (v * 0.40) + (d * 0.35) + ((1 - e) * 0.25);
    case 'indie':
      return ((1 - d) * 0.35) + (v * 0.35) + ((1 - e) * 0.30);
    default:
      return 0.5;
  }
}

function isBollywoodTrack(title = '', artist = '') {
  const text = (title + ' ' + artist).toLowerCase();
  return CONFIG.BOLLYWOOD_KEYWORDS.some(k => text.includes(k.toLowerCase()));
}

// ─── Step 5: Variety Rules ────────────────────────────────────────────────────

function applyVarietyRules(sorted, limit) {
  const result = [];
  const artistCounts = new Map();
  const MAX_IN_TOP10 = 3;
  const MAX_IN_TOP30 = 5;

  for (const track of sorted) {
    if (result.length >= limit) break;
    const artist = (track.artist || '').toLowerCase();
    const count = artistCounts.get(artist) || 0;
    const positionLimit = result.length < 10 ? MAX_IN_TOP10 : MAX_IN_TOP30;
    if (count >= positionLimit) continue;
    artistCounts.set(artist, count + 1);
    result.push(track);
  }

  // If variety rules left gaps, fill with best remaining
  if (result.length < limit) {
    for (const track of sorted) {
      if (result.length >= limit) break;
      if (!result.find(r => r.id === track.id)) result.push(track);
    }
  }

  return result;
}

// ─── Step 6: Platform Resolution ─────────────────────────────────────────────

function resolvePlatforms(tracks, members) {
  const hostMember = members.find(m => m.isHost);
  const hostPlatform = hostMember?.tasteData?.platform || hostMember?.platform;

  return tracks.map(track => {
    const versions = track.platformVersions || [];

    // Priority 1: host platform
    const hostVersion = versions.find(v => v.platform === hostPlatform);
    if (hostVersion) {
      return { ...track, resolvedPlatform: hostVersion.platform, resolvedTrackId: hostVersion.trackId, resolvedPlatformUri: hostVersion.platformTrackUri };
    }

    // Priority 2: any member
    if (versions.length > 0) {
      return { ...track, resolvedPlatform: versions[0].platform, resolvedTrackId: versions[0].trackId, resolvedPlatformUri: versions[0].platformTrackUri };
    }

    // Fallback: original
    return track;
  });
}

// ─── Recalculation ───────────────────────────────────────────────────────────

export function createRecalculationDebouncer(fn, delayMs = CONFIG.COVERAGE_DEBOUNCE_MS) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function clamp(v, min = 0, max = 1) {
  return Math.min(max, Math.max(min, v ?? 0));
}
