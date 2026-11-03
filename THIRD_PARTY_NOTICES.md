# Third-Party Notices

This project includes third-party assets and code. The following notices apply.

## RunCat menu bar cat frames

The running-cat animation frames used by the macOS menu bar icon
(formerly `TokenTrackerBar/TokenTrackerBar/Assets.xcassets/RunnerCat0…4.imageset`)
are from [menubar_runcat](https://github.com/Kyome22/menubar_runcat)
by Takuto Nakamura (Kyome22).

> **2026-11-02 note**: the macOS client was removed from this fork on 2026-10-28
> (this fork ships the Windows package + source only), so these frames are no
> longer distributed by the current build. The attribution is kept because the
> frames remain in the repository's git history and in the upstream base.

Copyright © 2019 Takuto Nakamura

Licensed under the Apache License, Version 2.0 (the "License");
you may not use these files except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

## Bot companion morphing engine

The vector morphing engine behind the `bot` pet character and its menu bar icon
(`dashboard/src/lib/bot/`, with the rendered sprite atlases under
`dashboard/public/pets/`) is from [bloub](https://github.com/jeremy-prt/bloub)
by Jérémy Perret, vendored unmodified at commit
[`b4bb3c1b5f93`](https://github.com/jeremy-prt/bloub/tree/b4bb3c1b5f93c7b87a2e8d620f667c4093d97749).

Note when re-vendoring: `dashboard/src/lib/bot/README.md` is ours, not upstream's, and
`decor.ts` / `skins.ts` are listed in `scripts/ops/ui-hardcode-baseline.json`, so a
refresh needs that file re-copied and the baseline regenerated. The frame-generation
script this notice used to reference (`scripts/gen-bot-frames.cjs`) was removed with
the platform trim on 2026-10-28 — the atlases are now committed assets.

Copyright © 2026 Jérémy Perret

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Devin brand mark

`dashboard/public/brand-logos/devin.svg` is a monochrome vector trace of the
official Devin "nodes" mark published by Cognition at
`https://app.devin.ai/assets/pwa/apple-touch-icon.png` (also
`https://app.devin.ai/assets/pwa/pwa-icon-192.png`). The Devin name and logo
are trademarks of Cognition; the mark is bundled solely to identify the Devin
CLI source and subscription quota in the dashboard, recoloured to `currentColor` like the
other provider marks.

## Hairline line figures

[Hairline](https://github.com/lucasmarkes/hairline) v0.5.0 by Lucas Marques is declared
as a dashboard dependency (`dashboard/package.json`). It was used by the Cloud plan
page, which was removed from this fork in 1.13.2 (2026-11-02, commercial surface
removed); no current screen imports it, but the dependency and its license stay
declared until the dependency is dropped.

MIT License

Copyright (c) 2026 Lucas Marques

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## GSAP animation engine

[GSAP](https://gsap.com) v3.15.0 by GreenSock is used by the marketing pages
(`dashboard/src/ui/marketing/v3/gsap.js`). It is distributed under the GreenSock
Standard "no charge" license, **not** MIT — the npm package declares
`"license": "Standard 'no charge' license: https://gsap.com/standard-license."`
and does not ship a license file inside the tarball. The full terms live at
<https://gsap.com/standard-license/> and are the authoritative text for this
dependency.

## AIHOT leaderboard data

The "AIHOT 榜" tab on the Global Models page reads the public leaderboard at
[aihot.news](https://aihot.news/leaderboard), an open-source project by
数字生命卡兹克 (Kazik). No third-party code is vendored into this repository —
each category page is fetched once per six-hour TTL window, parsed server-side,
and cached locally (`src/lib/aihot-models.js`). Thanks to the author for
keeping the data public.

## Trademark Disclaimer

All product names, logos, brands, and registered trademarks displayed in this project (including brand icons in `dashboard/public/brand-logos/`) are property of their respective owners. Their use in TokenTracker Plus is for identification and reference purposes only, and does not imply any affiliation, sponsorship, or endorsement by the trademark holders.
