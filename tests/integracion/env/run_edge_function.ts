// Arranque aislado de una Edge Function de EvaluEdu sobre puerto HTTP dedicado.
// Uso: deno run --allow-net --allow-env run_edge_function.ts <port> <entry_file_abs_or_rel>

const [portStr, entryPath] = Deno.args;
const port = Number(portStr);
if (!Number.isInteger(port) || port <= 0 || !entryPath) {
  console.error('Uso: run_edge_function.ts <port> <entryPath>');
  Deno.exit(1);
}

let capturedHandler: ((req: Request) => Response | Promise<Response>) | null = null;
const originalServe = Deno.serve.bind(Deno);

// Interceptar Deno.serve(handler) antes de importar la función para asignarle el puerto local aislado.
(Deno as unknown as { serve: (...args: unknown[]) => unknown }).serve = (
  arg1: unknown,
  arg2?: unknown,
) => {
  const handler = typeof arg1 === 'function' ? arg1 : arg2;
  if (typeof handler !== 'function') {
    throw new Error('La Edge Function no registró un handler Deno.serve válido.');
  }
  capturedHandler = handler as (req: Request) => Response | Promise<Response>;
  return {
    finished: new Promise<void>(() => {}),
    shutdown: async () => {},
    ref() {},
    unref() {},
    addr: { transport: 'tcp', hostname: '127.0.0.1', port },
  };
};

const moduleUrl = entryPath.startsWith('file://') ? entryPath : `file://${entryPath}`;
await import(moduleUrl);

if (!capturedHandler) {
  console.error(`Edge Function ${entryPath} no invocó Deno.serve.`);
  Deno.exit(1);
}

const activeHandler = capturedHandler;
originalServe(
  {
    hostname: '127.0.0.1',
    port,
    onListen: ({ hostname, port: p }) => {
      console.log(`EDGE_READY port=${p} host=${hostname} entry=${entryPath}`);
    },
  },
  (request: Request) => activeHandler(request),
);
