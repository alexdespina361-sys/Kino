import { parseServerMessage, type ClientMessage, type ServerMessage } from "../../shared";

export type SocketStatus = "connecting" | "open" | "reconnecting" | "replaced";

/** Close code the server uses to tell an old TV page that a newer one took over. */
const CLOSE_REPLACED = 4000;
/** Our own code for "the connection stopped answering"; never sent by the server. */
const CLOSE_SILENT = 4001;

/** A handshake that hasn't completed by now is treated as failed and retried (proxies can hang forever). */
const CONNECT_TIMEOUT_MS = 10_000;

/** Keepalive. Anything heard from the server counts as an answer; silence for this long means the link is dead. */
const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 8_000;
/**
 * The answer to each PING also says how long the round trip to the server is, and the last few are kept: the shortest is the one to go
 * by (a longer one waited in some queue on the way), and it is sent with the next PING. A party uses it to tell how old its host's position
 * is when it gets there. A round trip this long is a link that is failing, not a measure.
 */
const ROUND_TRIPS_KEPT = 4;
const ROUND_TRIP_LONGEST_MS = 5_000;

export interface SocketOptions {
  /** First message sent on every (re)connect. Evaluated each time so it can read fresh storage. */
  hello: () => ClientMessage;
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: SocketStatus) => void;
}

export interface Socket {
  send(message: ClientMessage): boolean;
  disconnect(): void;
}

/** Same-origin WebSocket URL: whatever host served this page (localhost, LAN IP, or a tunnel). */
export function wsUrl(): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/ws`;
}

/* ---------------------------------- socket ---------------------------------- */

/** WebSocket with automatic reconnect (exponential backoff, capped at 5s) and a keepalive that notices dead links. */
export function connectSocket(options: SocketOptions): Socket {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  /** Pings the current socket and drops it if nothing at all comes back in time. */
  let probe: () => void = () => {};

  const connect = () => {
    if (stopped) return;
    const socket = new WebSocket(wsUrl());
    ws = socket;
    let lastHeard = Date.now();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let pongTimer: ReturnType<typeof setTimeout> | undefined;
    const roundTrips: number[] = [];
    /** When the PING that has not been answered yet was sent (0: none). */
    let pingedAt = 0;
    const connectTimer = setTimeout(() => {
      if (socket.readyState !== WebSocket.CONNECTING) return;
      socket.close(); // fires onclose (1006) and lets the normal retry run
    }, CONNECT_TIMEOUT_MS);

    /** One place for "this connection is over", whether the browser said so or it just went quiet. */
    const closed = (code: number) => {
      clearInterval(heartbeat);
      clearTimeout(pongTimer);
      clearTimeout(connectTimer);
      if (ws !== socket || stopped) return;
      ws = null;
      probe = () => {};
      if (code === CLOSE_REPLACED) return options.onStatus("replaced");
      options.onStatus("reconnecting");
      timer = setTimeout(connect, Math.min(500 * 2 ** attempt++, 5000));
    };

    socket.onopen = () => {
      clearTimeout(connectTimer);
      attempt = 0;
      socket.send(JSON.stringify(options.hello()));
      options.onStatus("open");

      // Keeps the link alive through proxies and tunnels, and notices when it died without telling us
      // (TV unplugged, phone out of Wi-Fi range): a half-open socket otherwise looks "connected" forever.
      probe = () => {
        if (socket.readyState !== WebSocket.OPEN) return;
        const sentAt = Date.now();
        const rtt = roundTrips.length > 0 ? Math.round(Math.min(...roundTrips)) : undefined;
        socket.send(JSON.stringify(rtt === undefined ? { type: "PING" } : { type: "PING", rtt }));
        if (pingedAt === 0) pingedAt = performance.now(); // (an answer is timed against the PING it answers: a second one sent before it came is not what it is for)
        clearTimeout(pongTimer);
        pongTimer = setTimeout(() => {
          if (lastHeard >= sentAt || ws !== socket) return;
          socket.onclose = socket.onmessage = socket.onerror = null;
          socket.close();
          closed(CLOSE_SILENT);
        }, PONG_TIMEOUT_MS);
      };
      heartbeat = setInterval(probe, PING_INTERVAL_MS);
      probe(); // (the first round trip is known at once, not 15 s from now)
    };
    socket.onmessage = (event) => {
      lastHeard = Date.now();
      const message = parseServerMessage(event.data);
      if (message?.type === "PONG" && pingedAt > 0) {
        const took = performance.now() - pingedAt;
        pingedAt = 0;
        if (took <= ROUND_TRIP_LONGEST_MS) roundTrips.push(took);
        if (roundTrips.length > ROUND_TRIPS_KEPT) roundTrips.shift();
      }
      if (message && message.type !== "PONG") options.onMessage(message);
    };
    // No onerror: browsers expose no detail there, and the close event that always follows is what triggers the retry.
    socket.onclose = (event) => closed(event.code);
  };

  const onVisibility = () => {
    if (document.visibilityState !== "visible" || stopped) return;
    if (ws?.readyState === WebSocket.CONNECTING) return; // already on its way
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      clearTimeout(timer);
      return connect();
    }
    // Back from sleep: ask for a fresh picture (the hello is answered with the current state), and check the link.
    ws.send(JSON.stringify(options.hello()));
    probe();
  };

  /** Close cleanly before the page enters Back-Forward Cache (bfcache) to prevent browser-level connection abort errors. */
  const onPageHide = () => {
    if (stopped) return;
    clearTimeout(timer);
    if (ws) {
      ws.onclose = ws.onmessage = ws.onerror = null;
      ws.close(1000, "pagehide");
      ws = null;
    }
  };

  /** Re-establish connection when restored from Back-Forward Cache (bfcache). */
  const onPageShow = (event: PageTransitionEvent) => {
    if (stopped) return;
    if (event.persisted && (!ws || ws.readyState !== WebSocket.OPEN)) {
      clearTimeout(timer);
      connect();
    }
  };

  document.addEventListener("visibilitychange", onVisibility);
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
  }

  options.onStatus("connecting");
  connect();

  return {
    send(message) {
      if (ws?.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(message));
      return true;
    },
    disconnect() {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("pageshow", onPageShow);
      }
      clearTimeout(timer);
      ws?.close();
    },
  };
}
