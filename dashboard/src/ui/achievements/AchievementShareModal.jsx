import React, { useRef, useState } from "react";
import { X, Download, Copy, Check, Share2, Award, Sparkles, Gem, Trophy, Flame, Crown, Zap } from "lucide-react";
import { showToast } from "../components/Toast.jsx";
import { BADGE_BY_ID } from "./badge-catalog.js";

export function AchievementShareModal({ isOpen, onClose, badges = [], userTitle = "赛博修仙者", userName = "UNCLEDOG" }) {
  const [copied, setCopied] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const cardRef = useRef(null);

  if (!isOpen) return null;

  const earned = badges.filter((b) => (b.tier || 0) >= 1);
  const diamondCount = badges.filter((b) => (b.tier || 0) === 4).length;
  const goldCount = badges.filter((b) => (b.tier || 0) === 3).length;
  const silverCount = badges.filter((b) => (b.tier || 0) === 2).length;
  const bronzeCount = badges.filter((b) => (b.tier || 0) === 1).length;

  // Sort top showcase badges: Diamond first, then Gold, ordered by display catalog
  const topShowcaseBadges = [...earned].sort((a, b) => {
    const td = (b.tier || 0) - (a.tier || 0);
    if (td !== 0) return td;
    return (b.metric_value || 0) - (a.metric_value || 0);
  }).slice(0, 6);

  const handleCopyText = async () => {
    const text = `【TokenTracker Plus 开发者成就战报】
━━━━━━━━━━━━━━━━━━━━
开发者：${userName}
加冕称号：${userTitle}
成就总揽：已解锁 ${earned.length}/${badges.length} (${((earned.length / badges.length) * 100).toFixed(1)}%)
殿堂勋章：[钻石级] ${diamondCount} 枚 | [黄金级] ${goldCount} 枚 | [白银级] ${silverCount} 枚
核心战勋：${topShowcaseBadges.map((b) => BADGE_BY_ID.get(b.id)?.name || b.id).join(" · ")}
━━━━━━━━━━━━━━━━━━━━
全链路度量 52 款 AI 编码工具与真实算力价值，登峰造极的极客之路！`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast({ title: "战报格式化文案已复制到剪贴板！" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast({ title: "复制失败，请手动选择复制" });
    }
  };

  const handleDownloadImage = async () => {
    setIsExporting(true);
    showToast({ title: "正在绘制 1200px 殿堂级高清战报..." });

    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 900;
      const ctx = canvas.getContext("2d");

      // Dark brushed titanium background
      const bg = ctx.createLinearGradient(0, 0, 1200, 900);
      bg.addColorStop(0, "#0a0e17");
      bg.addColorStop(0.4, "#111827");
      bg.addColorStop(0.8, "#0d131f");
      bg.addColorStop(1, "#070a10");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 1200, 900);

      // Tech grid lines
      ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
      ctx.lineWidth = 1;
      for (let x = 0; x < 1200; x += 60) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 900);
        ctx.stroke();
      }
      for (let y = 0; y < 900; y += 60) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(1200, y);
        ctx.stroke();
      }

      // Outer gold/cyan double frame
      ctx.strokeStyle = "rgba(245, 158, 11, 0.4)";
      ctx.lineWidth = 3;
      ctx.strokeRect(30, 30, 1140, 840);
      ctx.strokeStyle = "rgba(34, 211, 238, 0.3)";
      ctx.lineWidth = 1;
      ctx.strokeRect(38, 38, 1124, 824);

      // Corner metallic brackets
      const drawBracket = (x, y, dx, dy) => {
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x, y + dy * 24);
        ctx.lineTo(x, y);
        ctx.lineTo(x + dx * 24, y);
        ctx.stroke();
      };
      drawBracket(30, 30, 1, 1);
      drawBracket(1170, 30, -1, 1);
      drawBracket(30, 870, 1, -1);
      drawBracket(1170, 870, -1, -1);

      // Header: Brand & Title
      ctx.fillStyle = "#f59e0b";
      ctx.font = "bold 16px monospace";
      ctx.fillText("TOKEN TRACKER PLUS · HALL OF FAME", 70, 85);

      ctx.fillStyle = "#ffffff";
      ctx.font = "900 38px sans-serif";
      ctx.fillText("开发者成就与极客算力战报", 70, 130);

      // User Profile & Title Card
      ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
      ctx.fillRect(70, 160, 1060, 110);
      ctx.strokeStyle = "rgba(245, 158, 11, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(70, 160, 1060, 110);

      ctx.fillStyle = "#ffffff";
      ctx.font = "900 32px sans-serif";
      ctx.fillText(userName, 100, 212);

      ctx.fillStyle = "#f59e0b";
      ctx.font = "bold 20px sans-serif";
      ctx.fillText(`加冕称号：${userTitle}`, 100, 248);

      // Right-side total badges badge in profile box
      ctx.fillStyle = "rgba(245, 158, 11, 0.15)";
      ctx.fillRect(940, 180, 160, 70);
      ctx.strokeStyle = "rgba(245, 158, 11, 0.5)";
      ctx.strokeRect(940, 180, 160, 70);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "13px sans-serif";
      ctx.fillText("成就解锁率", 980, 204);
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 26px monospace";
      ctx.fillText(`${earned.length}/${badges.length}`, 975, 238);

      // Stats 4-Column Bar
      const stats = [
        { label: "钻石级勋章", val: `${diamondCount} 枚`, color: "#38bdf8" },
        { label: "黄金级勋章", val: `${goldCount} 枚`, color: "#facc15" },
        { label: "白银级勋章", val: `${silverCount} 枚`, color: "#cbd5e1" },
        { label: "⚡ 巅峰热力评级", val: "Lv7 宇宙奇点", color: "#34d399" },
      ];
      stats.forEach((st, i) => {
        const sx = 70 + i * 270;
        ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
        ctx.fillRect(sx, 290, 250, 80);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.strokeRect(sx, 290, 250, 80);

        ctx.fillStyle = "#94a3b8";
        ctx.font = "14px sans-serif";
        ctx.fillText(st.label, sx + 20, 320);

        ctx.fillStyle = st.color;
        ctx.font = "900 24px monospace";
        ctx.fillText(st.val, sx + 20, 354);
      });

      // Section title: Core Medallion Showcase
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 22px sans-serif";
      ctx.fillText("PRESTIGIOUS MEDALLION SHOWCASE · 殿堂级核心勋章展台", 70, 420);

      // Load & Draw Top 6 Badge Images
      const loadImage = (url) => new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });

      const badgeImgs = await Promise.all(
        topShowcaseBadges.map((b) => {
          const meta = BADGE_BY_ID.get(b.id);
          const artUrl = meta?.art || `/achievements/${b.id.replace(/_/g, "-")}.png`;
          return loadImage(artUrl);
        })
      );

      // Render 6 badges in a 6-column pedestal row
      topShowcaseBadges.forEach((b, idx) => {
        const bx = 70 + idx * 180;
        const by = 450;
        const meta = BADGE_BY_ID.get(b.id);
        const name = meta?.name || b.id;
        const img = badgeImgs[idx];
        const isDiamond = b.tier === 4;

        // Pedestal background box
        ctx.fillStyle = isDiamond ? "rgba(34, 211, 238, 0.05)" : "rgba(245, 158, 11, 0.05)";
        ctx.fillRect(bx, by, 160, 270);
        ctx.strokeStyle = isDiamond ? "rgba(34, 211, 238, 0.3)" : "rgba(245, 158, 11, 0.25)";
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, 160, 270);

        // Medallion Glow
        const glow = ctx.createRadialGradient(bx + 80, by + 90, 20, bx + 80, by + 90, 75);
        glow.addColorStop(0, isDiamond ? "rgba(34, 211, 238, 0.3)" : "rgba(245, 158, 11, 0.25)");
        glow.addColorStop(1, "transparent");
        ctx.fillStyle = glow;
        ctx.fillRect(bx, by + 10, 160, 160);

        // Draw Badge Image
        if (img) {
          ctx.drawImage(img, bx + 20, by + 30, 120, 120);
        } else {
          ctx.fillStyle = "#334155";
          ctx.beginPath();
          ctx.arc(bx + 80, by + 90, 50, 0, Math.PI * 2);
          ctx.fill();
        }

        // Tier tag
        ctx.fillStyle = isDiamond ? "#38bdf8" : "#facc15";
        ctx.font = "bold 13px sans-serif";
        const tierStr = isDiamond ? "DIAMOND · 钻石阶" : "GOLD · 黄金阶";
        ctx.fillText(tierStr, bx + 50, by + 185);

        // Badge title
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 16px sans-serif";
        const textW = ctx.measureText(name).width;
        ctx.fillText(name, bx + Math.max(10, (160 - textW) / 2), by + 215);

        // Subtitle
        ctx.fillStyle = "#64748b";
        ctx.font = "12px sans-serif";
        ctx.fillText(meta?.id || "", bx + 30, by + 242);
      });

      // Footer
      ctx.fillStyle = "#475569";
      ctx.font = "14px monospace";
      ctx.fillText(`VERIFIED AT: ${new Date().toISOString().replace("T", " ").slice(0, 19)} · TOKEN TRACKER PLUS`, 70, 790);

      ctx.fillStyle = "#f59e0b";
      ctx.font = "14px sans-serif";
      ctx.fillText("100% 离线隐私保护 · 跨 52 款 AI 编码工具真实账本", 780, 790);

      // Download
      const link = document.createElement("a");
      link.download = `TokenTracker-HallOfFame-${userName}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      showToast({ title: "殿堂级成就战报海报已成功生成并下载！" });
    } catch (e) {
      console.error(e);
      showToast({ title: "海报生成失败，请稍后重试" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-3xl border border-amber-500/40 bg-[#0f1422] p-6 text-white shadow-[0_25px_60px_rgba(0,0,0,0.9)] overflow-hidden">
        {/* Ambient background glow */}
        <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-cyan-500/15 blur-3xl pointer-events-none" />

        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 rounded-xl p-2 text-gray-400 hover:bg-white/10 hover:text-white transition"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="relative z-10 flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500 text-black shadow-lg">
            <Share2 className="h-4 w-4 stroke-[2.5]" />
          </span>
          <h3 className="text-xl font-black text-white">
            导出成就战报与勋章卡片
          </h3>
        </div>

        <p className="relative z-10 mt-1 text-xs text-gray-400">
          生成殿堂级个人极客战报，携带真实高精 3D 浮雕勋章与完整工程战绩，一键保存分享。
        </p>

        {/* Masterpiece Card Preview */}
        <div
          ref={cardRef}
          className="relative z-10 mt-5 rounded-2xl border-2 border-amber-500/40 bg-gradient-to-br from-[#131b2e] via-[#0f1422] to-[#090d16] p-5 shadow-inner"
        >
          {/* Header row */}
          <div className="flex items-start justify-between border-b border-white/10 pb-4">
            <div>
              <span className="text-[10px] font-mono font-bold tracking-wider uppercase text-amber-400">
                TOKEN TRACKER PLUS · HALL OF FAME
              </span>
              <h4 className="mt-1 text-2xl font-black text-white">{userName}</h4>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-amber-500/20 text-amber-400 border border-amber-500/40">
                  <Sparkles className="h-3 w-3" />
                </span>
                <span className="text-sm font-bold text-amber-300">
                  {userTitle}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-right shadow-sm">
              <div className="text-[11px] text-gray-400">成就解锁率</div>
              <div className="text-xl font-black text-amber-300">
                {earned.length}/{badges.length}
              </div>
            </div>
          </div>

          {/* Core Medallion Showcase Shelf (The 6 Top Badges) */}
          <div className="mt-4">
            <div className="text-xs font-bold text-gray-300 flex items-center justify-between">
              <span>殿堂级核心勋章展台 (Top Medallions)</span>
              <span className="flex items-center gap-1 text-[10px] font-mono text-cyan-400"><Gem className="h-3 w-3 text-cyan-400" /> 钻石 x {diamondCount}</span>
            </div>

            <div className="mt-3 grid grid-cols-6 gap-2 bg-black/40 rounded-xl p-3 border border-white/10">
              {topShowcaseBadges.map((b) => {
                const meta = BADGE_BY_ID.get(b.id);
                const artUrl = meta?.art || `/achievements/${b.id.replace(/_/g, "-")}.png`;
                const isDiamond = b.tier === 4;
                const ringColor = isDiamond ? "border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.5)]" : "border-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.4)]";

                return (
                  <div key={b.id} className="flex flex-col items-center group/badge">
                    <div className="relative">
                      <img
                        src={artUrl}
                        alt={meta?.name || b.id}
                        className={`h-14 w-14 rounded-full border-2 object-contain bg-black/60 ${ringColor} transition-transform group-hover/badge:scale-110`}
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                    </div>
                    <span className="mt-1.5 text-[11px] font-bold text-white truncate max-w-full text-center">
                      {meta?.name || b.id}
                    </span>
                    <span className={`text-[9px] font-semibold ${isDiamond ? "text-cyan-300" : "text-yellow-300"}`}>
                      {isDiamond ? "钻石阶" : "黄金阶"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stats Badges */}
          <div className="mt-4 grid grid-cols-3 gap-2.5 border-t border-white/10 pt-3">
            <div className="rounded-xl bg-white/[0.04] p-2.5 border border-white/5">
              <div className="flex items-center gap-1 text-[11px] text-cyan-300 font-bold">
                <Gem className="h-3 w-3" />
                <span>钻石勋章</span>
              </div>
              <div className="mt-1 text-xl font-black text-white">{diamondCount} 枚</div>
            </div>

            <div className="rounded-xl bg-white/[0.04] p-2.5 border border-white/5">
              <div className="flex items-center gap-1 text-[11px] text-amber-300 font-bold">
                <Award className="h-3 w-3" />
                <span>黄金勋章</span>
              </div>
              <div className="mt-1 text-xl font-black text-white">{goldCount} 枚</div>
            </div>

            <div className="rounded-xl bg-white/[0.04] p-2.5 border border-white/5">
              <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-bold">
                <Zap className="h-3 w-3" />
                <span>巅峰热力</span>
              </div>
              <div className="mt-1 text-xl font-black text-white">Lv7 奇点</div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="relative z-10 mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            disabled={isExporting}
            onClick={handleDownloadImage}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-5 py-3 text-sm font-bold text-black transition hover:from-amber-300 hover:to-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.4)] disabled:opacity-50"
          >
            <Download className="h-4 w-4 stroke-[2.5]" />
            {isExporting ? "正在绘制 1200px 高清海报..." : "下载殿堂级海报 (1200px PNG)"}
          </button>
          <button
            type="button"
            onClick={handleCopyText}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400 stroke-[3]" /> : <Copy className="h-4 w-4" />}
            {copied ? "已复制" : "复制战报文案"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AchievementShareModal;
