"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Thumb } from "@/components/primitives";

/** What a slide needs, and no more: the whole listing would ride to the client. */
export type HeroSlide = {
  slug: string;
  name: string;
  banner: string;
  /** Small caps over the name: "NEW", a category. */
  kicker: string;
  /** One line under the name. */
  line: string;
  seed: number;
};

const ADVANCE_MS = 6000;

/**
 * The big artwork at the top of Home, Apps and Games: one banner at a time,
 * snapping, with the name laid over the left of the picture and a "2/8"
 * counter in the corner. It moves on by itself until someone touches it —
 * after that it is theirs to swipe.
 */
export default function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);

  // The counter follows whichever slide is mostly in view, however it got there.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setIndex(Number((e.target as HTMLElement).dataset.i));
        }
      },
      { root: el, threshold: 0.6 }
    );
    for (const child of Array.from(el.children)) io.observe(child);
    return () => io.disconnect();
  }, [slides.length]);

  useEffect(() => {
    if (held || slides.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => {
      const el = track.current;
      if (!el || document.hidden) return;
      const next = (index + 1) % slides.length;
      const child = el.children[next] as HTMLElement | undefined;
      if (child) el.scrollTo({ left: child.offsetLeft - el.offsetLeft, behavior: "smooth" });
    }, ADVANCE_MS);
    return () => window.clearInterval(t);
  }, [held, index, slides.length]);

  if (slides.length === 0) return null;

  return (
    <section aria-roledescription="carousel" aria-label="Featured">
      <div
        ref={track}
        onPointerDown={() => setHeld(true)}
        onWheel={() => setHeld(true)}
        className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-[var(--pad)] px-[var(--pad)]"
      >
        {slides.map((s, i) => (
          <Link
            key={s.slug}
            href={`/app/${s.slug}`}
            data-i={i}
            aria-label={`${s.name}, ${i + 1} of ${slides.length}`}
            className="group relative w-full shrink-0 snap-start overflow-hidden rounded-[var(--radius-lg)] bg-[var(--card)] sm:w-[calc(50%-0.375rem)] lg:w-[calc(33.333%-0.5rem)]"
          >
            <Thumb
              seed={s.seed + 4}
              src={s.banner}
              alt=""
              className="aspect-[16/9] w-full transition duration-500 group-hover:scale-[1.02]"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/75 via-black/30 to-transparent" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
            <div className="absolute left-4 top-4 max-w-[70%] sm:left-5 sm:top-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/85">
                {s.kicker}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[22px] font-bold leading-tight text-white drop-shadow">
                {s.name}
              </p>
              {s.line ? (
                <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-white/85">
                  {s.line}
                </p>
              ) : null}
            </div>
          </Link>
        ))}
      </div>
      {slides.length > 1 && (
        <div className="pointer-events-none relative mx-[var(--pad)] h-0 sm:hidden">
          <span className="absolute -top-10 right-3 rounded-full bg-black/45 px-2.5 py-0.5 text-xs font-medium tabular-nums text-white backdrop-blur">
            {index + 1}/{slides.length}
          </span>
        </div>
      )}
    </section>
  );
}
