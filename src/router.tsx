import { createRouter, createRoute, createRootRoute } from "@tanstack/react-router";
import { RootLayout } from "./routes/__root";
import { HomePage } from "./routes/index";
import { CoinPage } from "./routes/coin.$symbol";
import { DemoPage } from "./routes/demo";

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const coinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$symbol",
  component: CoinPage,
});

const demoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/demo",
  component: DemoPage,
});

const routeTree = rootRoute.addChildren([indexRoute, coinRoute, demoRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
