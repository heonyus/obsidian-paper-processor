# Paper Processor for Obsidian

Academic paper processing plugin: **OCR → Translation → Blog → Slides**

Transform PDFs of academic papers into organized, translated, and presentation-ready content—all within Obsidian.

## Features

| Feature | Description | API Required |
|---------|-------------|--------------|
| **OCR** | PDF → Markdown with image extraction | Mistral |
| **Translation** | 3-phase Korean translation pipeline | Grok (xAI) |
| **Blog Generation** | Auto-generate blog posts | Gemini |
| **Slides Generation** | Create HTML presentation (3-10 slides) | Gemini |

### Translation Pipeline (3-Phase)

1. **Phase 1: Faithful Translation** - Complete, literal translation preserving all content
2. **Phase 2: Readability Enhancement** - Natural Korean with improved flow
3. **Phase 3: Structured Parsing** - JSON output with 1:1 paragraph mapping

## Installation

### Manual Installation

1. Download the latest release (`main.js`, `manifest.json`, `styles.css`)
2. Create folder: `YOUR_VAULT/.obsidian/plugins/paper-processor/`
3. Copy the files into this folder
4. Enable "Paper Processor" in Obsidian Settings → Community plugins

### From Source

```bash
git clone https://github.com/YOUR_USERNAME/obsidian-paper-processor.git
cd obsidian-paper-processor
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugin folder.

## Configuration

Go to **Settings → Paper Processor** and configure:

### API Keys (Required)

| Key | Service | Get it from |
|-----|---------|-------------|
| Mistral API Key | OCR | [console.mistral.ai](https://console.mistral.ai/) |
| Grok API Key | Translation | [x.ai](https://x.ai/) |
| Gemini API Key | Blog/Slides | [aistudio.google.com](https://aistudio.google.com/) |

### Settings

- **Output Folder**: Where processed papers are saved (default: `papers/`)
- **Translation Mode**: `faithful-only` or `full-pipeline`
- **Slide Count**: 3-10 slides
- **Slide Template**: `academic`, `minimal`, or `modern`
- **Blog Style**: `technical`, `summary`, or `tutorial`
- **Blog Language**: `ko`, `en`, or `bilingual`

## Usage

### Commands (Ctrl/Cmd + P)

| Command | Description |
|---------|-------------|
| `Paper Processor: OCR` | Convert PDF to Markdown |
| `Paper Processor: Translate` | Translate paper to Korean |
| `Paper Processor: Generate Blog` | Create blog post |
| `Paper Processor: Generate Slides` | Create HTML slides |
| `Paper Processor: Full Pipeline` | Run all steps automatically |

### Context Menu

- Right-click a **PDF file** → "OCR this PDF"
- Right-click a **Markdown file** → "Translate this file"

### Output Structure

```
papers/
└── your-paper-slug/
    ├── metadata.json        # Paper metadata
    ├── original.md          # OCR output (English)
    ├── translated_raw.md    # Phase 1: Faithful translation
    ├── translated.md        # Phase 2: Readable translation
    ├── structured.json      # Phase 3: Structured data
    ├── blog.md              # Generated blog post
    ├── slides.html          # Presentation slides
    ├── slides.json          # Slide data
    └── images/              # Extracted figures
```

## API Costs (Approximate)

| Operation | ~Cost per paper |
|-----------|-----------------|
| OCR (Mistral) | $0.05-0.10 |
| Translation (Grok) | $0.10-0.30 |
| Blog (Gemini) | $0.02-0.05 |
| Slides (Gemini) | $0.02-0.05 |

*Costs vary by paper length. These are rough estimates.*

## Development

```bash
# Install dependencies
npm install

# Development (watch mode)
npm run dev

# Production build
npm run build
```

## Roadmap

- [ ] Batch processing for multiple PDFs
- [ ] Citation extraction and linking
- [ ] Obsidian graph integration
- [ ] Custom prompt templates
- [ ] Export to PowerPoint/Google Slides
- [ ] Mobile support (currently desktop only)

## License

MIT

## Credits

Based on the [paper-ocr-translator](https://github.com/YOUR_USERNAME/paper-ocr-translator) project.
