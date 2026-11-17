# QuanDeck

React + Vite + Tailwind CSS application, originally created in Figma Make, with an Electron desktop shell.

## Development Server

Check for an existing server before starting one. Use `pnpm dev --host 127.0.0.1 --port 4173` for local preview.

- Run `pnpm exec tsc --noEmit`, `pnpm test`, and `pnpm build` before delivery.
- Desktop installers and native installation checks are documented in `desktop/README.md`.
- Keep generated installers, local connection credentials, and validation output out of Git.
- Task progress, methods, results, and charts must use the same data source. Do not fabricate completion, usage, or Agent capabilities.

## Project Structure

This is the canonical project structure. Start with task-relevant files below. Only follow imports or inspect other files when required, when a documented path is missing, or when the repository contradicts this guide.

- `src/main.tsx` - React entrypoint; imports `src/index.css` and mounts `src/App.tsx` into the `#root` element
- `src/App.tsx` - Primary application component and the usual starting point for UI work
- `src/index.css` - Global CSS entrypoint and Tailwind CSS v4 import
- `index.html` - Vite HTML shell containing the `#root` element and loading `src/main.tsx`
- `package.json` - Project dependencies and the Vite build, development, preview, and formatting scripts
- `vite.config.ts` - Vite configuration with React, Tailwind CSS v4, and Figma Make plugins plus the `@` alias for `src`
- `.mise.toml` - Toolchain versions for Node.js and pnpm

## Dependencies

- Runtime: React 19 and React DOM 19
- Styling: Tailwind CSS v4 with the `@tailwindcss/vite` plugin
- Build tooling: Vite 8, TypeScript 5.7, and `@vitejs/plugin-react`
- Formatting: oxfmt

## Styling

This project uses **Tailwind CSS v4** through the `@tailwindcss/vite` plugin configured in `vite.config.ts`. `src/index.css` imports Tailwind with `@import 'tailwindcss';`. Use Tailwind utility classes directly in JSX and put global CSS or Tailwind v4 theme customization in `src/index.css`. This scaffold does not need a Tailwind config file or PostCSS config.

`src/main.tsx` imports `src/index.css`, so global font wiring belongs in `src/index.css`. Keep CSS `@import` statements first, then add any `@font-face` rules and font-family defaults there.

Tailwind emits utility classes in `@layer utilities`, and CSS outside any cascade layer overrides every layer regardless of specificity. Put global element styles, such as resets and defaults for `body`, headings, `button`, or `input`, inside `@layer base { ... }` so utility classes on those elements still apply. Tailwind's Preflight already applies `box-sizing: border-box`, removes default margins, and sets `font: inherit` on form controls, so do not repeat those rules.

## Release platforms

As requested on 2026-11-16, future desktop releases include Apple Silicon Mac (arm64 DMG) and Windows x64 installers only. Do not build or require Intel Mac installers. Historical release artifacts are not removed.

## Clean GitHub and installer delivery (user preference)

- Publish product source, concise public documentation, and necessary synthetic fixtures only. Never commit real project databases, conversations, user attachments/screenshots, credentials, local paths, or raw native validation output.
- Completion manifests remain required locally in ignored `ops/change-manifests/`; never force-add them. Keep raw evidence and recoverable backups outside the repository or in ignored private output. Public evidence contains only source identity, artifact hashes, check outcomes, and anonymous counts.
- Run `pnpm release:check` before committing/pushing and building installers. This check must pass in CI, package preparation, and publication. Do not bypass failures or broaden the asset approval list to accommodate a user screenshot.
- Tutorial/product image additions must be synthetic or reviewed public product assets, with a reviewed content hash in `scripts/release-assets.json`. A hash change requires a fresh privacy review. Do not include real customer account, task, path, or credential information.
- Desktop packages use an explicit first-party allowlist and retain required runtime SDK dependencies. New-user initialization must remain empty: no sample project, task, conversation, runtime connection, or local credential. Synthetic fixtures run only in explicit test/smoke modes.
- If prior history or published packages contain private material, report the category and affected paths. Do not rewrite Git history or remove remote assets without specific authorization; cleaning the current tree does not erase historical copies.
