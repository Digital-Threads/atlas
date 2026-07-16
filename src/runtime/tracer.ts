import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { GraphEdgeType, RuntimeTraceEvent } from "../core/types.js";

export interface RuntimeTracerOptions {
  outputPath?: string;
  flushIntervalMs?: number;
}

export class RuntimeTracer {
  private readonly outputPath: string;
  private readonly flushIntervalMs: number;
  private readonly pending = new Map<string, RuntimeTraceEvent>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: RuntimeTracerOptions = {}) {
    this.outputPath = resolve(options.outputPath ?? ".atlas/runtime.jsonl");
    this.flushIntervalMs = Math.max(50, options.flushIntervalMs ?? 1000);
  }

  record(event: RuntimeTraceEvent): void {
    if (!event.from || !event.to || !event.type) return;
    const key = `${event.from}|${event.type}|${event.to}`;
    const current = this.pending.get(key);
    this.pending.set(key, {
      ...current,
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
      count: (current?.count ?? 0) + Math.max(1, event.count ?? 1),
      durationMs: (current?.durationMs ?? 0) + Math.max(0, event.durationMs ?? 0),
      metadata: { ...current?.metadata, ...event.metadata },
    });
    this.scheduleFlush();
  }

  edge(from: string, to: string, type: GraphEdgeType, metadata?: Record<string, unknown>): void {
    this.record({ from, to, type, metadata });
  }

  async flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.pending.size) return;
    const events = [...this.pending.values()];
    this.pending.clear();
    await mkdir(dirname(this.outputPath), { recursive: true });
    await appendFile(this.outputPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushIntervalMs);
    this.flushTimer.unref?.();
  }
}

interface NestExecutionContextLike {
  getClass(): { name?: string };
  getHandler(): { name?: string };
  getType?(): string;
  switchToHttp?(): { getRequest(): { method?: string; baseUrl?: string; route?: { path?: string }; url?: string } };
  switchToRpc?(): { getContext(): { getPattern?(): unknown; pattern?: unknown } };
}

interface NestCallHandlerLike {
  handle(): unknown;
}

export function createNestRuntimeInterceptor(tracer: RuntimeTracer) {
  return {
    intercept(context: NestExecutionContextLike, next: NestCallHandlerLike): unknown {
      const className = context.getClass()?.name || "UnknownController";
      const handlerName = context.getHandler()?.name || "unknown";
      const methodId = `method:${className}.${handlerName}`;
      const contextType = context.getType?.() ?? "unknown";
      if (contextType === "http" && context.switchToHttp) {
        const request = context.switchToHttp().getRequest();
        const httpMethod = String(request.method ?? "ALL").toUpperCase();
        const routePath = joinRoute(request.baseUrl ?? "", request.route?.path ?? request.url?.split("?")[0] ?? "/");
        tracer.record({
          from: `route:${httpMethod}:${routePath}`,
          to: methodId,
          type: "handles",
          fromNode: { id: `route:${httpMethod}:${routePath}`, type: "route", label: `${httpMethod} ${routePath}` },
          toNode: { id: methodId, type: "method", label: `${className}.${handlerName}` },
          metadata: { transport: "http", observed: true },
        });
      } else if (contextType === "rpc" && context.switchToRpc) {
        const rpc = context.switchToRpc().getContext();
        const pattern = String(rpc?.getPattern?.() ?? rpc?.pattern ?? "unknown");
        const topicId = `message_topic:${pattern}`;
        tracer.record({
          from: topicId,
          to: methodId,
          type: "delivers_to",
          fromNode: { id: topicId, type: "message_topic", label: pattern },
          toNode: { id: methodId, type: "method", label: `${className}.${handlerName}` },
          metadata: { transport: "rpc", observed: true },
        });
      }
      return next.handle();
    },
  };
}

function joinRoute(...parts: string[]): string {
  const joined = `/${parts.join("/")}`.replace(/\/+/g, "/");
  return joined.length > 1 && joined.endsWith("/") ? joined.slice(0, -1) : joined;
}
