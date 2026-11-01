# Vracker

Webcam tracking for two homemade steering wheels. First milestone: **local,
in-browser tracking of two marker-based wheels with live position and angle
readouts**. No game layer yet.

## Where this comes from

The plan (from `#project-vracker`): rather than recognising a hand and
interpreting its pose, Vracker starts with markers. Each physical wheel carries
two distinguishable colored dots - a green center dot and a magenta pointer
dot. The tracker locates the two dots per wheel and computes their midpoint
(wheel position) and the angle of the vector between them (wheel rotation).
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

If the markers are not found, click **sample center/pointer color**, then click
the marker in the image. Lighting and printer colors vary; calibration adapts
the HSV thresholds.

## Build the wheels

Open `print-markers.html` and print it at 100% on A4 - two 100 mm discs, each
with a green center dot and a magenta pointer dot. Cut them out and stick them
on anything that spins (cardboard, jar lids). Colored tape dots work just as
well. Keep both dots visible and the two wheels apart - if the wheels nearly
touch, a pointer dot can be closer to the wrong center and confuse pairing.

## Simulated vs real validation

- `node tests/run-tests.js` runs the pipeline against **synthetic** frames with
  known ground truth: midpoint and angle accuracy, rotation direction and
  unwrapping, marker loss, smoothing. Passing tests prove the software, not
  your camera, lighting, or markers.
- The browser **Simulation** mode is the same story, visually.
- Real-camera validation happens on your machine with your wheels: that is the
  step that tells us whether marker tracking is good enough to build on.

## How it works

`src/tracker.js` converts pixels to HSV, thresholds for each marker color,
finds blobs with connected-component labeling, pairs each center dot with its
nearest pointer dot, and tracks wheel identity frame to frame. Angle is
unwrapped continuously and angular velocity is smoothed. `src/sim.js` is the
synthetic feed. `src/app.js` wires camera/simulation into the page. Everything
runs locally in the browser; no frames leave the device.

## Roadmap

1. **This milestone**: two-wheel marker tracking, position + angle readouts.
2. Real-camera validation on Toro's machine; tune marker size/color/lighting.
3. Input abstraction so a game layer can consume wheel state.
4. Optional: bare-hand tracking as an alternative input (MediaPipe), game.

## License

No license file yet - all rights reserved by the repo owner for now.
