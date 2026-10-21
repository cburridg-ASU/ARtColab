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
4. Select **Start session** on the host. The prompt appears on both screens; players can enter an immersive, camera-passthrough WebXR view on a compatible phone.
5. Aim at a surface and tap to place objects. Tap an object to select it, drag to reposition it, and use the size buttons to scale it.

Rooms are stored in memory and disappear when the server restarts. The AR objects are local to each player's phone; shared creation tools and synchronized AR objects are not implemented. Immersive AR and surface placement require a WebXR-compatible phone browser, hit-test support, and a secure context (HTTPS, or localhost for local testing).

## Run smoke tests

```sh
npm test
```

## Deploy on Render

Create a new Render service from this repository and use the included `render.yaml` blueprint. Render installs the app and starts it with `npm start`; the server listens on Render's `PORT` environment variable.
