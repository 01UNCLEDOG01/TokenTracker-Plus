# TokenTrackerMac（macOS 客户端，通用二进制）

**两条构建链：**

1. **原生 SwiftUI 客户端（主链，`BarSources/`）**——整体 vendor 自上游 [xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker) 的 `TokenTrackerBar`（MIT，126 文件 ~30k 行：原生菜单栏 + 原生宠物精灵 + 悬浮岛 + 原生设置页），fork 适配仅三处已标记（更新源指向本 fork、包名/版本注入）。**编译需要完整 Xcode**（SwiftUI 宏插件 SwiftUIMacros 与 actool 只随 Xcode 分发；Vortex 粒子库已移除并 stub 同接口）。构建走 `xcodebuild` 直编 SwiftPM 清单（无需 XcodeGen）。
2. **webview 壳（legacy，`Sources/`）**——v1 过渡实现（镜像 TokenTrackerWin 架构，WKWebView 三浮面 + 宠物桥），构建链在 `scripts/package-macos-legacy.sh`。原生链验证通过后退役。

共享基建：`scripts/bundle-node.sh`（PET dashboard 构建 + 双架构 Node 22.22.2）产出的 `EmbeddedServer/` 两链通用。

## 功能（v1）

- **菜单栏 ⚡ 图标**：左键弹出额度面板（quota 页）；右键菜单 = 打开面板 / 宠物悬浮窗 / 额度窗 / 立即同步 / 开机启动 / 检查更新 / 退出
- **宠物悬浮窗**：透明浮动面板（nonactivating NSPanel），服务就绪自动出现，可拖拽，右键弹菜单；页面 `pet:*` 事件经 WKScriptMessageHandler 桥接原生
- **额度窗 / 面板窗**：独立 WKWebView 窗口
- **服务器管理**：spawn 内嵌 Node（`Resources/EmbeddedServer/node` + `tokentracker/bin/tracker.js serve --port 7680`），健康轮询 + 崩溃退避重启，退出清理子进程
- **单实例**：同 bundle ID 二次启动自动退出并激活已运行实例
- **更新检查**：GitHub Releases latest 比对版本，提示并打开发布页
- **开机启动**：SMAppService（macOS 13+）

## 构建与打包

```bash
# 前置：Xcode Command Line Tools（swiftc）+ Node 20+（跑打包脚本）
cd TokenTrackerMac
bash scripts/bundle-node.sh        # PET dashboard 构建 + pinned Node 22.22.2 darwin-arm64 + 镜像源码树 → EmbeddedServer/
bash scripts/package-macos.sh      # swiftc → TokenTracker-plus.app → ad-hoc codesign → dmg + zip（artifacts/）
node ../scripts/verify-macos-package.cjs   # 载荷哨兵：node 二进制 / pet+quota 页 / dist 指纹 / 版本一致
```

产物：`artifacts/TokenTracker-plus-<版本>.dmg` 与 `TokenTracker-plus-macos-universal-<版本>.zip`（通用二进制，swiftc 双 target + lipo；EmbeddedServer 内嵌 node-arm64 与 node-x64，壳运行时按机器架构选），记账大小 + SHA-256。

## 已知限制（v1）

- 未签名分发（ad-hoc）：首次打开需右键 → 打开，或 `xattr -cr`（与 Windows 版未签名策略同款）
- 宠物悬浮窗背景暂为白色卡片（Windows 版是纯透明合成）——WKWebView 透明合成待打磨
- WidgetKit 桌面小组件未做（需要完整 Xcode；当前只依赖 Command Line Tools）
