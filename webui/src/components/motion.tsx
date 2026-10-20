"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/client";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/\\<>[]{}#*+=-_";

/** Scramble-decode title: settles character by character. */
export function Scramble({
  text,
  className,
  speed = 34,
  startDelay = 0,
  as: Tag = "span",
}: {
  text: string;
  className?: string;
  speed?: number;
  startDelay?: number;
  as?: "span" | "h1" | "h2" | "p" | "div";
}) {
  const [output, setOutput] = useState(text);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced.current) {
      setOutput(text);
      return;
    }
    let frame = 0;
    let raf = 0;
    let timer = 0;
    const total = text.length * 2 + 8;

    const tick = () => {
      frame += 1;
      const revealed = Math.floor(frame / 2);
      setOutput(
        text
          .split("")
          .map((char, index) => {
            if (char === " ") return " ";
            if (index < revealed) return char;
            return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          })
          .join(""),
      );
      if (frame < total) raf = window.setTimeout(tick, speed);
      else setOutput(text);
    };

    timer = window.setTimeout(tick, startDelay);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(raf);
    };
  }, [text, speed, startDelay]);

  return <Tag className={className}>{output}</Tag>;
}

/** Scroll reveal with IntersectionObserver; honours reduced motion. */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn("reveal", shown && "reveal-in", className)}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/** Streaming terminal type-out. */
export function TypeOut({
  text,
  className,
  cps = 42,
  onDone,
}: {
  text: string;
  className?: string;
  cps?: number;
  onDone?: () => void;
}) {
  const [count, setCount] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    setCount(0);
    done.current = false;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCount(text.length);
      onDone?.();
      return;
    }
    const step = Math.max(1, Math.round(text.length / 240));
    const interval = window.setInterval(() => {
      setCount((prev) => {
        const next = prev + step;
        if (next >= text.length) {
          window.clearInterval(interval);
          if (!done.current) {
            done.current = true;
            onDone?.();
          }
          return text.length;
        }
        return next;
      });
    }, 1000 / cps);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, cps]);

  return (
    <span className={className}>
      {text.slice(0, count)}
      {count < text.length ? <span className="ml-0.5 inline-block h-[1em] w-[0.5ch] animate-blip bg-ember align-middle" /> : null}
    </span>
  );
}

/** Listening waveform — 24 bars driven by real mic levels when available. */
export function Waveform({ active, level = 0, bars = 24 }: { active: boolean; level?: number; bars?: number }) {
  const seeds = useMemo(() => Array.from({ length: bars }, (_, i) => Math.sin(i * 1.7) * 0.5 + 0.5), [bars]);
  return (
    <div className="flex h-10 items-center gap-[3px]" aria-hidden>
      {seeds.map((seed, index) => (
        <span
          key={index}
          className={cn(
            "w-[3px] rounded-full transition-all duration-150",
            active ? "bg-ember" : "bg-line2",
          )}
          style={{
            height: `${Math.max(8, Math.min(100, (active ? 18 + seed * 62 + level * 90 * seed : 10 + seed * 6)))}%`,
            animation: active ? `blip ${0.9 + seed * 0.9}s ease-in-out ${index * 0.03}s infinite` : undefined,
            opacity: active ? 0.55 + seed * 0.45 : 0.6,
          }}
        />
      ))}
    </div>
  );
}

/** Slow breathing zoom for imagery. */
export function KenBurns({
  src,
  alt,
  className,
  duration = 22,
}: {
  src: string;
  alt: string;
  className?: string;
  duration?: number;
}) {
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setZoom(true);
    const interval = window.setInterval(() => setZoom((z) => !z), duration * 1000);
    return () => window.clearInterval(interval);
  }, [duration]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={cn("h-full w-full object-cover transition-transform ease-in-out", className)}
      style={{ transform: zoom ? "scale(1.07)" : "scale(1)", transitionDuration: `${duration}s` }}
    />
  );
}

/** Horizontal scan sweep used across panels. */
export function Scanline({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]", className)} aria-hidden>
      <div className="absolute inset-x-0 h-16 animate-scan bg-gradient-to-b from-transparent via-ember/8 to-transparent" />
    </div>
  );
}

export function CountUp({ value, className, suffix = "" }: { value: number; className?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const started = performance.now();
    const duration = 900;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      setDisplay(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <span className={className}>
      {display}
      {suffix}
    </span>
  );
}
