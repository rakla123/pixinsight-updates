# FlapAstro PixInsight Updates

Source archive for the **RC-Astro CLI Wrapper** for PixInsight. Signed distribution has been withdrawn.

This is an independent product, not endorsed or supported by Pleiades Astrophoto S.L. or RC Astro, LLC.


## CPD status and release requirements

The current wrapper exports images and launches the standalone RC-Astro CLI to process them. This architecture conflicts with CPD rule 5.8 unless PTeam grants a written exception under rule 5.6. No such exception has been verified for this documentation update. A valid CPD signature identifies the signer and protects integrity; it does not establish product approval or compliance. Documentation changes do not resolve this architectural limitation.

CPD rules version 1.0.2 were published on October 29, 2026, with an effective date of December 12, 2026. Rule 10.2 gives existing CPDs 60 days from notification to comply; the applicable notification date must be checked separately.

See the [CPD program rules](https://pixinsight.com/security/cpd-rules/). Continued CPD distribution requires resolving the architecture through a written exception or a redesign that implements processing on the PixInsight platform. User selection of the CLI under rule 5.3 does not override rule 5.8.

## Distribution withdrawn

The RC-Astro CLI Wrapper was removed from signed distribution on 10 November 2026. This repository no longer publishes an update manifest or installable package downloads. Source code and Git history are retained for reference.

If you previously added this URL to PixInsight, remove it under **Resources > Updates > Manage Repositories** to avoid update-check errors:

`https://raw.githubusercontent.com/rakla123/pixinsight-updates/main/`

Withdrawal does not uninstall existing copies. Historical commits and tags may still contain previously published artifacts; they are not current releases.

## Requirements

- PixInsight 1.9.5 or newer (V8 runtime)
- RC-Astro CLI 1.0.0 or newer

Active-view inputs are serialized as temporary XISF files. The wrapper
preserves storable view properties, PixInsight 1.9.5 astrometric solutions,
FITS keywords, image resolution, and the RGB working space.

## Runtime behaviour

See [execution, storage, retention, and network limitations](source/RcAstro/INSTALL.md#execution-and-user-choice) before use.

## Package contents

- `source/RcAstro/` — authoritative script and documentation sources
- `release.ps1` — local release package and manifest generator

## Historical signing workflow

Signed distribution is withdrawn. The following records the former release procedure and is not an instruction to publish a new signed release.

The `FlapAstro` signing authority is approved. Production releases must be
signed. The `-Unsigned` switch is reserved for local test builds:

`.\release.ps1 -Version 0.10.2 -Unsigned`

Production packages must contain `RcAstro.xsgn`, and `updates.xri` must be
signed with PixInsight's **Script > Development > CodeSign** utility using the
certified FlapAstro signing identity.

Signing is intentionally a two-stage operation:

1. Confirm that `FlapAstro` is listed by the `lscpd` command in PixInsight's
   Process Console.
2. In CodeSign, sign `source/RcAstro/RcAstro.js`. Use the private `.xssk` file
   stored outside this repository, enter its password, and leave Entitlements
   empty. CodeSign creates `source/RcAstro/RcAstro.xsgn`.
3. Build a new release package and unsigned manifest:

   `.\release.ps1 -Version 0.10.2`

4. In CodeSign, sign `updates.xri`. This adds the XML signature in place and
   must be the final modification to that file.
5. Verify the package SHA-1 against `updates.xri`, then commit and publish the
   new `.xsgn`, package, and signed manifest together.

Never commit a `.xssk` private signing-key file or its password.
