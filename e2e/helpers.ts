import { expect, type Browser, type Page } from "@playwright/test";
import { parseServerMessage, type Command, type NormalizedMedia, type PlayerState, type ServerMessage } from "../src/shared";

/** Open /tv in its own browser context (its own storage, like a separate device) and press OK. */
export async function openTv(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await page.goto("/tv");
  await page.getByTestId("unlock").focus();
  await page.keyboard.press("Enter"); // the remote's OK button
  return page;
}

export async function readPairingCode(tv: Page): Promise<string> {
  const text = await tv.getByTestId("pairing-code").textContent();
  return text!.replace(/\s/g, "");
}

export async function openPairedPhone(browser: Browser, tv: Page): Promise<Page> {
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.goto("/");
  await phone.getByTestId("code-input").fill(await readPairingCode(tv)); // connects by itself on the sixth digit
  await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
  return phone;
}

export const tvRoot = (tv: Page) => tv.getByTestId("tv");
export const tvTime = async (tv: Page) => Number(await tvRoot(tv).getAttribute("data-time"));

/** A phone speaking the raw protocol, to verify the exact command sequence without the UI in between. */
export class RawPhone {
  readonly states: PlayerState[] = [];
  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (event) => {
      const message: ServerMessage | null = parseServerMessage(event.data);
      if (message?.type === "STATE") this.states.push(message.state);
    };
  }
  static async connect(baseURL: string, code: string): Promise<RawPhone> {
    const ws = new WebSocket(baseURL.replace("http", "ws") + "/ws");
    await new Promise((resolve) => (ws.onopen = resolve));
    const phone = new RawPhone(ws);
    ws.send(JSON.stringify({ type: "CTL_HELLO" }));
    ws.send(JSON.stringify({ type: "PAIR", code }));
    return phone;
  }
  cmd(command: Command) {
    this.ws.send(JSON.stringify({ type: "CMD", command }));
  }
  /** What the phone's "play" button sends: the server resolves the link, then tells the TV to load it. */
  playUrl(url: string, startAt?: number) {
    this.ws.send(JSON.stringify({ type: "PLAY_URL", url, ...(startAt === undefined ? {} : { startAt }) }));
  }
  close() {
    this.ws.close();
  }
}

/**
 * Hand a video to the TV the way a resolver would, from the phone page itself (a second socket on the phone's own
 * identity), then reload the page so it shows what the server now holds. For tests that need a series with an episode list.
 */
export async function loadOnTv(phone: Page, media: NormalizedMedia): Promise<void> {
  await phone.evaluate(async (media) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    await new Promise((resolve) => (ws.onopen = resolve));
    ws.send(JSON.stringify({ type: "CTL_HELLO", controllerId: localStorage.getItem("controller.id") }));
    ws.send(JSON.stringify({ type: "CMD", command: { type: "LOAD", media } }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    ws.close();
  }, media);
  await phone.reload();
}
