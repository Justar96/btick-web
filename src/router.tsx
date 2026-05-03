import { createRouter, createRoute, createRootRoute } from "@tanstack/react-router";
import { RootLayout } from "./routes/__root";
import { HomePage } from "./routes/index";
import { CoinPage } from "./routes/coin.$symbol";

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

const routeTree = rootRoute.addChildren([indexRoute, coinRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
