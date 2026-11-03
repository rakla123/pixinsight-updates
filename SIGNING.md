# Signing RC-Astro CLI Wrapper

Use PixInsight's **Script > Development > CodeSign** utility. The signing key
and its password must remain outside this repository.

## Prerequisite

Open PixInsight's Process Console and run:

`lscpd`

Continue only when `FlapAstro` appears in the certified developer list.

The `FlapAstro` signing authority has been approved. Use unsigned builds only
for local package testing:

```powershell
.\release.ps1 -Version 0.10.1 -Unsigned
```

This mode deliberately excludes `RcAstro.xsgn` and generates an unsigned
`updates.xri`. Do not publish this package as a production release.

## 1. Sign the script

Add this target file in CodeSign:

`source/RcAstro/RcAstro.js`

Select the FlapAstro `.xssk` keys file, enter its password, leave
**Entitlements** empty, and run CodeSign. The expected output is:

`source/RcAstro/RcAstro.xsgn`

Do not edit `RcAstro.js` after this step. Any source change invalidates the
signature.

## 2. Build the package and manifest

From the repository root, run:

```powershell
.\release.ps1 -Version 0.10.1
```

The release script includes `RcAstro.xsgn` in the ZIP, calculates the package
SHA-1, and rewrites `updates.xri`.

## 3. Sign the manifest

Run CodeSign again with this target:

`updates.xri`

CodeSign signs the XML file in place. Do not edit or regenerate `updates.xri`
afterward, because any change invalidates its XML signature.

## 4. Publish

Before committing:

- confirm that the ZIP contains `src/scripts/FlapAstro/RcAstro/RcAstro.xsgn`;
- confirm that the ZIP SHA-1 equals the `sha1` value in `updates.xri`;
- confirm that no `.xssk` file is staged.

Commit the new package, signed manifest, source signature, and any intentional
source changes together.

## CPD status and release requirements

The current wrapper exports images and launches the standalone RC-Astro CLI to process them. This architecture conflicts with CPD rule 5.8 unless PTeam grants a written exception under rule 5.6. No such exception has been verified for this documentation update. A valid CPD signature identifies the signer and protects integrity; it does not establish product approval or compliance. Documentation changes do not resolve this architectural limitation.

CPD rules version 1.0.2 were published on October 29, 2026, with an effective date of December 12, 2026. Rule 10.2 gives existing CPDs 60 days from notification to comply; the applicable notification date must be checked separately.

See the [CPD program rules](https://pixinsight.com/security/cpd-rules/). Continued CPD distribution requires resolving the architecture through a written exception or a redesign that implements processing on the PixInsight platform. User selection of the CLI under rule 5.3 does not override rule 5.8.

## Documentation-only changes and existing releases

Editing source documentation does not update an already published ZIP or its
manifest. Do not replace an archive in place or hand-edit a signed manifest.
After the CPD architecture and third-party behaviour requirements are resolved,
regenerate the HTML using DocumentationCompiler, review it against the PIDoc
source and code, build a new versioned package, calculate its hash, and sign the
new manifest through the normal release process.

If RcAstro.js is unchanged, preserve its existing signature; any change to that
script requires a new signature. Do not claim that signing alone resolves the
rule 5.8 restriction. This documentation revision is not a new signed release.
