// What the tests (src/server/edgeStreamWorker.test.ts) and the e2e relay test see of the worker: a Cloudflare module worker, which Node can run too.
declare const worker: { fetch(request: Request, env?: unknown, ctx?: unknown): Promise<Response> };
export default worker;
