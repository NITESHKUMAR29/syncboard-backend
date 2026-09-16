import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

// Node does not read .env on its own. Real environment variables already set win, so
// this only fills gaps during local development; in Docker and CI there is no .env file.
try {
  process.loadEnvFile();
} catch {
  // No .env file — the environment is expected to carry the variables already.
}

/**
 * Process entry point: validates the environment, starts listening, and shuts down
 * cleanly on SIGTERM/SIGINT within 10 seconds (NFR-7).
 */

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    // The logger does not exist yet, so this is the one place we write to stderr directly.
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const app = await buildApp({ env });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    app.log.info({ signal }, 'shutting down');

    // Never hang a deploy: if close() stalls, exit anyway.
    const timer = setTimeout(() => {
      app.log.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();

    // close() runs onClose hooks, which disconnect Prisma and close WebSockets.
    app.close().then(
      () => {
        app.log.info('shutdown complete');
        process.exit(0);
      },
      (error: unknown) => {
        app.log.error({ err: error }, 'error during shutdown');
        process.exit(1);
      },
    );
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'unhandled promise rejection');
  });

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (error) {
    app.log.error({ err: error }, 'failed to start server');
    process.exit(1);
  }
}

await main();
