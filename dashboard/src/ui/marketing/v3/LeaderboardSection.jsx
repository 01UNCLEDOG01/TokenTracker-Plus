import React, { useLayoutEffect, useRef } from "react";
import { gsap } from "./gsap.js";
import { BorderGlow } from "../components/BorderGlow.jsx";
import { AGENT_LOGOS } from "../agent-logos.js";
import { LIMIT_PROVIDER_IDS } from "../../../lib/limits-providers.js";
import { PERK_PROVIDERS } from "../../../data/perksData.js";
import { REPO_URL } from "../../../lib/config";
import { LV3 } from "./palette.js";

/**
 * "What TT-plus parses out of the box" — static product-fact rows rendered in
 * the visual language of the old community-leaderboard podium. The upstream
 * section it replaces fetched a global leaderboard that does not exist for
 * TT-plus (cloud is optional and self-hosted), so public visitors always saw
 * skeleton rows; every number here is derived from the code's own registries,
 * the same truth the discovery-metadata and validate:about gates enforce.
 */
function FactRow({ rank, label, value, animate, isFirst, maxValue }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-white/[0.02] sm:px-5">
      <div className="flex min-w-0 items-center gap-3.5">
        <span
          className={`w-5 font-mono text-xs font-bold ${isFirst ? "text-[color:var(--lv3-accent-soft)]" : "text-oai-gray-500"}`}
        >
          {String(rank).padStart(2, "0")}
        </span>
        <span className={`truncate text-sm tracking-wide ${isFirst ? "font-bold text-white" : "font-semibold text-oai-gray-200"}`}>
          {label}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-5">
        <span className="hidden h-[2px] w-16 overflow-hidden rounded-full bg-oai-gray-900 sm:block" aria-hidden="true">
          <span
            className="block h-full rounded-full"
            style={{ width: isFirst ? "100%" : `${Math.max(18, Math.round((value / maxValue) * 100))}%`, background: isFirst ? "var(--lv3-accent)" : LV3.line }}
          />
        </span>
        <span className={`font-mono text-sm leading-none tabular-nums ${isFirst ? "font-semibold text-white" : "font-medium text-oai-gray-300"}`}>
          {value}
        </span>
      </div>
    </div>
  );
}

export function LeaderboardSection({ copy, animate }) {
  const sectionRef = useRef(null);

  useLayoutEffect(() => {
    if (!animate) return undefined;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".lv3-lb-col",
        { autoAlpha: 0, y: 30 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.75,
          stagger: 0.14,
          ease: "power3.out",
          scrollTrigger: { trigger: sectionRef.current, start: "top 75%" },
        },
      );
    }, sectionRef);
    return () => ctx.revert();
  }, [animate]);

  const facts = [
    { label: copy("landing.v3.facts.tools"), value: AGENT_LOGOS.length },
    { label: copy("landing.v3.facts.limits"), value: LIMIT_PROVIDER_IDS.length },
    { label: copy("landing.v3.facts.perks"), value: PERK_PROVIDERS.length },
  ];
  const maxValue = facts.reduce(function (m, f) { return Math.max(m, f.value); }, 1);

  return (
    <section ref={sectionRef} className="relative border-t border-oai-gray-900 bg-oai-gray-950 py-16 sm:py-24 lg:py-32">
      <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-1 items-center gap-10 sm:gap-12 lg:grid-cols-12 lg:gap-8">
          <div className="lv3-lb-col space-y-6 text-left lg:col-span-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-oai-gray-800 bg-oai-black px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-oai-gray-400">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--lv3-accent)] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--lv3-accent)]" />
              </span>
              {copy("landing.v2.leaderboard.kicker")}
            </div>
            <h2 className="text-balance text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
              {copy("landing.v2.leaderboard.title")}
            </h2>
            <p className="text-base leading-relaxed text-oai-gray-400">
              {copy("landing.v2.leaderboard.subtitle")}
            </p>
            <div className="pt-4">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-[8px] bg-white px-6 text-xs font-bold text-oai-gray-950 shadow-sm transition-all duration-200 hover:bg-oai-gray-100 active:scale-[0.98] select-none"
              >
                {copy("landing.v2.leaderboard.view_more")}
              </a>
            </div>
          </div>

          <div className="lv3-lb-col w-full lg:col-span-7">
            <BorderGlow
              edgeSensitivity={30}
              glowColor="138 122 255"
              backgroundColor={LV3.panel}
              borderRadius={16}
              glowRadius={35}
              glowIntensity={1.0}
              coneSpread={25}
              animated={false}
              colors={[LV3.accent, LV3.accentSoft, LV3.glint]}
              className="w-full"
            >
              <div className="flex select-none items-center justify-between border-b border-oai-gray-800/80 bg-white/[0.025] px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-oai-gray-500 sm:px-5">
                <span>{copy("landing.v3.leaderboard.panel_title")}</span>
              </div>

              <div className="divide-y divide-oai-gray-800/60">
                {facts.map((fact, i) => (
                  <FactRow
                    key={fact.label}
                    label={fact.label}
                    value={fact.value}
                    rank={i + 1}
                    animate={animate}
                    isFirst={i === 0}
                    maxValue={maxValue}
                  />
                ))}
              </div>

              <div className="flex select-none items-center justify-between border-t border-oai-gray-800/80 bg-black/[0.15] px-4 py-2.5 font-mono text-[9px] uppercase tracking-widest text-oai-gray-500 sm:px-5">
                <span>{copy("landing.v3.facts.footer_left")}</span>
                <span>{copy("landing.v3.facts.footer_right")}</span>
              </div>
            </BorderGlow>
          </div>
        </div>
      </div>
    </section>
  );
}
