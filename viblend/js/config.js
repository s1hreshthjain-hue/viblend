// js/config.js — Environment variables and app-wide constants

const CONFIG = {
  SUPABASE_URL: 'VITE_SUPABASE_URL_PLACEHOLDER',
  SUPABASE_ANON_KEY: 'VITE_SUPABASE_ANON_KEY_PLACEHOLDER',
  SPOTIFY_CLIENT_ID: 'VITE_SPOTIFY_CLIENT_ID_PLACEHOLDER',
  SPOTIFY_REDIRECT_URI: window.location.origin + '/auth/spotify/callback',
  YOUTUBE_CLIENT_ID: 'VITE_YOUTUBE_CLIENT_ID_PLACEHOLDER',
  YOUTUBE_API_KEY: 'VITE_YOUTUBE_API_KEY_PLACEHOLDER',
  APPLE_DEVELOPER_TOKEN: 'VITE_APPLE_MUSIC_DEVELOPER_TOKEN_PLACEHOLDER',
  RAZORPAY_KEY_ID: 'VITE_RAZORPAY_KEY_ID_PLACEHOLDER',
  APP_URL: window.location.origin,

  // Room limits
  MAX_ROOM_MEMBERS: 4,
  ROOM_CODE_LENGTH: 6,
  QUEUE_SIZE: 30,

  // Timing
  HEARTBEAT_INTERVAL_MS: 15000,
  MEMBER_TIMEOUT_MS: 45000,
  TASTE_SHARE_TIMEOUT_MS: 30000,
  COVERAGE_DEBOUNCE_MS: 800,
  VOLUME_DEBOUNCE_MS: 50,

  // Audio
  SAMPLE_RATE: 48000,
  MUSIC_GAIN_DEFAULT: 0.75,
  MUSIC_GAIN_DUCKED: 0.6,
  DUCK_TIME_MS: 300,
  UNDUCK_TIME_MS: 500,

  // WebRTC latency target
  LATENCY_WARNING_MS: 80,

  // Vibes
  VIBES: [
    { id: 'hype', label: 'Hype', emoji: '🔥' },
    { id: 'chill', label: 'Chill', emoji: '🌊' },
    { id: 'bollywood', label: 'Bollywood', emoji: '✨' },
    { id: 'nostalgia', label: 'Nostalgia', emoji: '📼' },
    { id: 'rnb', label: 'R&B', emoji: '🎙' },
    { id: 'indie', label: 'Indie', emoji: '🎸' },
  ],

  // Coverage preset pills
  COVERAGE_PRESETS: [
    { label: 'DJ Flex', value: 25, description: 'Deep cuts & discoveries' },
    { label: 'Party Mix', value: 75, description: 'Mix of familiar & fresh' },
    { label: 'Universal', value: 100, description: 'Only crowd favourites' },
  ],

  // Apple Music genre → audio feature mapping
  APPLE_GENRE_FEATURES: {
    'Electronic': { energy: 0.85, valence: 0.70 },
    'Dance': { energy: 0.85, valence: 0.70 },
    'Pop': { energy: 0.70, valence: 0.75 },
    'Hip-Hop': { energy: 0.75, valence: 0.55 },
    'Rap': { energy: 0.75, valence: 0.55 },
    'R&B': { energy: 0.55, valence: 0.65 },
    'Soul': { energy: 0.55, valence: 0.65 },
    'Rock': { energy: 0.80, valence: 0.50 },
    'Classical': { energy: 0.25, valence: 0.60 },
    'Jazz': { energy: 0.40, valence: 0.65 },
    'Bollywood': { energy: 0.70, valence: 0.75 },
    'Indian': { energy: 0.70, valence: 0.75 },
    'Lo-Fi': { energy: 0.30, valence: 0.60 },
    'Chill': { energy: 0.30, valence: 0.60 },
    'DEFAULT': { energy: 0.60, valence: 0.60 },
  },

  // YouTube keyword energy/valence hints
  YT_HIGH_ENERGY_KEYWORDS: ['remix', 'dance', 'edm', 'bass', 'trap', 'drill', 'bhangra', 'garba', 'party', 'club', 'dj'],
  YT_LOW_ENERGY_KEYWORDS: ['acoustic', 'slow', 'unplugged', 'lofi', 'lo-fi', 'sleep', 'study', 'ambient', 'calm'],
  YT_HIGH_VALENCE_KEYWORDS: ['love', 'happy', 'summer', 'celebrate', 'wedding', 'fun', 'joy'],
  YT_LOW_VALENCE_KEYWORDS: ['sad', 'miss', 'heartbreak', 'alone', 'cry', 'pain', 'lonely'],

  // Bollywood artist/title keywords for mood scoring
  BOLLYWOOD_KEYWORDS: ['bollywood', 'hindi', 'arijit', 'shreya', 'atif', 'neha', 'kumar', 'badshah', 'honey singh', 'diljit', 'punjabi', 'bhangra', 'garba', 'filmi', 'shankar', 'ehsaan', 'pritam', 'vishal', 'shekhar'],
};

// Read actual env values at runtime if available (Vite build injects these)
try {
  if (typeof import_meta_env !== 'undefined') {
    Object.assign(CONFIG, {
      SUPABASE_URL: import_meta_env.VITE_SUPABASE_URL || CONFIG.SUPABASE_URL,
      SUPABASE_ANON_KEY: import_meta_env.VITE_SUPABASE_ANON_KEY || CONFIG.SUPABASE_ANON_KEY,
      SPOTIFY_CLIENT_ID: import_meta_env.VITE_SPOTIFY_CLIENT_ID || CONFIG.SPOTIFY_CLIENT_ID,
      YOUTUBE_CLIENT_ID: import_meta_env.VITE_YOUTUBE_CLIENT_ID || CONFIG.YOUTUBE_CLIENT_ID,
      YOUTUBE_API_KEY: import_meta_env.VITE_YOUTUBE_API_KEY || CONFIG.YOUTUBE_API_KEY,
      APPLE_DEVELOPER_TOKEN: import_meta_env.VITE_APPLE_MUSIC_DEVELOPER_TOKEN || CONFIG.APPLE_DEVELOPER_TOKEN,
      RAZORPAY_KEY_ID: import_meta_env.VITE_RAZORPAY_KEY_ID || CONFIG.RAZORPAY_KEY_ID,
    });
  }
} catch (e) { /* env not injected — use placeholders */ }

// Allow runtime override via window.__VIBLEND_CONFIG (set in HTML via server)
if (window.__VIBLEND_CONFIG) {
  Object.assign(CONFIG, window.__VIBLEND_CONFIG);
}

window.VIBLEND_CONFIG = CONFIG;
export default CONFIG;
