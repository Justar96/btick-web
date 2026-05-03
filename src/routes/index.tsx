import { lazy, Suspense, useEffect, useRef, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { symbolsOptions } from "@/api/queries";
import styles from "./index.module.css";

const BitcoinCoin3D = lazy(() =>
  import("@/components/BitcoinCoin3D").then((m) => ({
    default: m.BitcoinCoin3D,
  })),
);

function symbolToSlug(symbol: string) {
  return symbol.toLowerCase().replace(/\//g, "-");
}

/** Clamp v to [0, 1]. */
function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

export function HomePage() {
  const { data: symbols } = useQuery(symbolsOptions());
  const firstSlug = symbols?.[0] ? symbolToSlug(symbols[0]) : "btc-usd";

  const heroRef = useRef<HTMLDivElement>(null);
  const coinRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLSpanElement>(null);
  const belowRef = useRef<HTMLDivElement>(null);
  // How far right coin needs to move to center above "btick" text
  const flipXRef = useRef(0);
  // Speed multiplier for 3D coin spin — written by scroll handler, read by useFrame
  const spinSpeedRef = useRef(1);

  const measure = useCallback(() => {
    const coin = coinRef.current;
    const logo = logoRef.current;
    if (!coin || !logo) return;
    const cr = coin.getBoundingClientRect();
    const lr = logo.getBoundingClientRect();
    flipXRef.current = lr.left + lr.width / 2 - (cr.left + cr.width / 2);
  }, []);

  const onScroll = useCallback(() => {
    const hero = heroRef.current;
    const coin = coinRef.current;
    const logo = logoRef.current;
    const below = belowRef.current;
    if (!hero || !coin || !logo || !below) return;

    const scrolled = -hero.getBoundingClientRect().top;
    const vh = window.innerHeight;
    const t = clamp01(scrolled / vh);

    // Flip arc progress — coin moves to above "btick" by 50% scroll
    const flipT = clamp01(t / 0.5);
    const eased = flipT * flipT * (3 - 2 * flipT); // smoothstep

    // Coin slides straight right to cover "btick" text
    const coinX = flipXRef.current * 1.6 * eased;
    const scale = 1 + eased * 0.15;
    coin.style.transform = `translate(${coinX}px, 0px) scale(${scale})`;

    // Spin speed ramps from 1x to 6x over the hero fade range
    spinSpeedRef.current = 1 + clamp01(t / 0.7) ** 2.5 * 5;

    // Text fades out later — coin overlaps text before it disappears
    const textAlpha = 1 - clamp01(t / 0.7);
    logo.style.opacity = String(textAlpha);
    below.style.opacity = String(textAlpha);
    below.style.pointerEvents = textAlpha < 0.1 ? "none" : "";
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
    };
  }, [onScroll, measure]);

  return (
    <>
      <div ref={heroRef} className={styles.hero}>
        <div className={styles.logoRow}>
          <div ref={coinRef} className={styles.coin}>
            <Suspense fallback={null}>
              <BitcoinCoin3D size={90} className={styles.coinCanvas} speedRef={spinSpeedRef} />
            </Suspense>
          </div>
          <span ref={logoRef} className={styles.logo}>btick</span>
        </div>
        <div ref={belowRef} className={styles.below}>
          <span className={styles.tagline}>
            Real-time price feeds, sub-second delivery
          </span>
          <div className={styles.actions}>
            <Link
              to="/$symbol"
              params={{ symbol: firstSlug }}
              className={`${styles.cta} ${styles.ctaLive}`}
            >
              View live feed
            </Link>
          </div>
        </div>
      </div>

    </>
  );
}
