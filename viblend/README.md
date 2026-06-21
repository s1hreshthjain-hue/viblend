# Viblend 🎵

> **Every song, for everyone in the room.**

A social party music curation and live karaoke PWA. Connect Spotify, Apple Music, or YouTube Music — Viblend blends everyone's taste into one perfect queue and turns your phone into a wireless karaoke mic.

---

## Features

- **AI Blend Algorithm** — finds songs everyone in the room knows, scored by mood and familiarity
- **Cross-Platform** — Spotify, Apple Music, and YouTube Music users in the same party
- **Live Karaoke** — real-time WebRTC voice from all phones through the host speaker, with full audio processing chain
- **Vocal Removal** — frequency-domain vocal isolation with ONNX enhancement layer
- **Synced Lyrics** — live highlighting via LRCLIB (free, no API key)
- **Zero Data Retention** — music taste never leaves the browser session
- **PWA** — installable on iOS and Android, works offline for core UI

---

## Project Structure

```
/
├── index.html              Landing page + platform connect
├── app.html                Main app shell (all screens)
├── manifest.json           PWA manifest
├── sw.js                   Service worker
├── vercel.json             Deployment config
├── .env.example            All required env variables
├── /css
│   ├── main.css            Full design system + screen styles
│   ├── animations.css      All keyframe animations
│   └── components.css      Reusable component styles
├── /js
│   ├── config.js           Environment variables + constants
│   ├── supabase.js         Supabase client + all DB operations
│   ├── auth.js             Spotify PKCE · Apple MusicKit · YouTube GIS
│   ├── taste.js            Music taste ingestion (in-memory only)
│   ├── algorithm.js        AI blend algorithm (runs on host browser)
│   ├── player.js           Unified player: Spotify · Apple · YouTube
│   ├── karaoke.js          WebRTC mic system + Web Audio mixer
│   ├── vocals.js           ONNX vocal separation engine
│   ├── lyrics.js           LRCLIB + synced display
│   ├── room.js             Room create/join/lifecycle
│   ├── ui.js               Screen navigation + all UI rendering
│   ├── realtime.js         Supabase realtime subscriptions
│   ├── pwa.js              PWA install + service worker
│   ├── payments.js         Razorpay Pro tier scaffold
│   ├── app.js              Main controller (app.html entry)
│   └── workers/
│       └── vocals-worker.js  ONNX worker for stem separation
├── /models
│   └── demucs_small.onnx   (download separately — see below)
└── /icons
    ├── icon-192.png
    └── icon-512.png
```

---

## Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/your-org/viblend.git
cd viblend
# No npm install needed — pure vanilla JS + CDN dependencies
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in all values in `.env`. See API setup sections below.

### 3. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run this SQL in the Supabase SQL Editor:

```sql
-- Rooms table
CREATE TABLE rooms (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text UNIQUE NOT NULL,
  host_user_id        text NOT NULL,
  host_display_name   text,
  host_avatar_url     text,
  vibe                text DEFAULT 'hype',
  coverage_percent    integer DEFAULT 75,
  vocal_volume        integer DEFAULT 100,
  status              text DEFAULT 'waiting',
  current_song_index  integer DEFAULT 0,
  karaoke_enabled     boolean DEFAULT false,
  created_at          timestamptz DEFAULT now(),
  ended_at            timestamptz
);

-- Room members
CREATE TABLE room_members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id             uuid REFERENCES rooms(id) ON DELETE CASCADE,
  user_session_id     text NOT NULL,
  display_name        text,
  avatar_url          text,
  platform            text,
  peer_id             text,
  is_mic_active       boolean DEFAULT false,
  mic_volume          float DEFAULT 1.0,
  is_host             boolean DEFAULT false,
  joined_at           timestamptz DEFAULT now(),
  last_seen_at        timestamptz DEFAULT now()
);

-- Room queue
CREATE TABLE room_queue (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id             uuid REFERENCES rooms(id) ON DELETE CASCADE,
  position            integer,
  platform            text,
  track_id            text,
  title               text,
  artist              text,
  album               text,
  album_art_url       text,
  duration_ms         integer,
  energy              float,
  valence             float,
  tempo               float,
  danceability        float,
  coverage_score      float,
  mood_score          float,
  played              boolean DEFAULT false
);

-- Signals table (auto-cleaned)
CREATE TABLE room_signals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id             uuid REFERENCES rooms(id) ON DELETE CASCADE,
  from_session_id     text,
  to_session_id       text,
  signal_type         text,
  payload             jsonb,
  created_at          timestamptz DEFAULT now()
);

-- Enable Realtime on all tables
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE room_members;
ALTER PUBLICATION supabase_realtime ADD TABLE room_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE room_signals;

-- Enable Row Level Security
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_signals ENABLE ROW LEVEL SECURITY;

-- RLS Policies (permissive for MVP — tighten in production)
CREATE POLICY "Allow all on rooms" ON rooms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on room_members" ON room_members FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on room_queue" ON room_queue FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on room_signals" ON room_signals FOR ALL USING (true) WITH CHECK (true);

-- Auto-delete old signals (optional, requires pg_cron extension)
-- SELECT cron.schedule('cleanup-signals', '*/30 * * * *',
--   'DELETE FROM room_signals WHERE created_at < NOW() - INTERVAL ''30 minutes''');
```

3. Copy your **Project URL** and **anon key** to `.env`

### 4. Set up Spotify

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Create an app
3. Add Redirect URI: `https://your-domain.vercel.app/auth/spotify/callback`
4. Also add `http://localhost:3000/auth/spotify/callback` for local dev
5. Copy **Client ID** to `.env` — Viblend uses PKCE so no client secret needed

### 5. Set up YouTube / Google

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Enable **YouTube Data API v3**
3. Create OAuth 2.0 credentials (Web application)
4. Add Authorized JavaScript origins: `https://your-domain.vercel.app` and `http://localhost:3000`
5. Create an **API Key** (restricted to YouTube Data API v3)
6. Copy Client ID and API Key to `.env`

### 6. Set up Apple Music

1. Enroll in Apple Developer Program ($99/year)
2. Create a **MusicKit identifier** in the Apple Developer portal
3. Create a **Media ID** and download the private key
4. Generate a Developer Token (JWT signed with your private key, valid up to 6 months):

```bash
# Using jwt-cli or similar:
# Header: { "alg": "ES256", "kid": "YOUR_KEY_ID" }
# Payload: { "iss": "YOUR_TEAM_ID", "iat": NOW, "exp": NOW + 15552000 }
```

5. Paste the JWT into `.env` as `VITE_APPLE_MUSIC_DEVELOPER_TOKEN`

### 7. (Optional) Demucs ONNX Model

For enhanced vocal separation (the app works fine without it using frequency-domain processing):

```bash
pip install demucs onnx
python3 -c "
import torch
from demucs.pretrained import get_model
model = get_model('htdemucs')
# Export to ONNX — requires custom export script
# Place result at /models/demucs_small.onnx
"
```

Alternatively, use the frequency-domain fallback built into `vocals.js` — it works without the model.

### 8. Inject config at runtime

In `index.html` and `app.html`, update the config injection script:

```html
<script>
window.__VIBLEND_CONFIG = {
  SUPABASE_URL: 'https://yourproject.supabase.co',
  SUPABASE_ANON_KEY: 'your-anon-key',
  SPOTIFY_CLIENT_ID: 'your-spotify-client-id',
  YOUTUBE_CLIENT_ID: 'your-google-client-id.apps.googleusercontent.com',
  YOUTUBE_API_KEY: 'your-youtube-api-key',
  APPLE_DEVELOPER_TOKEN: 'your-apple-jwt',
  RAZORPAY_KEY_ID: 'rzp_test_...',
};
</script>
```

Or use a Vercel Edge Function / build step to inject these from environment variables.

---

## Deploy to Vercel

```bash
npm i -g vercel
vercel --prod
```

Set all environment variables in the Vercel dashboard under **Settings → Environment Variables**.

---

## Local Development

```bash
# Serve locally with HTTPS (required for getUserMedia and WebRTC)
npx serve . -p 3000
# Or with live reload:
npx browser-sync start --server --files "**/*.html,**/*.css,**/*.js" --port 3000
```

For Spotify to work locally, add `http://localhost:3000/auth/spotify/callback` as a redirect URI in your Spotify app settings.

---

## Architecture Overview

### Data Flow
```
User connects music platform
    ↓ OAuth / MusicKit
Access token stored in sessionStorage only
    ↓
Taste ingestion runs (parallel API calls)
    ↓ stored in window.viblendSession.tasteData (RAM only)
User creates or joins party room
    ↓ Room state in Supabase
PeerJS DataConnection opened between all members
    ↓ Taste data shared P2P (never touches Supabase)
Host runs blend algorithm
    ↓ 30-song queue written to room_queue table
Supabase Realtime broadcasts queue_update signal
    ↓ All clients update their UI
Host device plays music + receives WebRTC audio from guests
    ↓ Web Audio API mixes music + voices
Speaker plays everything
```

### WebRTC Audio Path (Karaoke)
```
Guest phone mic
    → getUserMedia
    → PeerJS MediaConnection (STUN/TURN)
    → Host browser receives MediaStream
    → Web Audio processing chain:
       highpass → presence boost → compressor → limiter → reverb
    → masterGain → AudioContext.destination → Speaker
```

---

## Environment Variables Reference

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `VITE_SPOTIFY_CLIENT_ID` | Spotify Developer App Client ID |
| `VITE_SPOTIFY_REDIRECT_URI` | OAuth callback URL |
| `VITE_YOUTUBE_CLIENT_ID` | Google OAuth Client ID |
| `VITE_YOUTUBE_API_KEY` | YouTube Data API v3 Key |
| `VITE_APPLE_MUSIC_DEVELOPER_TOKEN` | Apple MusicKit JWT |
| `VITE_RAZORPAY_KEY_ID` | Razorpay key (Pro tier) |
| `VITE_APP_URL` | Production URL (e.g. `https://viblend.app`) |

---

## Browser Support

| Feature | Chrome | Safari (iOS) | Firefox |
|---|---|---|---|
| WebRTC Audio | ✅ | ✅ | ✅ |
| Web Audio API | ✅ | ✅ | ✅ |
| getUserMedia | ✅ | ✅ (HTTPS only) | ✅ |
| PWA Install | ✅ | ✅ (Add to Home) | ⚠️ Limited |
| ONNX Runtime | ✅ | ✅ | ✅ |
| Service Worker | ✅ | ✅ | ✅ |

> iOS Safari requires HTTPS for microphone access. Local dev with `localhost` works on Chrome and Firefox but not iOS Safari — use a tunnel (ngrok) for iOS testing.

---

## Roadmap (Pro Tier)

- [ ] Parties up to 8 people
- [ ] Recording & export
- [ ] Custom room themes
- [ ] Party analytics
- [ ] Razorpay Pro billing (scaffold in `js/payments.js`)

---

## Built with

- [Supabase](https://supabase.com) — realtime backend
- [PeerJS](https://peerjs.com) — WebRTC
- [LRCLIB](https://lrclib.net) — synced lyrics
- [ONNX Runtime Web](https://onnxruntime.ai) — vocal separation
- [Spotify Web API + Playback SDK](https://developer.spotify.com)
- [Apple MusicKit JS](https://developer.apple.com/musickit)
- [YouTube IFrame API](https://developers.google.com/youtube)
- [Razorpay](https://razorpay.com) — payments scaffold

---

*Viblend — built by Shreshth*
