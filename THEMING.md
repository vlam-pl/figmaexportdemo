# Theme Generation Workflow

This project uses **GitHub Actions** to automatically regenerate Ant Design Blazor CSS from Figma design tokens.

## How it Works

1. **Design tokens are the source of truth** - `tokens.json` contains all design values exported from Figma
2. **CSS is auto-generated** - When `tokens.json` changes, a GitHub Action regenerates the CSS files
3. **CSS files are committed** - Generated CSS is tracked in git for fast builds and deployments

## Workflow

### When you update design tokens:

1. **Edit `tokens.json`** (manually or via Figma export)
2. **Commit and push** to GitHub
3. **GitHub Action runs** automatically:
   - Detects changes to `tokens.json`
   - Runs `npm run generate:theme`
   - Commits the updated CSS files with message: `chore: regenerate theme CSS from tokens.json [skip ci]`
4. **Pull the changes** locally to get the updated CSS

### Generated Files

- `FigmaExportDemo/wwwroot/css/ant-design-blazor-custom.css` - Light theme (27K lines)
- `FigmaExportDemo/wwwroot/css/ant-design-blazor-dark.css` - Dark theme (27K lines)
- `FigmaExportDemo/wwwroot/css/figma-tokens.css` - Palette CSS variables

## Local Development

### Regenerating CSS manually (optional)

If you want to regenerate CSS locally before pushing:

```bash
npm install
npm run generate:theme
```

### Build requirements

- **Local builds**: No Node.js required (CSS pre-generated)
- **CI/CD builds**: No Node.js required (CSS pre-generated)
- **Only for manual regeneration**: Node.js 20+ and npm

## Dark Theme Support

The system supports multiple color sets in `tokens.json`:

### Light theme (`"1. Colors/Light"`)
Already exists with your current design tokens.

### Dark theme (`"1. Colors/Dark"`)
Minimal dark color set with:
- **Semantic colors**: Brighter shades (Seablue.5, Green.5, etc.) for better contrast on dark backgrounds
- **Neutral colors**: Light text on dark backgrounds

The script automatically:
- Uses semantic colors from the dark set if present
- Falls back to defaults for extended neutral variables (table backgrounds, hover states, etc.)
- Compiles a complete dark theme CSS with all component styles

### Adding/modifying color sets

To update the dark theme or add new themes:

1. Edit the color set in `tokens.json` under `"1. Colors/Dark"`
2. Commit and push
3. GitHub Action regenerates both CSS files automatically

## Architecture

### GitHub Action (`.github/workflows/generate-theme.yml`)

- **Trigger**: Changes to `tokens.json` on main/master or in PRs
- **Permissions**: Writes generated CSS back to the repo
- **Skip CI**: Uses `[skip ci]` in commit message to avoid infinite loops

### Theme Generation Script (`FigmaExportDemo/wwwroot/scripts/generate-ant-theme.js`)

- **Input**: `tokens.json` (Figma design tokens)
- **Process**: Maps tokens to Ant Design Less variables, compiles Less source from NuGet package
- **Output**: Two complete CSS files (light + dark) with all component styles

### Token Structure

```json
{
  "1. Colors/Dark": {
    "Colors": {
      "Semantic": {
        "Primary": { "colorPrimary": { "value": "{Colors.Base.Seablue.5}", "type": "color" } },
        "Success": { "colorSuccess": { "value": "{Colors.Base.Green.5}", "type": "color" } },
        ...
      },
      "Neutral": {
        "Text": { "colorText": { "value": "rgba(255, 255, 255, 0.85)", "type": "color" } },
        "Bg": { "colorBgContainer": { "value": "#1f1f1f", "type": "color" } },
        ...
      }
    }
  },
  "1. Colors/Light": { ... },
  "2. Dimensions/Default": { ... },
  "3. Typography/Default": { ... },
  "4. Components/Value": { ... }
}
```

## Benefits of This Approach

✅ **Fast builds** - No Less compilation during build, CSS is pre-generated
✅ **Simple deployment** - Build servers don't need Node.js installed
✅ **Predictable** - Same CSS everywhere, no version drift
✅ **Auditable** - CSS changes visible in git history
✅ **Designer-friendly** - Design team can push tokens.json, CSS regenerates automatically

## Migration Notes

Previously, CSS was generated during MSBuild via incremental targets. This has been removed in favor of GitHub Actions. The old MSBuild targets have been removed from `FigmaExportDemo.csproj`.

## Troubleshooting

### CSS out of sync with tokens.json
Run the GitHub Action manually or regenerate locally with `npm run generate:theme`

### GitHub Action fails
- Check that the workflow has `contents: write` permission
- Verify Node.js and .NET versions in workflow file
- Check Action logs in GitHub UI

### Local regeneration fails
- Ensure `dotnet restore` has run (needed for AntDesign NuGet package with Less source)
- Verify `npm install` completed successfully
- Check Node.js version (requires 20+)
