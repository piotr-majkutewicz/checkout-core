import { type DemoEnv, createApp } from "./demo/app.js";

// One app instance per isolate: order state is in memory (demo only, see createApp).
let app: ReturnType<typeof createApp> | undefined;

export default {
  fetch(request: Request, env: DemoEnv): Promise<Response> {
    app ??= createApp(env);
    return app(request);
  },
};
