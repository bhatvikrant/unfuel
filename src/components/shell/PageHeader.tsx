import { ChevronLeft } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Back to the screen this one was opened from; `fallback` when there is none (opened by a link or a reload). */
export function useGoBack() {
  const nav = useNavigate();
  return (fallback = "/") => {
    if (window.history.state?.idx > 0) nav(-1);
    else nav(fallback, { replace: true });
  };
}

export function PageHeader({ title, back, right, className }: { title: string; back?: boolean | string; right?: ReactNode; className?: string }) {
  const goBack = useGoBack();
  // the tab and the screen reader say which screen this is
  useEffect(() => {
    const before = document.title;
    document.title = `${title} · Unfuel`;
    return () => { document.title = before; };
  }, [title]);
  return (
    <header className={cn("sticky top-0 z-30 border-b bg-background", className)}>
      <div className="mx-auto flex h-12 max-w-3xl items-center gap-1 px-2">
        <div className="flex w-20 min-w-0 shrink-0 items-center">
          {back ? (
            <Button variant="ghost" size="icon" aria-label="Back" onClick={() => goBack(typeof back === "string" ? back : undefined)}>
              <ChevronLeft className="size-5" />
            </Button>
          ) : null}
        </div>
        <h1 className="min-w-0 flex-1 truncate text-center font-semibold">{title}</h1>
        <div className="flex w-20 shrink-0 items-center justify-end gap-0.5">{right}</div>
      </div>
    </header>
  );
}

/** The column every screen's content sits in: phone width up to a comfortable reading width, never wider than the window. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-3xl min-w-0 px-4 py-4", className)}>{children}</div>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("min-w-0 rounded-xl bg-card p-4 shadow-card", className)}>{children}</section>;
}

/** A plain statement of what a screen is waiting for or does not have yet, with what to do about it. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children ? <p className="max-w-sm text-sm text-muted-foreground">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
