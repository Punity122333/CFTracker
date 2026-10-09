"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSelection, hideSelected, rateSelected } from "@/lib/selection";

// Ctrl+K palette + vim keys (j/k/x/o///, e/r/h/d, ?) + timer helpers.
// Row keys and palette rating actions need a selected row (click any
// recommendation or todo item first). Never fires while typing in inputs.
export default function ClientShell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [q, setQ] = useState("");
  const [flash, setFlash] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      const typing =
        t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (typing) return;
      if (e.key === "?") setHelp((v) => !v);
      if (e.key === "/") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
      }
      const k = e.key.toLowerCase();
      if (k === "e" || k === "r" || k === "h" || k === "d") {
        if (!getSelection()) return; // only acts on a selected row
        e.preventDefault();
        void (async () => {
          if (k === "d") {
            const ok = await hideSelected();
            setFlash(ok ? "hidden" : "nothing selected");
          } else {
            const ok = await rateSelected(k === "e" ? "easy" : k === "r" ? "right" : "hard");
            setFlash(ok ? `rated ${k === "e" ? "easy" : k === "r" ? "right" : "hard"}` : "nothing selected");
          }
          setTimeout(() => setFlash(""), 1500);
        })();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open && !help && !flash) return null;

  const go = (href: string) => {
    router.push(href);
    setOpen(false);
  };

  const items: { label: string; run: () => void }[] = [
    { label: "dashboard", run: () => go("/") },
    { label: "recommendations", run: () => go("/recommendations") },
    { label: "topics", run: () => go("/topics") },
    { label: "todo", run: () => go("/todo") },
    { label: "contests", run: () => go("/contests") },
    { label: "trainer", run: () => go("/trainer") },
    { label: "notes", run: () => go("/notes") },
    { label: "settings", run: () => go("/settings") },
    { label: "open skill page", run: () => go("/skill") },
    { label: "open plan", run: () => go("/plan") },
    { label: "generate plan", run: () => go("/plan?generate=1") },
    { label: "start warmup", run: () => go("/contests?warmup=1") },
    {
      label: "rate selected easy",
      run: () => { void rateSelected("easy").then(() => setOpen(false)); },
    },
    {
      label: "rate selected right",
      run: () => { void rateSelected("right").then(() => setOpen(false)); },
    },
    {
      label: "rate selected hard",
      run: () => { void rateSelected("hard").then(() => setOpen(false)); },
    },
    {
      label: "hide selected",
      run: () => { void hideSelected().then(() => setOpen(false)); },
    },
  ].filter((it) => it.label.includes(q.toLowerCase()));

  return (
    <div>
      {flash && (
        <div style={{ borderTop: "1px solid var(--hairline)", padding: 8 }} className="mono small">
          {flash}
        </div>
      )}
      {help && (
        <div style={{ borderTop: "1px solid var(--hairline)", padding: 16 }} className="mono small">
          <p>shortcuts: <kbd className="chip">j</kbd>/<kbd className="chip">k</kbd> move, <kbd className="chip">x</kbd> toggle, <kbd className="chip">o</kbd> open link, <kbd className="chip">/</kbd> search, <kbd className="chip">ctrl+k</kbd> palette, <kbd className="chip">?</kbd> this help</p>
          <p>on a selected row (click it first): <kbd className="chip">e</kbd> easy, <kbd className="chip">r</kbd> right, <kbd className="chip">h</kbd> hard, <kbd className="chip">d</kbd> hide</p>
          <button className="btn" onClick={() => setHelp(false)}>close</button>
        </div>
      )}
      {open && (
        <div style={{ borderTop: "1px solid var(--hairline)", padding: 16 }}>
          <input
            type="text"
            autoFocus
            placeholder="jump, generate plan, start warmup…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && items[0]) {
                items[0].run();
              }
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <ul className="plain">
            {items.map((it) => (
              <li key={it.label}>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    it.run();
                  }}
                >
                  {it.label}
                </a>
              </li>
            ))}
          </ul>
          <p className="small muted">press ? for all shortcuts. esc closes.</p>
        </div>
      )}
    </div>
  );
}
