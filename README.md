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
3. Enter the room code and a player name. The host screen updates as players connect.

Rooms are stored in memory and disappear when the server restarts. This prototype tests joining and live connection status; it does not yet save rooms, synchronize AR content, or support multiple server instances.

## Run smoke tests

```sh
npm test
```

## Deploy on Render

Create a new Render service from this repository and use the included `render.yaml` blueprint. Render installs the app and starts it with `npm start`; the server listens on Render's `PORT` environment variable.
