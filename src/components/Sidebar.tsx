import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { symbolsOptions } from "@/api/queries";
import { CoinIcon } from "./CoinIcon";
import styles from "./Sidebar.module.css";

function symbolToSlug(symbol: string) {
  return symbol.toLowerCase().replace(/\//g, "-");
}

export function Sidebar() {
  const { symbol: activeSlug } = useParams({ strict: false }) as { symbol?: string };
  const { data: symbols } = useQuery(symbolsOptions());

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <Link to="/">btick</Link>
      </div>

      <nav className={styles.nav}>
        {(symbols ?? []).map((sym) => {
          const slug = symbolToSlug(sym);
          const isActive = slug === activeSlug;
          return (
            <Link
              key={sym}
              to="/$symbol"
              params={{ symbol: slug }}
              className={`${styles.navLink} ${isActive ? styles.navLinkActive : ""}`}
            >
              <CoinIcon symbol={sym} size={14} className={styles.coinIcon} />
              <span>{sym.replace("/", " / ")}</span>
            </Link>
          );
        })}
      </nav>

      <div className={styles.spacer} />
    </aside>
  );
}
