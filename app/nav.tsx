"use client";

import { usePathname } from "next/navigation";

const LINKS = [
  ["dashboard", "/"],
  ["recommendations", "/recommendations"],
  ["topics", "/topics"],
  ["todo", "/todo"],
  ["plan", "/plan"],
  ["contests", "/contests"],
  ["trainer", "/trainer"],
  ["notes", "/notes"],
  ["settings", "/settings"],
] as const;

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="main">
      {LINKS.map(([label, href]) => (
        <a key={href} href={href} className={path === href ? "active" : ""}>
          {label}
        </a>
      ))}
    </nav>
  );
}
