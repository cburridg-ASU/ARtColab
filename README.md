# ARtColab

A small ARtColab connectivity prototype served by Node.js.

## Run locally

```sh
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Try the room connection

1. Open [http://localhost:3000/host](http://localhost:3000/host) on the main screen and create a room.
2. Open [http://localhost:3000/join](http://localhost:3000/join) on a phone or another browser.
3. Scan the QR code or enter the room code and a player name.
4. Select **Start session** on the host. The prompt appears on both screens; players can enter immersive, camera-passthrough WebXR on a compatible phone. The WebXR session request is made directly from the button tap.
5. Aim at a surface and tap to place objects. Tap an object to select it, drag to reposition it, and use the size buttons to scale it.

Rooms are stored in memory and disappear when the server restarts. The AR objects are local to each player's phone; shared creation tools and synchronized AR objects are not implemented. On WebXR-compatible phones, AR uses immersive camera passthrough and hit-test surface placement when available. If hit-test is unavailable, immersive AR still starts and objects are placed in the session's tracked viewer space. If immersive AR itself cannot start, players can explicitly choose a camera preview; that preview supports placing, moving, and scaling objects but does not track them as the phone moves. Camera access requires HTTPS (or localhost for local testing) and permission in the browser.

## Run smoke tests

```sh
npm test
```

## Deploy on Render

Create a new Render service from this repository and use the included `render.yaml` blueprint. Render installs the app and starts it with `npm start`; the server listens on Render's `PORT` environment variable.
