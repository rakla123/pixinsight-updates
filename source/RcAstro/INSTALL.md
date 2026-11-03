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
- `doc/` contains the runtime documentation page. Its relative PIDoc assets are
  supplied by PixInsight's central documentation installation.
- `Documentation/` contains the editable `.pidoc` source. It is retained for
  maintenance and is not used when opening the bundled help page.
- `LICENSE.md` and `NOTICE.md` contain the license, warranty disclaimer, and
  third-party acknowledgments.

The package includes both the compiler-generated page at
`doc/scripts/RC-Astro CLI Wrapper/RC-Astro CLI Wrapper.html` and its source at
`Documentation/RcAstro/RcAstro.pidoc`. The script opens the bundled
HTML page first. If that page is missing, it queries PixInsight's
installed documentation system.

To integrate the page into the central PixInsight documentation system:

1. Open **Script > Development > DocumentationCompiler**.
2. Add `Documentation/RcAstro/RcAstro.pidoc` as the input document.
3. Leave the base directory empty to integrate with the running PixInsight
   documentation system.
4. Enable **Generate output** and compile the document.

The compiler installs the generated page as
`doc/scripts/RC-Astro CLI Wrapper/RC-Astro CLI Wrapper.html`.

The script requires PixInsight 1.9.5 or newer with the V8 runtime and RC-Astro CLI 1.0.0 or newer.
Temporary active-view XISF files preserve storable image properties, the native
1.9.5 astrometric solution, FITS keywords, resolution, and RGB working space.

On startup, the script checks the configured RC-Astro executable and reads its
version from `rc-astro --json`. Versions older than 1.0.0 are rejected. Versions
newer than the script's tested version (1.1.3) generate a colored warning in the
PixInsight console.

Processing has no fixed total-duration limit. A job is stopped only if RC-Astro
produces no new output for 5 minutes. This permits large images and slow CPU
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

## CPD status and release requirements

The current wrapper exports images and launches the standalone RC-Astro CLI to process them. This architecture conflicts with CPD rule 5.8 unless PTeam grants a written exception under rule 5.6. No such exception has been verified for this documentation update. A valid CPD signature identifies the signer and protects integrity; it does not establish product approval or compliance. Documentation changes do not resolve this architectural limitation.

CPD rules version 1.0.2 were published on October 29, 2026, with an effective date of December 12, 2026. Rule 10.2 gives existing CPDs 60 days from notification to comply; the applicable notification date must be checked separately.

See the [CPD program rules](https://pixinsight.com/security/cpd-rules/). Continued CPD distribution requires resolving the architecture through a written exception or a redesign that implements processing on the PixInsight platform. User selection of the CLI under rule 5.3 does not override rule 5.8.

## Execution and user choice

The script launches the configured RC-Astro executable with --json at startup, before its main dialog opens, to check compatibility. If no path has been saved, it searches C:/Program Files/RC-Astro/cli/rc-astro.exe, C:/Program Files/RC-Astro/rc-astro.exe, and C:/Program Files (x86)/RC-Astro/cli/rc-astro.exe. Preferences lets the user select another executable; saving a valid selection also probes it. Successful probes are cached for the script session. Processing launches the same executable with the selected bxt, sxt, or nxt command and arguments. The wrapper does not install or license the CLI.

## Files and storage

The default working directory is the operating-system temporary directory returned by File.systemTempDirectory. The user can change it in Preferences. Active-view mode writes <view-id>_rcastro_input.xisf, <view-id>_BXT.xisf, <view-id>_SXT.xisf, or <view-id>_NXT.xisf, and <view-id>_rcastro_<tool>.log in that directory. The view identifier is sanitized for filenames. Manual-file mode uses the selected input, output, and log paths. StarXTerminator can additionally produce a companion stars image beside its main output.

## Retention and overwrite

The temporary active-view input is deleted after completion, failure, or cancellation unless Keep temporary input file is enabled. Outputs and logs are retained; there is no automatic cleanup for them. Temporary filenames are deterministic rather than unique per run. An existing temporary input at the generated path is removed before export. Overwrite is enabled by default; when enabled, existing main outputs and recognized stars-output candidates are removed before processing, so a failed run does not restore them. Use a dedicated working directory and preserve needed outputs before another run.

## Logs and preferences

Logs contain timestamps, executable and image paths, selected command and arguments, processing status, and RC-Astro stdout/stderr. Extra command-line arguments can consequently appear in logs; do not include secrets in them. Preferences are stored through the PJSR Settings interface under RcAstroGUI/. The wrapper does not directly edit PixInsight core settings files. Review logs before sharing them.

## Result opening

The Open result option controls opening the main output. When StarXTerminator stars output is requested and a recognized companion file is found, the current code opens that stars image even if Open result is disabled. The wrapper copies the input display STF when available without changing output pixels.

## Network and third-party behaviour

RcAstro.js contains no direct network-transfer or telemetry calls and no executable downloader. This is a source-level statement about the wrapper, not a guarantee about the separately installed RC-Astro CLI. The CLI's network connections, licensing traffic, model downloads, cache locations, and integrity verification have not been verified here. Do not describe the combined product as offline or fully compliant on this basis. Before any release represented as CPD-compliant, verify and document those behaviours for supported CLI versions, including endpoints, purposes, storage locations, secure transport, integrity checks, and any consent requirements.
