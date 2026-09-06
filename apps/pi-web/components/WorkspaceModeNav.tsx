"use client";

import Link from "next/link";

export function WorkspaceModeNav({ active }: { active: "sessions" | "conversations" }) {
  const items = [
    { id: "sessions" as const, href: "/", label: "Pi Sessions" },
    { id: "conversations" as const, href: "/conversations", label: "Conversations" },
  ];
  return (
    <nav aria-label="Workspace mode" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: "8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
      {items.map((item) => <Link
        key={item.id}
        href={item.href}
        aria-current={active === item.id ? "page" : undefined}
        style={{
          minWidth: 0,
          padding: "6px 8px",
          borderRadius: 7,
          background: active === item.id ? "var(--bg-selected)" : "transparent",
          color: active === item.id ? "var(--text)" : "var(--text-muted)",
          fontSize: 12,
          fontWeight: active === item.id ? 600 : 500,
          textAlign: "center",
          textDecoration: "none",
        }}
      >{item.label}</Link>)}
    </nav>
  );
}
