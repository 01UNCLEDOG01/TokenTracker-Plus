import React, { useLayoutEffect, useRef, useState, useEffect } from "react";
import { ArrowRight, ExternalLink, Globe, Info, Server, ShieldCheck, Smartphone } from "lucide-react";
import { Link } from "react-router-dom";
import { copy } from "../lib/copy";
import { getInsforgeConfiguration } from "../lib/insforge-config";
import { useInsforgeAuth } from "../contexts/InsforgeAuthContext.jsx";
import { Button } from "../ui/components/Button.jsx";
import { Card } from "../ui/components/Card.jsx";

// 2026-11-12 站主拍板重建（方案 A）：1.10.5 收口删掉了上游付费云方案的
// CloudPage，但侧边栏入口漏删，/cloud 落空 fallback 到用量总览。本页把
// 「云服务」落回 fork 语义——自托管后端的连接状态、自部署说明与多设备接入。
export const PROBE_DEBOUNCE_MS = 250;

// 健康探测：/api/auth/public-config 是 local-backend 的公开端点；对别的
// 实现只要服务器有 HTTP 响应（<500）就算可达——探测的是「服务器在不在」，
// 不深究端点形状。
export async function probeInstanceHealth(baseUrl, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(baseUrl.replace(/\/+$/, "") + "/api/auth/public-config", {
      cache: "no-store",
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

function StatusDot({ tone }) {
  const color = tone === "ok" ? "bg-emerald-500" : tone === "bad" ? "bg-red-500" : "bg-oai-gray-400";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden />;
}

export function CloudPage() {
  const pageRef = useRef(null);
  useLayoutEffect(() => {
    const scroller = pageRef.current?.parentElement;
    if (scroller) scroller.scrollTop = 0;
  }, []);

  const { user } = useInsforgeAuth();
  const config = getInsforgeConfiguration();
  const baseUrl = config.baseUrl || "";
  const localOnly = !baseUrl;

  const [probe, setProbe] = useState("checking"); // checking | ok | bad
  useEffect(() => {
    if (localOnly) {
      setProbe("bad");
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(() => {
      probeInstanceHealth(baseUrl).then((ok) => {
        if (alive) setProbe(ok ? "ok" : "bad");
      });
    }, PROBE_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [baseUrl, localOnly]);

  const email = typeof user?.email === "string" && user.email ? user.email : null;
  const statusTone = localOnly ? "bad" : probe === "checking" ? "idle" : probe === "ok" ? "ok" : "bad";
  const statusLabel = localOnly
    ? copy("cloud.status.local_only")
    : probe === "checking"
      ? copy("cloud.status.checking")
      : probe === "ok"
        ? copy("cloud.status.connected")
        : copy("cloud.status.unreachable");

  return (
    <div ref={pageRef} className="tt-cloud-theme flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          {copy("cloud.nav")}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-oai-gray-600 dark:text-oai-gray-300">
          {copy("cloud.page.subtitle")}
        </p>

        {/* 连接状态卡 */}
        <Card className="mt-8" bodyClassName="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <StatusDot tone={statusTone} />
            <span className="text-sm font-semibold">{statusLabel}</span>
          </div>
          {localOnly ? (
            <p className="text-xs leading-6 text-oai-gray-500 dark:text-oai-gray-400">
              {copy("cloud.deploy.body")}
            </p>
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-[9rem_1fr] sm:gap-y-2">
              <dt className="flex items-center gap-1.5 text-oai-gray-500 dark:text-oai-gray-400">
                <Server size={14} aria-hidden />
                {copy("cloud.status.instance")}
              </dt>
              <dd className="break-all font-mono text-xs leading-5 text-oai-gray-700 dark:text-oai-gray-200">{baseUrl}</dd>
              <dt className="flex items-center gap-1.5 text-oai-gray-500 dark:text-oai-gray-400">
                <Globe size={14} aria-hidden />
                {copy("cloud.status.account")}
              </dt>
              <dd className="break-all text-xs leading-5 text-oai-gray-700 dark:text-oai-gray-200">
                {email || <span className="text-oai-gray-400 dark:text-oai-gray-500">{copy("cloud.status.not_signed_in")}</span>}
              </dd>
            </dl>
          )}
          {probe === "bad" && !localOnly && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-5 text-amber-900/90 dark:border-amber-400/20 dark:bg-amber-400/5 dark:text-amber-200">
              <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
              {copy("cloud.status.unreachable_hint")}
            </p>
          )}
        </Card>

        {/* 自部署说明卡 */}
        <Card className="mt-5" title={copy("cloud.deploy.title")} bodyClassName="flex flex-col gap-4">
          <p className="text-sm leading-6 text-oai-gray-600 dark:text-oai-gray-300">
            {copy("cloud.deploy.body")}
          </p>
          <div>
            <Button as={Link} to="/self-host" className="no-underline">
              {copy("cloud.deploy.cta")}
              <ArrowRight size={14} className="ml-1.5 inline" aria-hidden />
            </Button>
          </div>
        </Card>

        {/* 局域网多设备接入卡 */}
        <Card className="mt-5" title={copy("cloud.lan.title")} bodyClassName="flex flex-col gap-4">
          <p className="flex items-start gap-2 text-sm leading-6 text-oai-gray-600 dark:text-oai-gray-300">
            <Smartphone size={16} className="mt-0.5 shrink-0 text-oai-gray-400" aria-hidden />
            <span>{copy("cloud.lan.body")}</span>
          </p>
          <div>
            <Button
              as="a"
              href="https://github.com/01UNCLEDOG01/TokenTracker-Plus#readme"
              target="_blank"
              rel="noopener noreferrer"
              variant="secondary"
              className="no-underline"
            >
              {copy("cloud.lan.cta")}
              <ExternalLink size={14} className="ml-1.5" aria-hidden />
            </Button>
          </div>
        </Card>

        <p className="mt-8 flex items-center gap-1.5 text-[11px] text-oai-gray-400 dark:text-oai-gray-500">
          <ShieldCheck size={13} aria-hidden />
          <span>{copy("self_host.status")}</span>
        </p>
      </main>
    </div>
  );
}
