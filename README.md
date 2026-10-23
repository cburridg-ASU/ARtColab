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
4. Choose a round length (1–10 minutes) and select **Start session** on the host. The shared countdown appears on the host and player screens. Players can enter immersive, camera-passthrough WebXR on a compatible phone; AR exits automatically when the round ends, or players can tap **Exit AR** to return early.
5. Choose a furniture item from the AR catalog, aim at a surface, and tap to place it. Tap and drag a placed item to reposition it; use the size buttons to scale it.

The host can choose a 1–10 minute round before starting (default: 5 minutes). Each player's furniture choices, sizes, positions, and rotations are saved to the room as they create. At the end of the round, the host and players see a combined 3D showcase; players can reopen it in AR without placing it again. The host screen includes a QR code and link so a phone can reopen a completed round later with its room code. Each player's arrangement is preserved; player groups are separated in the combined gallery because phones do not share a spatial anchor and their room origins cannot be aligned. Set `DATABASE_URL` to a PostgreSQL connection string to preserve completed rounds and results across server restarts. Without it, saved rounds remain available only until the server restarts. The Render blueprint asks for `DATABASE_URL`; provision a PostgreSQL database separately and add its internal connection string in the web service's environment settings to enable durable storage.

The viewer requests surface hit-testing when available, but does not require it to start immersive AR. If the XR viewer supports passthrough but not hit-testing, players can still place objects in front of themselves; placement may not stay fixed to room surfaces. Immersive AR requires a compatible browser and device, HTTPS, and camera permission. The explicit camera-preview option displays the camera behind the objects but does not provide room tracking.

## Run smoke tests

```sh
npm test
```

## Deploy on Render

Create a new Render service from this repository and use the included `render.yaml` blueprint. Render installs the app and starts it with `npm start`; the server listens on Render's `PORT` environment variable.
