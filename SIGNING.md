# Signing RC-Astro CLI Wrapper

Use PixInsight's **Script > Development > CodeSign** utility. The signing key
and its password must remain outside this repository.

## Prerequisite

Open PixInsight's Process Console and run:

`lscpd`

Continue only when `FlapAstro` appears in the certified developer list.

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
.\release.ps1 -Version 1.0.1
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
