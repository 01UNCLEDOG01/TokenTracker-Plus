import React from "react";
import { Sparkles } from "lucide-react";
import { cn } from "../../lib/cn";
import { getTitleById } from "./title-registry";

/**
 * EquippedTitleBadge: Renders the bespoke 3D crest emblem and stylized theme pill
 * for equipped titles across Dashboard, Sidebar, Leaderboard, and Profile Modals.
 */
export function EquippedTitleBadge({
  titleId,
  title: titleProp,
  size = "sm", // "xs" | "sm" | "md" | "lg"
  showIcon = true,
  showPill = true,
  className = "",
  onClick,
}) {
  const title = titleProp || getTitleById(titleId);
  if (!title) return null;

  const { theme } = title;

  const iconSizes = {
    xs: "h-4 w-4",
    sm: "h-5 w-5",
    md: "h-6 w-6",
    lg: "h-10 w-10",
  };

  const textSizes = {
    xs: "text-[10px] px-1.5 py-0.2",
    sm: "text-[11px] px-2 py-0.5",
    md: "text-xs px-2.5 py-1",
    lg: "text-sm px-3.5 py-1.5 font-bold",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full select-none transition-all duration-200",
        className
      )}
      title={`${title.name} (${title.en}) · ${title.desc}`}
      onClick={onClick}
    >
      {/* 3D Crest Emblem */}
      {showIcon && (
        <div className="relative shrink-0 flex items-center justify-center">
          <img
            src={title.art}
            alt={title.name}
            className={cn(
              "rounded-full object-contain filter transition-transform hover:scale-110",
              iconSizes[size] || iconSizes.sm,
              theme.glow
            )}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full animate-pulse",
              theme.accentDot
            )}
          />
        </div>
      )}

      {/* Styled Pill Badge */}
      {showPill && (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border font-semibold tracking-wide backdrop-blur-md shadow-sm transition-all",
            theme.pillClass,
            textSizes[size] || textSizes.sm
          )}
        >
          <Sparkles className="h-2.5 w-2.5 shrink-0 opacity-80" />
          <span className="truncate max-w-[120px] sm:max-w-none">{title.name}</span>
        </span>
      )}
    </div>
  );
}

export default EquippedTitleBadge;
