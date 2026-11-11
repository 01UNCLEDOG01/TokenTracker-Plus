# TokenTrackerMac（macOS 客户端，通用二进制）

**现役构建链：原生 SwiftUI 客户端（`TokenTrackerBar/`）**——整体 vendor 自上游 [xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker) 的 `TokenTrackerBar`（MIT，93 个 Swift 文件 / ~24k 行：原生菜单栏 + 原生宠物精灵 + 悬浮岛 + 原生设置页）。编译需要完整 Xcode（SwiftUI 宏插件与 actool 只随 Xcode 分发），构建走 `xcodebuild` 直编已提交的 `TokenTrackerBar.xcodeproj`（本机未装 xcodegen；`project.yml` 仅作文档/未来再生成用，与工程文件保持同步）。

**已下线的旧链：webview 壳（`Sources/`）**——v1 过渡实现（镜像 TokenTrackerWin 架构，WKWebView 三浮面 + 宠物桥），构建脚本保留在 `scripts/package-macos-legacy.sh`，仅供追溯，不再进安装包。

**TT-Plus 化（2026-11-11 起，1.26.0 全部落地）**：原生壳保留，内容换成站主自己的版本——品牌 / 6 语言 / 宠物目录 / 限额口径 / dashboard 页面入口 / 设置契约 / 额度浮窗。**1.26.0 已落地**：GitHub 链接与更新源指向本仓、TT-Plus 品牌与 6 语言（de 补齐）、云端账号 / 登录 / OAuth 面移除、自更新资产改为 `TokenTracker-plus-<version>.dmg`、页面菜单（13 个 fork 页面）与 `tokentracker://open?path=` 深链、宠物设置桥与 7 个内置形象（含庚戌 / 猫也）、限额偏好透传、限额面板 33 个 provider 对齐（含 Qoder 团队积分 / 资源池、WorkBuddy 奖励窗口）、桌面额度浮窗（菜单 / 岛 / 宠物页三处开关）、macOS 本地数据导出经 WKDownload 落盘、验证门禁修复。

共享基建：`scripts/bundle-node.sh`（PET dashboard 构建 + 双架构 Node 22.22.2）产出的 `EmbeddedServer/` 由两条链共用。

## 构建与打包

```bash
cd TokenTrackerMac
bash scripts/bundle-node.sh        # PET dashboard 构建 + pinned Node 22.22.2 + 镜像源码树 → EmbeddedServer/
bash scripts/package-macos.sh      # xcodebuild → ditto → lipo → ad-hoc codesign → 内置 verify → dmg + zip
node ../scripts/verify-macos-package.cjs   # 也可单独跑：可执行名取自 Info.plist、bundle id、node/pet/quota 哨兵、dist 指纹、版本一致
```

产物：`artifacts/TokenTracker-plus-<版本>.dmg` 与 `TokenTracker-plus-macos-universal-<版本>.zip`（通用二进制，EmbeddedServer 内嵌 node-arm64 与 node-x64，壳运行时按机器架构选），记账大小 + SHA-256。

## 已知限制

- 未签名分发（ad-hoc）：首次打开需右键 → 打开，或 `xattr -cr`（与 Windows 版未签名策略同款）。
- **WidgetKit 桌面小组件随包发布（2026-11-12 起）**：补回 appex 的 `NSExtension`（`com.apple.widgetkit-extension`）+ 沙箱 entitlement，继续 ad-hoc 签名、**不申请 App Group**（无付费 profile 时 App Group 会让构建直接失败；上游同样如此）。数据走宿主写入 widget 自身容器快照的 fallback 路径（`WidgetSharedConstants.widgetBundleIdentifier` 必须等于 widget target 的 bundle id）。`verify-macos-package.cjs` 现在要求 appex 存在、声明正确、版本与 app 一致、沙箱 entitlement 存在，任一缺失即红。实测（macOS 27.2）：ad-hoc + 沙箱 + NSExtension 的 appex 可被 pkd 注册（`pluginkit -m -p com.apple.widgetkit-extension` 可见）。**注意**：ad-hoc 分发仍有 Gatekeeper 首次打开拦截；带 quarantine 属性的下载包在用户放行前不会注册小组件，用户需先打开一次 app（右键 → 打开，或 `xattr -cr`）。
- 原生文案为 6 语言（en / zh-CN / zh-TW / ja / ko / de）。de 与 dashboard 德语文案同源，少量菜单栏 / 宠物状态措辞按原生语境单独撰写（非逐字对齐）。
- 限额面板 33 个 provider 已全部移植；本机只配置了其中 6 个（codex / zcode / trae / traeMain / codearts / clinePass），其余 9 个（Qoder / WorkBuddy 用服务端同形 fixture 验证过，Mistral / MiniMax / 商汤 / AgentRouter / OpenDesign / APIGOTO / Raccoon / OpenAI Credits / MiniMax Code 为解码+渲染验证），真实数据下的逐值对账要等相应 provider 在本机配置后补。
- 额度浮窗与限额面板的数据来自本机限额接口；服务未就绪时窗口显示加载态，不会拿旧快照冒充新值。
