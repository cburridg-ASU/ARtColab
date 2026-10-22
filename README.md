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
4. Select **Start session** on the host. The prompt appears on both screens; players can enter immersive, camera-passthrough WebXR on a compatible phone.
5. Choose a furniture item from the AR catalog, aim at a surface, and tap to place it. Tap and drag a placed item to reposition it; use the size buttons to scale it.

Rooms are stored in memory and disappear when the server restarts. Furniture models and their placement are local to each player's active AR session; they are not synchronized with other players or saved after exiting. The viewer requests surface hit-testing when available, but does not require it to start immersive AR. If the XR viewer supports passthrough but not hit-testing, players can still place objects in front of themselves; placement may not stay fixed to room surfaces. Immersive AR requires a compatible browser and device, HTTPS, and camera permission. The explicit camera-preview option displays the camera behind the objects but does not provide room tracking.

## Run smoke tests

```sh
npm test
```

## Deploy on Render

Create a new Render service from this repository and use the included `render.yaml` blueprint. Render installs the app and starts it with `npm start`; the server listens on Render's `PORT` environment variable.
