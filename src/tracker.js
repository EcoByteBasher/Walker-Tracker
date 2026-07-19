import { distanceMetres } from "./utils.js";

export class Tracker {
  constructor(state, env) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/update") {
      const gpsTime = Number(url.searchParams.get("timestamp")) || Date.now();
      const serverTime = Date.now();
      
      // Calculate how many seconds it took for this point to reach the server
      // If negative due to minor clock drift, clamp it safely to 0
      const serverLagSec = Math.max(0, Math.floor((serverTime - gpsTime) / 1000));

      const point = {
        lat: Number(url.searchParams.get("lat")),
        lon: Number(url.searchParams.get("lon")),
        hdop: Number(url.searchParams.get("hdop")),
        altitude: Number(url.searchParams.get("altitude")),
        speed: Number(url.searchParams.get("speed")),
        bearing: Number(url.searchParams.get("bearing")),
        battery: Number(url.searchParams.get("batproc")),
        timestamp: new Date(gpsTime).toISOString(),
        serverLagSec: serverLagSec
      };

      let history = await this.state.storage.get("history") || [];

      if (point.hdop > 10) {
        return Response.json({ ignored: true, reason: "poor GPS accuracy" });
      }

      if (history.length > 0) {
        const previous = history[history.length - 1];
        const elapsed = (new Date(point.timestamp) - new Date(previous.timestamp)) / 1000;

        if (elapsed <= 0) {
          return Response.json({ ignored: true, reason: "duplicate or old timestamp" });
        }

        const jump = distanceMetres(previous.lat, previous.lon, point.lat, point.lon);
        const impliedSpeed = jump / elapsed;
        if (impliedSpeed > 20) {
          return Response.json({ ignored: true, reason: "impossible movement" });
        }
      }

      history.push(point);
      if (history.length > 10000) {
        history = history.slice(-10000);
      }

      await this.state.storage.put("history", history);
      return Response.json(point);
    }

    if (url.pathname === "/history") {
      return Response.json(await this.state.storage.get("history") || []);
    }

    if (url.pathname === "/clear") {
      await this.state.storage.put("history", []);
      return Response.json({ cleared: true });
    }

    if (url.pathname === "/status") {
      const history = await this.state.storage.get("history") || [];
      if (history.length === 0) {
        return Response.json({
          points: 0, lastUpdate: null, secondsAgo: null, battery: null, started: null, distance: 0
        });
      }

      const latest = history[history.length - 1];
      let distance = 0;

      for (let i = 1; i < history.length; i++) {
        distance += distanceMetres(
          history[i - 1].lat, history[i - 1].lon,
          history[i].lat, history[i].lon
        );
      }

      return Response.json({
        points: history.length,
        lastUpdate: latest.timestamp,
        secondsAgo: Math.floor((Date.now() - new Date(latest.timestamp).getTime()) / 1000),
        battery: latest.battery,
        speed: latest.speed,
        started: history[0].timestamp,
        distance: Math.round(distance)
      });
    }

    return new Response("Tracker object running");
  }
}
