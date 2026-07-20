# Retivum icon assets

`icon.svg` is the canonical application artwork. Edit or replace this file,
then run:

```sh
npm run icons:generate
```

The normal `npm run build` command runs the generator automatically. It creates
the browser, iOS, Android, Electron, Windows, Linux and macOS icon variants.
Browser/PWA and Windows/Linux icons preserve the source transparency. Platforms
that require a complete tile receive a generated white background; Android's
adaptive foreground remains transparent over its separate background layer.

`icon-macos.svg` is a generated platform-specific preview. On macOS, the
complete canonical artwork is fitted to and clipped by a rounded application
tile, so opaque SVG backgrounds do not create a second inset square.

`icon-light.ai` is retained as original design source,
but builds use `icon.svg` as their single source of truth.
