# Research sources

Accessed 29 October 2026.

[S1] Gram Games official 1010 page
https://gram.gs/game-detail-1010.html
Primary description: endless random block placement, horizontal and vertical line clears, no timer or speed escalation.

[S2] 1010 Block Puzzle Game App Store listing
https://apps.apple.com/us/app/1010-block-puzzle-game/id911793120
Publisher listing: 10 by 10 board, no color matching, themes. The live app evolves; this specification targets classic endless play.

[S3] Zynga official 1010 product page and screenshot
https://www.zynga.com/games/1010
Primary visual reference. Screenshot shows a pale board, colored square tiles, score above and a three-piece tray below.

[S4] Zynga support How do I play the game
https://zyngasupport.helpshift.com/hc/en/87-1010/faq/13689-how-do-i-play-the-game/?l=en
Primary support confirms fitting pieces and clearing completed horizontal or vertical lines.

[S5] YALSA App of the Week 1010 published 15 July 2015
https://yalsa.ala.org/blog/2015/07/15/app-of-the-week-1010/
Contemporary secondary account: 10 by 10 board, three shapes, replacement after all three are used, play until space runs out.

[S6] PixiJS application and renderer documentation
https://pixijs.com/8.x/guides/components/application
Renderer initialization, renderer preference, resolution and sizing. Verify exact APIs against the pinned stable release; this plan requires WebGL2.

[S7] Vite static deployment guide
https://vite.dev/guide/static-deploy
Static production build and deployment base path. The preview server is for local inspection, not production hosting.

[S8] MDN Pointer events
https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
Unified pointer handling, capture, cancellation and touch-action behavior.

[S9] MDN Using IndexedDB
https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
Transactional browser persistence, completion events and the limits of saving during unload.

[S10] MDN Storage quotas and eviction criteria
https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
Storage is scoped to the origin and can be evicted or cleared; private sessions have additional limitations.

[S11] MDN Web Audio best practices
https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices
User-gesture requirements and suspended audio contexts.

[S12] MDN WebGL context loss
https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/isContextLost
Graphics contexts can be lost during normal browser or GPU operation.

[S13] Vite static asset handling and build paths
https://vite.dev/guide/assets
Public files can retain stable names. Runtime content URL construction must also respect the deployment base.

Exact original scoring, shape inventory, generator weights and animation timings are unverified. Proposed values in the GDD are design decisions.
