# TokenTrackerMac（macOS 客户端，通用二进制）

**现役构建链：原生 SwiftUI 客户端（`TokenTrackerBar/`）**——整体 vendor 自上游 [xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker) 的 `TokenTrackerBar`（MIT，93 个 Swift 文件 / ~24k 行：原生菜单栏 + 原生宠物精灵 + 悬浮岛 + 原生设置页）。编译需要完整 Xcode（SwiftUI 宏插件与 actool 只随 Xcode 分发），构建走 `xcodebuild` 直编已提交的 `TokenTrackerBar.xcodeproj`（本机未装 xcodegen；`project.yml` 仅作文档/未来再生成用，与工程文件保持同步）。

**已下线的旧链：webview 壳（`Sources/`）**——v1 过渡实现（镜像 TokenTrackerWin 架构，WKWebView 三浮面 + 宠物桥），构建脚本保留在 `scripts/package-macos-legacy.sh`，仅供追溯，不再进安装包。

**TT-Plus 化（2026-11-11 起）**：原生壳保留，内容换成站主自己的版本——品牌 / 6 语言 / 宠物目录 / 限额口径 / dashboard 页面入口 / 设置契约 / 额度浮窗。**1.26.0 已落地**：GitHub 链接与更新源指向本仓、TT-Plus 品牌与 6 语言（de 补齐）、云端账号 / 登录 / OAuth 面移除、自更新资产改为 `TokenTracker-plus-<version>.dmg`、页面菜单（13 个 fork 页面）与 `tokentracker://open?path=` 深链、宠物设置桥与 7 个内置形象（含庚戌 / 猫也）、限额偏好透传、验证门禁修复。**进行中（未进本批）**：限额页 provider 补齐（13 个缺失 provider id / 12 类 + Qoder 团队积分 / 资源池 + WorkBuddy reward 窗口）、桌面额度浮窗、macOS 本地数据导出在 WKWebView 下的保存链路。

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
- **WidgetKit 桌面小组件不随包发布**：vendored 的 appex 缺 NSExtension 与 App Group，pkd 从不注册（pluginkit 实测为空），属于"永远不会出现的功能"；源码保留，等有开发者签名 + App Group 的版本再做。`verify-macos-package.cjs` 会拒绝不带 NSExtension 的 appex。
- 原生文案为 6 语言（en / zh-CN / zh-TW / ja / ko / de）。de 与 dashboard 德语文案同源，少量菜单栏 / 宠物状态措辞按原生语境单独撰写（非逐字对齐）。
- **桌面额度浮窗未随 1.26.0 发布**：设置页暂不展示该开关，待额度浮窗批次落地后再开放。
- **原生限额面板 provider 覆盖仍在补齐**：面板目前 20 个 provider，其余 13 个 provider id（Mistral / MiniMax / 商汤 / TRAE / AgentRouter / OpenDesign 等）随批次补齐；在此之前可先用网页面板的限额页查看。
