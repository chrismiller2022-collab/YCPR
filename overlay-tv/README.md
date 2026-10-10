# Score Bug (Google TV)

A small Android TV app that draws `https://ycpr.vercel.app/overlay` in a see-through window on top of whatever is playing (YouTube TV, ESPN, Fox). The window can't take focus or touches, so the remote still controls the app underneath.

Everything you see is the web page. You change games, the corner, the size and the spoiler delay from **`/overlay/control`** on a laptop or phone, and the TV picks up each change within a second. The app itself almost never needs to change.

## Where the data comes from

| On the bug | Source | Cost |
|---|---|---|
| Score, clock, possession, down & distance | ESPN's free scoreboard via `/api/odds-feed?mode=scoreboard`, edge-cached 10s | free |
| Line / total | `betting_lines` already in Supabase | read once |
| My numbers | `game_projection_locks` | read once |
| My bets, graded live | `placed_bets` | read once |

No CFBD or Odds API calls.

## One-time install (Google TV Streamer)

1. **Developer options:** Settings → System → About → click **Android TV OS build** 7 times.
2. **Wireless debugging:** Settings → System → Developer options → **Wireless debugging** on → **Pair device with pairing code**. Note the IP:port and 6-digit code it shows.
3. **Get the APK:** GitHub → Releases → **scorebug-latest** → `scorebug.apk` (rebuilt by `.github/workflows/scorebug-apk.yml` on every change under `overlay-tv/`).
4. **From the laptop** (same Wi-Fi; needs `adb` from Android platform-tools):

   ```sh
   adb pair <tv-ip>:<pairing-port> <code>
   adb connect <tv-ip>:<debug-port>        # the port on the main Wireless debugging screen, not the pairing one
   adb install -r scorebug.apk
   adb shell appops set com.ycpr.scorebug SYSTEM_ALERT_WINDOW allow
   ```

5. On the TV, open **Score Bug** from Apps once. It starts the overlay. Press Home and open YouTube TV; the bug stays on top.

After that it starts on its own whenever the TV boots. Google TV's own Settings menu won't grant "display over other apps" to sideloaded apps, so step 4's `appops` line is the only way to grant it.

## Everyday use

- Open `https://ycpr.vercel.app/overlay/control` (admin password), pick games, and choose corner or ticker.
- **Spoiler delay:** YouTube TV runs ~30–90s behind live. Raise the slider until the bug stops beating your picture.
- If the bug ever looks stuck, open the Score Bug app and press **Reload page**. The page also reloads itself overnight to pick up site deploys.

## Optional

- Use a different page or screen: `adb shell am start -n com.ycpr.scorebug/.MainActivity --es url "https://ycpr.vercel.app/overlay?screen=den"`. Each `screen` id has its own row in `overlay_state`, controlled at `/overlay/control?screen=den`.
- Build locally: `./gradlew assembleDebug` (needs the Android SDK; set `sdk.dir` in `local.properties`). The APK lands in `app/build/outputs/apk/debug/`.
- `app/scorebug-debug.keystore` is a fixed debug signing key, so each new build installs over the old one with `adb install -r`. It's only used for sideloading onto your own TV.
