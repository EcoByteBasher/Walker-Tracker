import { Tracker } from "./tracker.js";
import { uiTemplate } from "./template.html.js";

const SECRET = "********";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const id = env.TRACKER.idFromName("main");
    const tracker = env.TRACKER.get(id);

    // Core API Routes
    if (url.pathname === "/update") {
      if (url.searchParams.get("key") !== SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
      return tracker.fetch(request);
    }

    if (url.pathname === "/history" || url.pathname === "/clear" || url.pathname === "/status") {
      return tracker.fetch(request);
    }

    // User Interface Root Fallback
    if (url.pathname === "/") {
      return new Response(uiTemplate, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};

// Re-export the Tracker class so Cloudflare knows it defines a Durable Object binding
export { Tracker };
