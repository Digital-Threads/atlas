import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
};
const securityHeaders = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

export async function serveViewer(viewerPath: string, port = 4317): Promise<Server> {
  const requestedRoot = resolve(viewerPath);
  const root = await realpath(requestedRoot).catch(() => {
    throw new Error(`Viewer not found: ${requestedRoot}`);
  });
  const indexStat = await stat(resolve(root, "index.html")).catch(() => null);
  if (!indexStat?.isFile()) throw new Error(`Viewer not found: ${requestedRoot}`);

  const server = createServer((request, response) => {
    void handleRequest(root, request, response).catch(() => {
      if (response.headersSent) response.destroy();
      else send(response, 500, "Internal server error");
    });
  });
  await new Promise<void>((resolvePromise, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolvePromise();
    });
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`Atlas viewer: http://localhost:${actualPort}`);
  return server;
}

async function handleRequest(root: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("allow", "GET, HEAD");
    send(response, 405, "Method not allowed");
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  } catch {
    send(response, 400, "Bad request");
    return;
  }

  const requested = resolve(root, pathname === "/" ? "index.html" : `.${pathname}`);
  if (!isInside(root, requested)) {
    send(response, 403, "Forbidden");
    return;
  }

  let canonicalPath: string;
  try {
    const requestedStat = await stat(requested);
    if (!requestedStat.isFile()) {
      send(response, 404, "Not found");
      return;
    }
    canonicalPath = await realpath(requested);
  } catch (error) {
    const missing = isMissingFile(error);
    send(response, missing ? 404 : 500, missing ? "Not found" : "Unable to read file");
    return;
  }
  if (!isInside(root, canonicalPath)) {
    send(response, 403, "Forbidden");
    return;
  }

  response.writeHead(200, { "content-type": mimeTypes[extname(canonicalPath)] ?? "application/octet-stream" });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = createReadStream(canonicalPath);
  stream.once("error", () => response.destroy());
  stream.pipe(response);
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && ["ENOENT", "ENOTDIR"].includes(String(error.code));
}

function send(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
}
