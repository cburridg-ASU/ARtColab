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
4. Select **Start session** on the host. The prompt appears on both screens; players can enter an immersive WebXR AR view on a compatible phone.

Rooms are stored in memory and disappear when the server restarts. The AR view currently displays a simple sample sculpture; shared creation tools and synchronized AR objects are not implemented. Immersive AR requires a WebXR-compatible phone browser and a secure context (HTTPS, or localhost for local testing).

## Run smoke tests

```sh
npm test
```

## Deploy on Render

Create a new Render service from this repository and use the included `render.yaml` blueprint. Render installs the app and starts it with `npm start`; the server listens on Render's `PORT` environment variable.
