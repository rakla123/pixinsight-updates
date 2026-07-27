# RC-Astro for PixInsight

## Install in the Script menu

1. In PixInsight, open **Script > Feature Scripts**.
2. Click **Add**.
3. Select this `RcAstro` folder.
4. Let PixInsight scan the folder.
5. Click **Regenerate**, then click **Done**.
6. Start the wrapper from **Script > Utilities > RC-Astro CLI Wrapper**.

Use the documentation icon beside the Preferences (wrench) icon at the lower
right of the script window to open the integrated PIDoc help.

The triangular button at the lower left creates a reusable PixInsight process
instance from the current RC-Astro processing settings. Executable and
temporary-directory preferences remain local to each PixInsight installation
and are not embedded in process icons.

## Package layout

- `RcAstro.js` is the executable PixInsight script.
- `RcAstro.svg` is the custom Feature Scripts menu icon.
- `doc/` contains the compiler-generated runtime documentation and the PIDoc
  support files required to display it.
- `Documentation/` contains the editable `.pidoc` source. It is retained for
  maintenance and is not used when opening the bundled help page.
- `LICENSE.md` and `NOTICE.md` contain the license, warranty disclaimer, and
  third-party acknowledgments.

The package includes both the compiler-generated page at
`doc/scripts/RC-Astro CLI Wrapper/RC-Astro CLI Wrapper.html` and its source at
`Documentation/RcAstro/RcAstro.pidoc`. The script opens the bundled
compiler-generated page first. If that page is missing, it queries PixInsight's
installed documentation system.

To integrate the page into the central PixInsight documentation system:

1. Open **Script > Development > DocumentationCompiler**.
2. Add `Documentation/RcAstro/RcAstro.pidoc` as the input document.
3. Leave the base directory empty to integrate with the running PixInsight
   documentation system.
4. Enable **Generate output** and compile the document.

The compiler installs the generated page as
`doc/scripts/RC-Astro CLI Wrapper/RC-Astro CLI Wrapper.html`.

The script requires PixInsight 1.9.4 or newer with the V8 runtime and RC-Astro CLI 1.0.0 or newer.

On startup, the script checks the configured RC-Astro executable and reads its
version from `rc-astro --json`. Versions older than 1.0.0 are rejected. Versions
newer than the script's tested version (1.1.0) generate a colored warning in the
PixInsight console.

Processing has no fixed total-duration limit. A job is stopped only if RC-Astro
produces no new output for 55 minutes. This permits large images and slow CPU
processing to run for more than an hour while still detecting a stalled process.

## License

Copyright (c) 2026 FlapAstro.

Licensed under the PolyForm Noncommercial License 1.0.0. Personal, hobby,
research, educational, and other noncommercial use is permitted. See
`LICENSE.md` for the complete terms.

## Warranty disclaimer

This software is provided **"AS IS"**, without warranty of any kind, express or
implied, including but not limited to warranties of merchantability, fitness
for a particular purpose, and non-infringement. Use of the software and any
result produced by it is entirely at the user's sole risk and responsibility.
See `NOTICE.md` for the complete required notice.

## Acknowledgments

This software was developed with assistance from OpenAI Codex. The resulting
code was reviewed, tested, and is maintained under the responsibility of
FlapAstro.

RC-Astro CLI and the XTerminator products are proprietary software of RC Astro,
LLC. PixInsight is software of Pleiades Astrophoto S.L. Both are separately
licensed and are not included in this distribution. This independent wrapper
is not endorsed by either company. See `NOTICE.md` for details.

To update the script later, replace the files in this folder and use
**Script > Feature Scripts > Regenerate** to reread its feature information and
menu icon. If the entry must be removed, clear its checkbox in the Feature
Scripts list and click **Done**; current PixInsight versions do not provide a
separate Remove button.

To uninstall it from the menu, open **Script > Feature Scripts**, clear the
RC-Astro entry's checkbox, and click **Done**.
