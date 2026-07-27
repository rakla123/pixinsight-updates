# FlapAstro PixInsight Updates

Official PixInsight update repository for the **RC-Astro CLI Wrapper**.

## Installation

1. In PixInsight, open **Resources > Updates > Manage Repositories**.
2. Add this repository URL:

   `https://rakla123.github.io/pixinsight-updates/`

3. Run **Resources > Updates > Check for Updates**.
4. Apply the available update and restart PixInsight.

The trailing slash in the repository URL is required.

If RC-Astro CLI Wrapper was previously registered manually through Feature
Scripts, disable that manual entry before installing the repository version to
avoid duplicate script identifiers.

## Requirements

- PixInsight 1.9.4 or newer
- RC-Astro CLI 1.0.0 or newer

## Package contents

- `updates.xri` — PixInsight update manifest
- `packages/` — installation-root update archives
- `release.ps1` — local release package and manifest generator

## Signing

Production releases should contain `RcAstro.xsgn`, and `updates.xri` should be
signed with PixInsight's **Script > Development > CodeSign** utility using the
certified FlapAstro signing identity.

Never commit a `.xssk` private signing-key file or its password.

