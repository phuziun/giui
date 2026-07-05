# tools/

## phone-cdp.mjs — drive an Android phone's Chrome over CDP

Autonomous on-device testing (used to crack the Pixel 10 black-screen bug).
One-time phone setup: enable Developer options → Wireless debugging → pair.

```bash
# pair (pairing dialog OPEN on the phone; port comes from `adb mdns services`
# — the _adb-tls-pairing entry, NOT the main-screen connect port):
adb pair <ip>:<pairing-port> <6-digit-code>
adb connect <ip>:<connect-port>          # port from the main Wireless-debugging screen

export ANDROID_SERIAL=<ip>:<connect-port>
adb reverse tcp:5173 tcp:5173            # phone localhost:5173 → this machine's dev server
                                         # (localhost = secure context, so WebGPU works)
adb shell am start -a android.intent.action.VIEW \
  -d "http://localhost:5173/?giDebug" com.android.chrome
adb forward tcp:9333 localabstract:chrome_devtools_remote   # phone DevTools → :9333

node tools/phone-cdp.mjs shot out.png    # screenshot what the phone REALLY renders
node tools/phone-cdp.mjs eval 'window.__giProbe()'
node tools/phone-cdp.mjs evalfile tools/webgpu-vi-array-repro.js
node tools/phone-cdp.mjs nav "http://localhost:5173/?giDebug&engine=lite"
```

Phone must be awake + unlocked (`adb shell input keyevent KEYCODE_WAKEUP`;
bump `settings put system screen_off_timeout 1800000` during a session, restore after).
Screenshots hang while the phone dozes.

## webgpu-vi-array-repro.js — PowerVR vertex_index-array driver-bug repro

Self-contained WebGPU test (paste into any console or run via `evalfile`).
On Pixel 10 (PowerVR "img-tec d-series", Android Chrome): a vertex shader that
indexes a shader-local array with `@builtin(vertex_index)` produces degenerate
positions — the draw is silently culled (no errors). The same triangle from
bit math, an if/else chain, or a vertex buffer renders fine. Expected output
on an affected device: `viQuad` returns the clear sentinel `[0.1,...]` while
`vbBigTri` / `viBranch` / `viBitTrick` return the drawn `[0.9,0.8,0.7,0.6]`.

This killed all giui rendering on the phone (composite + present were
fullscreen-triangle draws using the array pattern) — fixed in the shaders by
switching to the bit-trick. Kept here as a minimal repro for a Chromium /
Imagination bug report.
