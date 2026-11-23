# Pulse — offline music player for iPhone (installed from Safari)

Pulse is a web app you add to your Home Screen from Safari. It plays the music files you import from the Files app. Songs are stored on the phone in the app's own storage, so they play offline. Nothing is uploaded anywhere.

## Features
- **Library**: Songs, Albums, Artists, Genres, Playlists, Liked Songs, Recently Added, with sorting
- **Home**: Recently Played, Recently Added, Top Songs, and auto mixes (Daily Mix, On Repeat, Unplayed, Rediscover, genre and artist mixes)
- **Now Playing**: full-screen player with a blurred artwork background, seek bar, shuffle, repeat (all/one), Love button, and swipe down to close or swipe sideways on the artwork to skip
- **Queue**: Play Next / Play Last, drag to reorder, remove, clear
- **Lyrics**: reads lyrics embedded in the file. Time-synced `.lrc` lyrics highlight and scroll as the song plays (tap a line to jump to it). You can paste lyrics into any song yourself.
- **Playlists**: create, rename, delete, add songs (picker with search), save any album or mix as a playlist
- **Search**: across songs, artists, albums, playlists and lyrics, with recent searches
- **Lock screen and Control Center** controls and artwork (Media Session), AirPlay picker, headphone buttons
- **10-band equalizer** with presets, **sleep timer** (by minutes or at the end of the song), **playback speed** 0.5–2×
- **Tag reading**: title, artist, album, album artist, track/disc, year, genre, cover art and lyrics from MP3 (ID3), M4A/AAC/ALAC, FLAC and WAV
- Edit song and album info and change artwork. Resumes where you left off. Light, dark and system themes, with a choice of accent colour.

## Install on your iPhone

Safari only installs web apps from an **HTTPS** address, so first put this folder on any static host:

**Option A: Netlify Drop (about 1 minute, no account needed to try)**
1. On your Mac, open https://app.netlify.com/drop
2. Drag the `MusicPlayer` folder onto the page.
3. You get a URL like `https://something.netlify.app`.

**Option B: GitHub Pages**
1. Create a repository and upload these files to it.
2. In the repository, go to Settings → Pages, choose the `main` branch, then Save.
3. Your URL is `https://<user>.github.io/<repo>/`.

**Then, on the iPhone:**
1. Open the URL in **Safari**.
2. Tap **Share** (the square with an arrow) → **Add to Home Screen** → **Add**.
3. Open **Pulse from the Home Screen** (not from Safari) and tap **Import Music**. In the Files picker, tap **Select** to choose many songs at once.

> Import inside the installed app. iOS keeps the Safari tab's storage and the Home Screen app's storage separate.

## Notes and limits
- iOS doesn't let web apps read the Apple Music library or DRM-protected purchases. Use your own audio files (for example in iCloud Drive or On My iPhone).
- iOS doesn't let web pages change the volume. Use the phone's volume buttons.
- The equalizer sends audio through Web Audio. On some iOS versions this can stop playback when the screen locks. If that happens, turn the EQ off.
- Storage is limited by free space on the phone. Settings shows how much is used.

## Develop locally
```bash
python3 -m http.server 8765
```
Then open http://localhost:8765. On a desktop browser you can drag and drop audio files onto the window to import them.

Files: `index.html` (shell), `styles.css`, `app.js` (UI and player), `meta.js` (tag parser), `db.js` (IndexedDB), `sw.js` (offline cache), `manifest.webmanifest`, `icons/`.
After changing files, bump `CACHE` in `sw.js` so installed copies pick up the update.
