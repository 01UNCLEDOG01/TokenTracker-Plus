import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  getTitleBondName,
  getResonancePillStyle,
  getResonanceTextColor,
  spectrumTier,
} from "./title-registry";
import { isNativeWindowsApp } from "../../lib/native-bridge.js";

const TIER_NAMES = ["未激活", "青铜", "白银", "黄金", "钻石"];

/**
 * Large, read-only view of one title: crest, copy, resonance, and the member
 * badges. Member badges are buttons so the caller can open the same achievement
 * detail modal the wall uses.
 */
export function TitleDetailModal({ title, resonance, badgeMap, onClose, onSelectBadge }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    const mainEl = document.getElementById("app-main-content");
    const previousBody = document.body.style.overflow;
    const previousMain = mainEl ? mainEl.style.overflow : "";

    document.body.style.overflow = "hidden";
    if (mainEl) {
      mainEl.style.overflow = "hidden";
    }

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousBody;
      if (mainEl) {
        mainEl.style.overflow = previousMain;
      }
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!title) return null;
  const { theme } = title;
  const bondName = title.bondName || getTitleBondName(title);

  const inline = isNativeWindowsApp();

  const modalContent = (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title.name}
      onClick={onClose}
      onWheel={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
        }
      }}
    >
      <div
        className={`relative max-h-[90vh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-3xl border-2 ${theme.border} bg-gradient-to-br ${theme.bgGradient} p-6 text-white shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-wider">
              <span className={`rounded-md border px-2 py-0.5 ${theme.pillClass}`}>{title.tag}</span>
              <span className={`rounded-md border px-2 py-0.5 ${getResonancePillStyle(resonance?.tier)}`}>
                {bondName} · {resonance?.label || "未激活"}
              </span>
            </div>
            <h2 className="mt-3 truncate text-2xl font-black tracking-tight">{title.name}</h2>
            <div className="mt-0.5 text-xs font-semibold uppercase tracking-widest text-white/60">
              {title.en}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 rounded-full border border-white/20 bg-black/30 p-1.5 text-white/70 transition hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex items-center gap-5">
          <img
            src={title.art}
            alt={title.name}
            className={`h-28 w-28 shrink-0 rounded-full object-contain drop-shadow-xl ring-2 ${
              resonance?.tier >= 4
                ? "ring-cyan-300 shadow-xl shadow-cyan-400/50"
                : resonance?.tier === 3
                ? "ring-amber-400 shadow-lg shadow-amber-400/40"
                : resonance?.tier === 2
                ? "ring-slate-300 shadow-md shadow-slate-300/30"
                : theme.ring
            } ${
              title.rainbow ? "title-rainbow" : ""
            }`}
            data-spectrum={title.rainbow ? (resonance?.spectrumTier || spectrumTier(resonance?.tier)) : undefined}
          />
          <p className="text-sm leading-relaxed text-white/85">{title.desc}</p>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/40 p-4">
          <div className="flex items-center justify-between text-[11px] font-mono text-white/70">
            <span className="font-bold text-white/90">{bondName}</span>
            <span className={getResonanceTextColor(resonance?.tier)}>{resonance?.label || "未激活"}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {title.requiredBadges.map((req) => {
              const owned = badgeMap?.get(req.id);
              const tier = owned?.tier || 0;
              return (
                <button
                  key={req.id}
                  type="button"
                  onClick={() => onSelectBadge?.(req.id)}
                  className="group flex w-20 flex-col items-center gap-1 rounded-xl p-1 text-center transition hover:bg-white/5"
                  title={`查看 ${req.name}`}
                >
                  <img
                    src={req.art}
                    alt={req.name}
                    className={`h-14 w-14 rounded-full border-2 object-contain bg-black/60 ${theme.ring} ${
                      tier >= req.tier ? "" : "grayscale opacity-50"
                    } transition-transform group-hover:scale-105`}
                  />
                  <span className="line-clamp-2 text-[10px] leading-tight text-white/80">{req.name}</span>
                  <span className={`text-[9px] font-mono ${tier >= req.tier ? "text-emerald-300" : "text-white/40"}`}>
                    {tier >= req.tier ? TIER_NAMES[Math.min(4, tier)] : `需${TIER_NAMES[req.tier]}`}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 border-t border-white/10 pt-2 text-[10px] text-white/50">{title.reqText}</div>
        </div>
      </div>
    </div>
  );

  if (inline) {
    return modalContent;
  }

  return createPortal(modalContent, document.body);
}

export default TitleDetailModal;
