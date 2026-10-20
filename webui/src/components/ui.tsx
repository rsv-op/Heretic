"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/client";
import { Alert, Check, Cross } from "@/components/Icons";

/* ------------------------------------------------------------------ toasts */

type ToastTone = "success" | "error" | "info";
interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
}

const ToastContext = createContext<{
  push: (tone: ToastTone, title: string, detail?: string) => void;
} | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((tone: ToastTone, title: string, detail?: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, tone, title, detail }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5200);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[90] flex w-[min(23rem,calc(100vw-2.5rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              "pointer-events-auto animate-rise overflow-hidden rounded-lg border bg-panel/95 p-3 backdrop-blur-md",
              toast.tone === "success" && "border-mint/35",
              toast.tone === "error" && "border-rose/40",
              toast.tone === "info" && "border-line2",
            )}
          >
            <div className="flex items-start gap-2.5">
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded",
                  toast.tone === "success" && "bg-mint/15 text-mint",
                  toast.tone === "error" && "bg-rose/15 text-rose",
                  toast.tone === "info" && "bg-ember/15 text-embersoft",
                )}
              >
                {toast.tone === "error" ? <Alert width={13} height={13} /> : <Check width={13} height={13} />}
              </span>
              <div className="min-w-0">
                <p className="font-display text-[13px] font-semibold tracking-tight text-chalk">{toast.title}</p>
                {toast.detail ? <p className="mt-0.5 text-xs leading-relaxed text-ash">{toast.detail}</p> : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                className="ml-auto text-ash2 transition hover:text-chalk"
              >
                <Cross width={14} height={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ------------------------------------------------------------------ buttons */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger" | "mint";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = "outline",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "group relative inline-flex items-center justify-center gap-2 rounded-md font-display font-semibold tracking-tight transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "px-2.5 py-1.5 text-[12px]",
        size === "md" && "px-3.5 py-2 text-[13px]",
        size === "lg" && "px-5 py-2.5 text-sm",
        variant === "primary" &&
          "bg-ember text-[#170a02] shadow-[0_10px_30px_-14px_rgba(255,122,24,0.9)] hover:bg-embersoft hover:shadow-[0_14px_38px_-12px_rgba(255,122,24,0.95)] active:translate-y-px",
        variant === "mint" && "bg-mint/15 text-mint ring-1 ring-inset ring-mint/35 hover:bg-mint/25",
        variant === "outline" && "border border-line2 bg-panel2/60 text-chalk hover:border-ember/50 hover:bg-panel2 hover:text-embersoft",
        variant === "ghost" && "text-ash hover:bg-white/5 hover:text-chalk",
        variant === "danger" && "border border-rose/35 bg-rose/10 text-rose hover:bg-rose/20",
        className,
      )}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.6px] border-current border-t-transparent",
        className,
      )}
    />
  );
}

/* ------------------------------------------------------------------ surfaces */

export function Panel({
  children,
  className,
  glow,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  as?: "div" | "section" | "article" | "aside";
}) {
  return (
    <Tag
      className={cn(
        "relative rounded-xl border border-line bg-panel/75 hairline backdrop-blur-[2px]",
        glow && "ember-glow",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  right,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.28em] text-ember/85">{eyebrow}</p>
        ) : null}
        <h2 className="font-display text-xl font-semibold tracking-tight text-chalk sm:text-[1.6rem]">{title}</h2>
        {description ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ash">{description}</p> : null}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </div>
  );
}

type BadgeTone = "ember" | "mint" | "signal" | "rose" | "ice" | "neutral";

export function Badge({
  children,
  tone = "neutral",
  className,
  dot,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  dot?: boolean;
}) {
  const tones: Record<BadgeTone, string> = {
    ember: "border-ember/35 bg-ember/12 text-embersoft",
    mint: "border-mint/35 bg-mint/12 text-mint",
    signal: "border-signal/35 bg-signal/12 text-signal",
    rose: "border-rose/35 bg-rose/12 text-rose",
    ice: "border-ice/35 bg-ice/12 text-ice",
    neutral: "border-line2 bg-white/[0.03] text-ash",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-[3px] font-mono text-[10.5px] uppercase tracking-[0.14em]",
        tones[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current animate-blip" /> : null}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ inputs */

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-ash">{label}</span>
        {hint ? <span className="text-[11px] text-ash2">{hint}</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1.5 block text-[12px] text-rose">{error}</span> : null}
    </label>
  );
}

const fieldBase =
  "w-full rounded-md border bg-abyss/80 px-3 py-2 text-sm text-chalk placeholder:text-ash2/70 transition focus:border-ember/60 focus:bg-abyss focus:outline-none";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(fieldBase, "border-line2", className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(fieldBase, "border-line2 font-mono text-[13px] leading-relaxed", className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cn(fieldBase, "border-line2 appearance-none pr-8", className)}>
      {children}
    </select>
  );
}

/* ------------------------------------------------------------------ modal */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={onClose}
        role="presentation"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative w-full animate-rise overflow-hidden rounded-t-2xl border border-line2 bg-panel shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)] sm:rounded-xl",
          width,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line bg-panel2/60 px-5 py-4">
          <div>
            <h3 className="font-display text-base font-semibold tracking-tight text-chalk">{title}</h3>
            {subtitle ? <p className="mt-1 text-xs text-ash">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="text-ash2 transition hover:text-chalk">
            <Cross width={18} height={18} />
          </button>
        </header>
        <div className="max-h-[min(70vh,40rem)] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex justify-end gap-2 border-t border-line bg-panel2/40 px-5 py-3">{footer}</footer> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ states */

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="relative mb-4">
        <span className="absolute inset-0 rounded-full bg-ember/15 blur-xl" />
        <span className="relative flex h-14 w-14 items-center justify-center rounded-lg border border-line2 bg-panel2 text-ember">
          {icon}
        </span>
      </div>
      <h3 className="font-display text-base font-semibold tracking-tight text-chalk">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-ash">{body}</p>
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer-pending rounded-md border border-line bg-panel2/60", className)} />;
}

export function LoadingRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function ProgressBar({
  value,
  tone = "ember",
  className,
  label,
}: {
  value: number;
  tone?: "ember" | "mint" | "rose" | "signal";
  className?: string;
  label?: string;
}) {
  const tones = { ember: "bg-ember", mint: "bg-mint", rose: "bg-rose", signal: "bg-signal" } as const;
  return (
    <div className={cn("w-full", className)}>
      {label ? (
        <div className="mb-1 flex justify-between font-mono text-[10.5px] uppercase tracking-[0.16em] text-ash2">
          <span>{label}</span>
          <span className="text-ash">{Math.round(value)}%</span>
        </div>
      ) : null}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className={cn("h-full rounded-full transition-[width] duration-700 ease-out", tones[tone])}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = "ember",
  pending,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: ReactNode;
  tone?: BadgeTone;
  pending?: boolean;
}) {
  const accent = {
    ember: "text-ember",
    mint: "text-mint",
    signal: "text-signal",
    rose: "text-rose",
    ice: "text-ice",
    neutral: "text-ash",
  }[tone];
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border border-line bg-panel/70 p-4 transition-colors hover:border-line2",
        pending && "shimmer-pending",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-ash2">{label}</p>
        <span className={cn("opacity-70 transition-opacity group-hover:opacity-100", accent)}>{icon}</span>
      </div>
      <p className={cn("mt-2.5 font-display text-[1.9rem] font-semibold leading-none tracking-tight", accent)}>
        {value}
      </p>
      {sub ? <p className="mt-2 text-xs leading-relaxed text-ash">{sub}</p> : null}
    </div>
  );
}

export function KeyValue({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line/70">
      {rows.map(([key, value]) => (
        <div key={key} className="flex items-start justify-between gap-4 py-2.5">
          <dt className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-ash2">{key}</dt>
          <dd className="max-w-[62%] text-right text-[13px] text-chalk">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
      className="inline-flex items-center gap-1.5 rounded border border-line2 px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ash transition hover:border-ember/50 hover:text-embersoft"
    >
      {copied ? <Check width={12} height={12} /> : null}
      {copied ? "Copied" : label}
    </button>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Delete",
  onCancel,
  onConfirm,
  busy,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ash">{body}</p>
    </Modal>
  );
}
