import { parseServerMessage, type ClientMessage, type ServerMessage } from "../../shared";

function kindOf(data: unknown): string {
  try {
    const read = JSON.parse(String(data)) as { type?: unknown; command?: { type?: unknown } } | null;
    return [read?.type, read?.command?.type].filter((part) => typeof part === "string").join(" ") || "no type";
  } catch {
    return "not JSON";
  }
}

export type SocketStatus = "connecting" | "open" | "reconnecting" | "replaced";

const CLOSE_REPLACED = 4000;
const CLOSE_SILENT = 4001;

const CONNECT_TIMEOUT_MS = 10_000;

const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 8_000;
const ROUND_TRIPS_KEPT = 4;
const ROUND_TRIP_LONGEST_MS = 5_000;

export interface SocketOptions {
  hello: () => ClientMessage;
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: SocketStatus) => void;
}

export interface Socket {
  send(message: ClientMessage): boolean;
  disconnect(): void;
}

export function wsUrl(): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/ws`;
}

export function connectSocket(options: SocketOptions): Socket {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let probe: () => void = () => {};

  const connect = () => {
    if (stopped) return;
    const socket = new WebSocket(wsUrl());
    ws = socket;
    let lastHeard = Date.now();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let pongTimer: ReturnType<typeof setTimeout> | undefined;
    const roundTrips: number[] = [];
    let pingedAt = 0;
    const connectTimer = setTimeout(() => {
      if (socket.readyState !== WebSocket.CONNECTING) return;
      socket.close();
    }, CONNECT_TIMEOUT_MS);

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
      socket.send(JSON.stringify(options.hello()));
      options.onStatus("open");

      probe = () => {
        if (socket.readyState !== WebSocket.OPEN) return;
        const sentAt = Date.now();
        const rtt = roundTrips.length > 0 ? Math.round(Math.min(...roundTrips)) : undefined;
        socket.send(JSON.stringify(rtt === undefined ? { type: "PING" } : { type: "PING", rtt }));
        if (pingedAt === 0) pingedAt = performance.now();
        clearTimeout(pongTimer);
        pongTimer = setTimeout(() => {
          if (lastHeard >= sentAt || ws !== socket) return;
          socket.onclose = socket.onmessage = socket.onerror = null;
          socket.close();
          closed(CLOSE_SILENT);
        }, PONG_TIMEOUT_MS);
      };
      heartbeat = setInterval(probe, PING_INTERVAL_MS);
      probe();
    };
    socket.onmessage = (event) => {
      lastHeard = Date.now();
      attempt = 0;
      const message = parseServerMessage(event.data);
      if (message?.type === "PONG" && pingedAt > 0) {
        const took = performance.now() - pingedAt;
        pingedAt = 0;
        if (took <= ROUND_TRIP_LONGEST_MS) roundTrips.push(took);
        if (roundTrips.length > ROUND_TRIPS_KEPT) roundTrips.shift();
      }
      if (message && message.type !== "PONG") options.onMessage(message);
      if (!message) console.warn("[kino] a message from the server was not understood", kindOf(event.data));
    };
    socket.onclose = (event) => closed(event.code);
  };

  const onVisibility = () => {
    if (document.visibilityState !== "visible" || stopped) return;
    if (ws?.readyState === WebSocket.CONNECTING) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      clearTimeout(timer);
      return connect();
    }
    ws.send(JSON.stringify(options.hello()));
    probe();
  };
  document.addEventListener("visibilitychange", onVisibility);

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
      clearTimeout(timer);
      ws?.close();
    },
  };
}
