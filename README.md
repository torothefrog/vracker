# Vracker

Webcam tracking for two homemade steering wheels. First milestone: **local,
in-browser tracking of two marker-based wheels with live position and angle
readouts**. No game layer yet.

## Where this comes from

The plan (from `#project-vracker`): rather than recognising a hand and
interpreting its pose, Vracker starts with markers. Each physical wheel carries
two distinguishable colored dots - a center dot and a pointer dot - and each
player gets their own color pair: wheel A is green + magenta, wheel B is
cyan + yellow. The tracker locates the two dots per wheel and computes their
midpoint (wheel position) and the angle of the vector between them (wheel
rotation).
The same interface can later accept bare-hand tracking (e.g. MediaPipe) without
rebuilding the game.

A [Gesture Synth research doc](https://docs.google.com/document/d/1zdd9Grhi6gTYrnF2DZVKbPKnr1iCaMptzSxyYp1S8uI/edit)
informed this choice. That project's app code has a custom non-commercial
licence, so **none of its code is copied here**; this implementation is
original and dependency-free.

## Run it

It is a static page - no build, no dependencies, no server-side anything.

- **GitHub Pages / any static host**: open the deployed URL.
- **Locally**: `python3 -m http.server` (or `npx serve`) in this folder, then
  open `http://localhost:8000`. Camera access requires HTTPS or localhost.

Click **Use camera** for the real feed, or **Simulation** to exercise the exact
same pipeline on synthetic wheels without a camera.

If a marker is not found, click **calibrate A** (or **B**), then click the
wheel's center dot, then its pointer dot, in the image. Lighting and printer
colors vary; calibration adapts the HSV thresholds.

## Build the wheels

Open `print-markers.html` and print it at 100% on A4 - two 100 mm discs:
wheel A with a green center dot and magenta pointer dot, wheel B with a cyan
center dot and yellow pointer dot. Cut them out and stick them on anything
that spins (cardboard, jar lids). Colored tape dots work just as well - just
keep each wheel on its own color pair, because that is how the tracker tells
the players apart. Keep both dots of a wheel visible to the camera.

## Simulated vs real validation

- `node tests/run-tests.js` runs the pipeline against **synthetic** frames with
  known ground truth: midpoint and angle estimates within simulated tolerances
  (2 px / 3 deg), rotation direction and unwrapping, crossing, occlusion,
  reacquisition, jittery frame timing, long stalls. Passing tests prove the
  software only - not your camera, lighting, or markers.
- The browser **Simulation** mode is the same story, visually.
- Real-camera validation happens on your machine with your wheels: that is the
  step that tells us whether marker tracking is good enough to build on.

## How it works

`src/tracker.js` converts pixels to HSV, thresholds for each wheel's marker
colors, finds blobs with connected-component labeling, and pairs each wheel's
center dot with its nearest pointer dot of the matching color. Angle is
unwrapped continuously; angular velocity and position use time-based smoothing
(so jittery frame timing does not spike them). `src/sim.js` is the
synthetic feed. `src/app.js` wires camera/simulation into the page. Everything
runs locally in the browser; no frames leave the device.

### Tracking semantics and limits (read before trusting readouts)

- **Position** is the midpoint of the two dots, not the exact wheel center:
  with the pointer dot at radius r, the reported position orbits the true
  center by r/2. Angle is the primary game input.
- **Accuracy:** in simulation, midpoint and angle estimates land within 2 px /
  3 deg of ground truth. Real-camera accuracy (lighting, printer colors,
  focus, frame rate) is NOT yet validated - that is what the first run on
  Toro's machine is for.
- **Player identity is color-bound.** Wheel A and wheel B use different color
  pairs, so the tracker knows which physical wheel is which without guessing
  from position: wheels can pass each other without swapping labels.
- **Occlusion:** if a wheel's dots disappear (hand over the marker, wheel
  behind the other wheel), the readout shows "markers lost" for ~10 frames,
  then the wheel drops. When it reappears it is still the same player (colors
  do not lie), but its angle history and smoothing restart as a fresh entry.
  A direct head-on overlap of both wheels (physically impossible with real
  wheels) exceeds the grace period and causes exactly such a restart.
- **Stalls (hidden tab, slow machine):** after a 0.5-3 s frame gap the tracker
  snaps to the new observation and zeroes the velocity (rotation during the
  gap is unknowable and is not integrated); velocity re-converges within a
  few frames. After a gap over 3 s the tracking state resets and wheels are
  re-acquired fresh. Angle continuity across any gap longer than half a wheel
  turn is unrecoverable by design.
- All of the above is covered by tests in `tests/run-tests.js` (simulated
  data).

## Space Dodgers (milestone 2: the game)

`game.html` is the first game built on the tracker: **two ships on one shared
screen dodging asteroids**. Each wheel steers its ship - turn the physical
wheel right and the ship banks right; back to the baseline is straight ahead.
Keyboard (A/D and arrow keys) and touch (drag left/right half) steer too, so
the game is playable without the camera.

- **Co-op for kids**: one shared pool of five hearts, gold stars to catch,
  a best score saved in the browser. Difficulty ramps the longer you survive.
- **3D, original visuals**: low-poly rockets, asteroids and planets built in
  code with [Three.js](https://threejs.org) (vendored in `vendor/`, MIT
  licence). No external art assets; the look follows the direction of the
  reference images without copying them.
- **Architecture**: `src/game/core.js` holds the rules (pure JS, Node-tested);
  `src/game/game3d.js` only renders; `src/game/wheelinput.js` turns tracker
  output into steering (angle offset from a baseline set at start / recenter,
  150 deg of wheel turn = full deflection). The tracker itself is unchanged.
- **Tests**: `node tests/game-tests.js` covers steering mapping, lane clamps,
  ship separation, collisions/invulnerability/game-over, star collection,
  pair-spawn gaps, difficulty ramp, and dodge scoring - all deterministic
  (seeded RNG). The browser page also has a `?test=1` harness that simulates
  a fixed run and reports JSON into the page for headless checks.

Like the tracker, everything runs locally on the device; no frames or scores
leave the browser (the best score stays in localStorage).

**Calibration carries over.** Colors calibrated on the tracker page are saved
in the browser and picked up by the game, so printing/lighting fixes only need
doing once. In the game, **recenter wheels** makes the current wheel position
"straight ahead"; it also happens automatically on START. If a wheel is lost
long enough to be dropped (hand over the markers, wheel out of frame), the
ship just holds course while it is gone, and when the wheel comes back its
position re-anchors as neutral - no steering jump.

**Nov 2 feedback round.** Fewer asteroids at the start (spawn interval 2.6 s
ramping down to 0.9 s, fewer pairs); blue lane rails show the steering limit
and each asteroid casts a floor stripe (turns red when a ship is in its path);
wheel steering inverted (the camera faces the player, so a clockwise turn is
counter-clockwise in the image); the camera preview lists which of the four
markers (A centre/pointer, B centre/pointer) are detected.

## Roadmap

1. ~~This milestone~~: two-wheel marker tracking, position + angle readouts. **Done.**
2. Real-camera validation on Toro's machine; tune marker size/color/lighting.
3. ~~Input abstraction so a game layer can consume wheel state~~. **Done** -
   Space Dodgers steers with wheel angle.
4. Real-camera game validation: does wheel steering feel good enough for kids?
4. Optional: bare-hand tracking as an alternative input (MediaPipe), game.

## License

No license file yet - all rights reserved by the repo owner for now.
