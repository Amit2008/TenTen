# Web content configuration guide

These are specification examples. The content loader and schemas are implemented in T04. No example is executable game code.

## Adopt the examples

Copy the index to public/content/index.json and create public/content/releases/1.1.0. Put manifest.json and rules.json, pieces.json, theme.json, runtime.json and audio.json there, renaming the corresponding examples. Change rules.generator.catalog from pieces.example.json to pieces.json. Asset references resolve relative to the versioned manifest directory; the index resolves relative to the app base URL.

## Change content without rebuilding code

Copy the current content into a new immutable version directory, edit and validate the files, update manifest.content_version, then deploy the complete directory. Verify its URLs before switching content/index.json. Never overwrite an existing version directory. Keep the old directory for rollback and existing tabs. The operator deploys these changes; players do not edit arbitrary local files.

## Change rules and pieces

Add a connected normalized shape with unique ID, valid integer cells, positive weight and a theme color. Remove a catalog entry to stop future draws. Support 5 through 16 rows/columns and 1 through 5 tray slots; reject pieces too large for an empty board. Use the proposed score fields. Only multiline_bonus = 0, rotation_allowed = false and undo_enabled = false are supported. New algorithms need code and acceptance tasks.

Gameplay edits change the canonical hash and isolate best scores. Existing incompatible saves remain preserved until the player chooses a new game. The xorshift32_v1 algorithm and rejection sampling are part of the rules contract. Do not substitute Math.random or silently change generator behavior.

## Change presentation and audio

Palette and feedback edits keep the gameplay hash. Runtime layout uses logical coordinates; resolution_cap controls the framebuffer without changing pointer math. Pointer offsets are specified in CSS pixels and transformed once. Respect reduced motion and preserve semantic DOM controls.

Place music under the content release directory and list paths such as music/theme_a.mp3. Short effects can use effects/place.wav. Verify decode support on the actual browser matrix. Empty music arrays and null effects are valid silence. A user gesture is required to activate audio; preloading a track is not permission to play it.

## Cache and compatibility

The HTML and content index revalidate; versioned files cache immutably. All files used by one session come from one validated compatible manifest. Record schema and runtime compatibility in that manifest. Apply a new content selection on reload, not halfway through a move. Test both root and nested base paths after every deployment change.
