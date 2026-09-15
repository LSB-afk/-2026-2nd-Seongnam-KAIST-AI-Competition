import type { WorkspaceView } from "@/lib/workspace-state";

export default function WorkspaceNavIcon({ view }: { view: WorkspaceView }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {view === "dashboard" && <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M9 3v18M9 10h12" /></>}
    {view === "explore" && <><circle cx="12" cy="12" r="9" /><path d="m16 8-2.4 5.6L8 16l2.4-5.6L16 8Z" /></>}
    {view === "diorama" && <><path d="m12 2 9 5v10l-9 5-9-5V7l9-5ZM3 7l9 5 9-5M12 12v10" /><path d="m7.5 4.5 9 5" /></>}
    {view === "saved" && <path d="M12 20 4.4 12.6C-.6 7.8 6.4 1.8 12 7c5.6-5.2 12.6.8 7.6 5.6L12 20Z" />}
    {view === "studio" && <><rect x="6" y="3" width="15" height="17" rx="2" /><path d="M3 7v13a3 3 0 0 0 3 3M10 8h7M10 12h7M10 16h4" /></>}
    {view === "history" && <><path d="M3 10a9 9 0 1 1 1.7 7M3 4v6h6M12 7v5l3 2" /></>}
    {view === "agent" && <><rect x="4" y="7" width="16" height="13" rx="4" /><path d="M12 3v4M1 12v4M23 12v4M9 16h6" /><circle cx="9" cy="12" r=".7" fill="currentColor" /><circle cx="15" cy="12" r=".7" fill="currentColor" /></>}
  </svg>;
}
