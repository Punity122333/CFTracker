import type { Metadata } from "next";
import "./globals.css";
import ClientShell from "./client-shell";
import Nav from "./nav";

export const metadata: Metadata = {
  title: "cftracker",
  description: "local-first competitive programming tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-head">
          <div className="site-head-inner">
            <div className="brand-row">
              <span className="brand-mark" aria-hidden="true" />
              <a href="/" className="wordmark">
                cf<span>tracker</span>
              </a>
            </div>
            <p className="tagline">local-first cp progress · codeforces / cses / atcoder</p>
            <Nav />
          </div>
        </header>
        <main className="page">
          {children}
        </main>
        <footer className="site-foot">
          <div className="site-foot-inner">
            <span>cftracker — single user, no accounts</span>
            <span>data lives in this browser · export in settings</span>
          </div>
        </footer>
        <ClientShell />
      </body>
    </html>
  );
}
