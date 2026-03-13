import type { Context, Next } from "hono";
import type { Env, AppVariables, Logger, LogsRPC } from "../lib/types";

/** Creates a request-scoped logger that fans out to worker-logs RPC and console */
export async function loggerMiddleware(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: Next
): Promise<void | Response> {
  const requestId = crypto.randomUUID();
  c.set("requestId", requestId);

  const logsBinding = c.env.LOGS as LogsRPC | undefined;
  const appId = "agents-love-bitcoin";

  const logger: Logger = {
    info: (msg, ctx) => {
      console.log(`[${requestId}] ${msg}`, ctx ?? "");
      logsBinding?.info(appId, msg, { requestId, ...ctx }).catch(() => {});
    },
    warn: (msg, ctx) => {
      console.warn(`[${requestId}] ${msg}`, ctx ?? "");
      logsBinding?.warn(appId, msg, { requestId, ...ctx }).catch(() => {});
    },
    error: (msg, ctx) => {
      console.error(`[${requestId}] ${msg}`, ctx ?? "");
      logsBinding?.error(appId, msg, { requestId, ...ctx }).catch(() => {});
    },
    debug: (msg, ctx) => {
      console.debug(`[${requestId}] ${msg}`, ctx ?? "");
      logsBinding?.debug(appId, msg, { requestId, ...ctx }).catch(() => {});
    },
  };

  c.set("logger", logger);

  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  logger.info("request completed", {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration_ms: duration,
  });
}
