import React, { useRef, useState } from "react";
import { X, Download, Copy, Check, Share2, Award, Sparkles, Gem } from "lucide-react";
import { showToast } from "../components/Toast.jsx";

export function AchievementShareModal({ isOpen, onClose, badges = [], userTitle = "赛博修仙者", userName = "UNCLEDOG" }) {
  const [copied, setCopied] = useState(false);
  const cardRef = useRef(null);

  if (!isOpen) return null;

  const earned = badges.filter((b) => (b.tier || 0) >= 1);
  const diamondCount = badges.filter((b) => (b.tier || 0) === 4).length;
  const goldCount = badges.filter((b) => (b.tier || 0) === 3).length;

  const handleCopyText = async () => {
    const text = `【TokenTracker Plus 成就战报】
开发者：${userName}
专属称号：${userTitle}
累计达成成就：${earned.length}/${badges.length}
钻石勋章：${diamondCount} 枚 | 黄金勋章：${goldCount} 枚
追踪全生命周期 AI Token 消耗与工程效能，成就你的极客之路！`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast({ title: "战报文案已复制到剪贴板！" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast({ title: "复制失败，请手动选择复制" });
    }
  };

  const handleDownloadImage = () => {
    // Generate Canvas image
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 1000;
    const ctx = canvas.getContext("2d");

    // Dark sleek gradient background
    const bg = ctx.createLinearGradient(0, 0, 800, 1000);
    bg.addColorStop(0, "#0f172a");
    bg.addColorStop(0.5, "#1e1b4b");
    bg.addColorStop(1, "#090d16");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 800, 1000);

    // Border glow
    ctx.strokeStyle = "rgba(148, 163, 184, 0.2)";
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, 760, 960);

    // Header title
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 32px sans-serif";
    ctx.fillText("TOKEN TRACKER PLUS", 50, 80);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "18px sans-serif";
    ctx.fillText("开发者成就与工程效能里程碑", 50, 115);

    // User Card box
    ctx.fillStyle = "rgba(30, 41, 59, 0.7)";
    ctx.fillRect(50, 150, 700, 140);
    ctx.strokeStyle = "rgba(245, 158, 11, 0.4)";
    ctx.strokeRect(50, 150, 700, 140);

    // User details
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 28px sans-serif";
    ctx.fillText(userName, 80, 205);

    ctx.fillStyle = "#f59e0b";
    ctx.font = "bold 20px sans-serif";
    ctx.fillText(`称号：${userTitle}`, 80, 250);

    // Stats Grid
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 44px sans-serif";
    ctx.fillText(`${earned.length}/${badges.length}`, 80, 360);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "16px sans-serif";
    ctx.fillText("总解锁勋章", 80, 395);

    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 44px sans-serif";
    ctx.fillText(`${diamondCount}`, 320, 360);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "16px sans-serif";
    ctx.fillText("钻石级成就", 320, 395);

    ctx.fillStyle = "#facc15";
    ctx.font = "bold 44px sans-serif";
    ctx.fillText(`${goldCount}`, 540, 360);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "16px sans-serif";
    ctx.fillText("黄金级成就", 540, 395);

    // Subheader
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "bold 22px sans-serif";
    ctx.fillText("核心达成勋章展示", 50, 465);

    // List top 6 earned badges
    const topBadges = earned.slice(0, 6);
    topBadges.forEach((b, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const bx = 50 + col * 360;
      const by = 500 + row * 120;

      ctx.fillStyle = "rgba(15, 23, 42, 0.6)";
      ctx.fillRect(bx, by, 340, 100);
      ctx.strokeStyle = "rgba(56, 189, 248, 0.2)";
      ctx.strokeRect(bx, by, 340, 100);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 18px sans-serif";
      ctx.fillText(b.id, bx + 20, by + 42);

      ctx.fillStyle = "#38bdf8";
      ctx.font = "14px sans-serif";
      const tierText = b.tier === 4 ? "钻石阶" : b.tier === 3 ? "黄金阶" : b.tier === 2 ? "白银阶" : "青铜阶";
      ctx.fillText(tierText, bx + 20, by + 74);
    });

    // Footer
    ctx.fillStyle = "#64748b";
    ctx.font = "16px sans-serif";
    ctx.fillText("TokenTracker Plus · 永久开源离线 AI 编程度量仪", 50, 930);

    // Trigger download
    const link = document.createElement("a");
    link.download = `TokenTracker-Achievements-${userName}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast({ title: "战报海报已成功生成并下载！" });
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl border border-oai-gray-200 bg-white p-6 shadow-2xl dark:border-oai-gray-800 dark:bg-oai-gray-900">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-oai-gray-400 hover:bg-oai-gray-100 hover:text-oai-black dark:hover:bg-oai-gray-800 dark:hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2">
          <Share2 className="h-5 w-5 text-amber-500" />
          <h3 className="text-lg font-bold text-oai-black dark:text-white">
            导出成就战报与勋章卡片
          </h3>
        </div>

        <p className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          生成你的个人成就战报，一键下载海报或复制格式化文案分享至社交圈。
        </p>

        {/* Card preview */}
        <div
          ref={cardRef}
          className="mt-4 rounded-xl border border-amber-500/30 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 p-5 text-white shadow-inner"
        >
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[10px] font-bold tracking-wider uppercase text-amber-400">
                TokenTracker Plus Milestone
              </span>
              <h4 className="mt-1 text-xl font-bold">{userName}</h4>
              <div className="mt-1 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-xs font-semibold text-amber-300">
                  {userTitle}
                </span>
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-right">
              <div className="text-[10px] text-gray-400">已解锁</div>
              <div className="text-base font-extrabold text-white">
                {earned.length}/{badges.length}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-3">
            <div className="rounded-lg bg-white/5 p-2.5">
              <div className="flex items-center gap-1 text-[11px] text-cyan-300"><Gem className="h-3 w-3" /><span>钻石勋章</span></div>
              <div className="mt-1 text-xl font-bold text-white">{diamondCount}</div>
            </div>
            <div className="rounded-lg bg-white/5 p-2.5">
              <div className="flex items-center gap-1 text-[11px] text-amber-300"><Award className="h-3 w-3" /><span>黄金勋章</span></div>
              <div className="mt-1 text-xl font-bold text-white">{goldCount}</div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            onClick={handleDownloadImage}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-amber-400 shadow-sm"
          >
            <Download className="h-4 w-4" />
            下载高清海报 (PNG)
          </button>
          <button
            type="button"
            onClick={handleCopyText}
            className="flex items-center justify-center gap-2 rounded-xl border border-oai-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-oai-black transition hover:bg-oai-gray-50 dark:border-oai-gray-700 dark:bg-oai-gray-800 dark:text-white dark:hover:bg-oai-gray-700"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            {copied ? "已复制" : "复制文字"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AchievementShareModal;
