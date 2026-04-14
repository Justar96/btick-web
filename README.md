# btick-web

Frontend for [btick](https://btick.justarr.com/) — a real-time crypto reference price dashboard.

React 19 + TypeScript. Connects to the btick backend via WebSocket for live prices and REST for historical data.

## Stack

- **React 19** with **TanStack Router** (code-based routes) + **TanStack Query**
- **Liveline** for the real-time animated price chart
- **openapi-fetch** for type-safe REST calls (types generated from OpenAPI spec)
- **CSS Modules** — no Tailwind, no CSS-in-JS
- **Vite 6**, **Bun** as package manager
- **Three.js** via react-three-fiber for the 3D coin on the home page

## Setup

```bash
bun install
bun run dev
```

Dev server runs on `http://localhost:5173` and proxies `/v1` + `/ws` to `localhost:8080` (the Go backend).

To point at a different backend:

```bash
VITE_API_URL=https://btick.justarr.com bun run dev
```

## Scripts

```bash
bun run dev       # Vite dev server with HMR
bun run build     # tsc + vite build → dist/
bun run preview   # Serve production build locally
bun run generate  # Regenerate API types from OpenAPI spec
```

## Project Structure

```
src/
  main.tsx              # React root
  router.tsx            # Route definitions (/, /$symbol, /api)
  api/
    client.ts           # openapi-fetch instance
    queries.ts          # TanStack Query option factories
    schema.d.ts         # Generated types (do not hand-edit)
  ws/
    context.tsx         # WebSocketProvider — bridges WS into React state + query cache
    useWebSocket.ts     # Auto-reconnect hook with backoff
    useIntegrityStatus.ts # Connection health monitoring
    types.ts            # WS message types
  components/
    PriceDisplay.tsx    # Large canonical price + quality indicator
    PriceChart.tsx      # Liveline real-time chart
    SourceList.tsx      # Per-exchange price tiles
    SourcePanel.tsx     # Detailed exchange view
    FeedInfo.tsx        # Exchange health info
    Sidebar.tsx         # Symbol selector
    BitcoinCoin3D.tsx   # 3D spinning coin (home page)
    CoinIcon.tsx        # SVG coin icons
    StatusDot.tsx       # Connection status indicator
  routes/               # Route components with co-located CSS Modules
  styles/               # Global CSS, custom properties
```

## Data Flow

WebSocket is the primary data source for live prices. REST is used for historical data and initial loads.

```
WebSocketProvider → React state (prices, source prices, connection status)
       │
       └→ TanStack Query cache (so useQuery consumers get live updates without polling)
```

The provider subscribes to `latest_price`, `snapshot_1s`, `source_price`, and `source_status` message types from the backend.

## Deploy

Docker build with Caddy for static serving + SPA fallback:

```bash
docker build --build-arg VITE_API_URL=https://your-api.com -t btick-web .
docker run -p 3000:3000 btick-web
```

## License

MIT
