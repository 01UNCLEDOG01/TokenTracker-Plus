import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 品牌图标目录的「真图」门禁（2026-11-13）。
// 背景：wechat_miniprogram.ico 曾是一份 87KB 的 HTML 错误页（抓 favicon 时服务器
// 返回 404 页面），浏览器永远渲染不出来，而这类问题在仓库里已经出现过一次
// （千帆的 ico 同样是 HTML）。这里按魔数校验，避免把错误页当成图标提交。
const LOGO_DIR = path.resolve(__dirname, "../../public/brand-logos");

const MAGIC = [
  { name: "ico", test: (b) => b.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])) },
  { name: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { name: "jpeg", test: (b) => b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
  { name: "gif", test: (b) => ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("latin1")) },
  { name: "webp", test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" },
  {
    name: "svg",
    // 允许 XML 声明/SVG 注释在前，只要前 512 字节里出现 <svg 即认定为矢量图。
    test: (b) => /<svg[\s>]/i.test(b.subarray(0, 512).toString("utf8")),
  },
];

function looksLikeImage(buffer) {
  return MAGIC.some((probe) => probe.test(buffer));
}

describe("brand logos are real images", () => {
  const files = fs.existsSync(LOGO_DIR)
    ? fs.readdirSync(LOGO_DIR).filter((name) => fs.statSync(path.join(LOGO_DIR, name)).isFile())
    : [];

  it("has the logo directory with assets", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files)("%s is an image, not an HTML error page", (name) => {
    const buffer = fs.readFileSync(path.join(LOGO_DIR, name));
    expect(buffer.length).toBeGreaterThan(0);
    // 错误页最典型的形态：<!DOCTYPE html / <html / 空文件。
    const head = buffer.subarray(0, 64).toString("utf8").trimStart().toLowerCase();
    expect(head.startsWith("<!doctype")).toBe(false);
    expect(head.startsWith("<html")).toBe(false);
    expect(looksLikeImage(buffer), `${name} 不是可识别的图片格式（魔数不符）`).toBe(true);
  });
});