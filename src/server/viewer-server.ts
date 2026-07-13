import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
};

export async function serveViewer(viewerPath: string, port = 4317): Promise<void> {
  const root = resolve(viewerPath);
  if (!existsSync(resolve(root, "index.html"))) throw new Error(`Viewer not found: ${root}`);
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const requested = resolve(root, pathname === "/" ? "index.html" : `.${pathname}`);
    if (requested !== root && !requested.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end("Forbidden"); return;
    }
    if (!existsSync(requested) || !statSync(requested).isFile()) {
      response.writeHead(404).end("Not found"); return;
    }
    response.writeHead(200, { "content-type": mimeTypes[extname(requested)] ?? "application/octet-stream", "cache-control": "no-store" });
    createReadStream(requested).pipe(response);
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolvePromise());
  });
  console.log(`Atlas viewer: http://localhost:${port}`);
}
