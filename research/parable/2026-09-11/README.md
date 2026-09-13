# Parable research evidence

Captured September 11, 2026. This is research data, not a runtime catalog or a completed integration.

Repository inspected: [shellcat-com/parable at 05aa28a](https://github.com/shellcat-com/parable/tree/05aa28a43a703584aca75e20e3293b1651a72019). Live responses were independently collected from [the Parable MCP endpoint](https://parable-three.vercel.app/api/mcp); deployment/commit parity has not been established.

The [implementation plan](../../../docs/plans/parable-default-design-mcp.md) explains defaults, opt-out, design directions, architecture and delivery gates.

## Evidence files

| File | Content |
| --- | --- |
| `components.json` | All 88 source-registry items; titles, categories, dependency declarations, source paths and inspiration metadata |
| `templates.json` | All 78 live MCP template entries |
| `initialize.json`, `initialized.json` | Negotiated version and observed notification response |
| `tools.json` | Four advertised tools and their schemas |
| `list-components.json`, `list-templates.json` | Full live discovery request/response pairs |
| `get-component.json`, `get-template.json` | Details for AI Input and Fieldnote |
| `missing-component.json` | Embedded error shape for a nonexistent slug |
| `*-registry-check.json` | Three retrieved registry records: byte sizes, hashes, targets and dependency metadata; source itself is not vendored |
| `dependency-audit.json` | Static import scan; 13 entries omit the imported lucide-react dependency |

HTTP probes only sent public catalog filters/slugs and client identification. No account data, private prompts, credentials or project source was sent. No upstream code or install commands were executed.

Browser inspection covered the Parable homepage in light/dark, template gallery, and the Fieldnote live site at the available desktop viewport. This is not a full responsive or accessibility audit.

## Complete component inventory

| Component | Category | Declared npm dependencies | Registry |
| --- | --- | --- | --- |
| Activity Feed (`activity-feed`) | block | motion | [Source](https://parable-three.vercel.app/r/activity-feed.json) |
| AI Chat (`ai-chat`) | block | motion, lucide-react | [Source](https://parable-three.vercel.app/r/ai-chat.json) |
| AI Input (`ai-input`) | block | motion | [Source](https://parable-three.vercel.app/r/ai-input.json) |
| Bar Chart (`bar-chart`) | block | None declared | [Source](https://parable-three.vercel.app/r/bar-chart.json) |
| Calendar Heatmap (`calendar-heatmap`) | block | lucide-react | [Source](https://parable-three.vercel.app/r/calendar-heatmap.json) |
| CTA Banner (`cta-banner`) | block | lucide-react | [Source](https://parable-three.vercel.app/r/cta-banner.json) |
| Device Frame (`device-frame`) | block | None declared | [Source](https://parable-three.vercel.app/r/device-frame.json) |
| Donut Chart (`donut-chart`) | block | None declared | [Source](https://parable-three.vercel.app/r/donut-chart.json) |
| FAQ Accordion (`faq-accordion`) | block | motion | [Source](https://parable-three.vercel.app/r/faq-accordion.json) |
| Feature Bento (`feature-bento`) | block | motion | [Source](https://parable-three.vercel.app/r/feature-bento.json) |
| Hero Section (`hero-section`) | block | motion, lucide-react | [Source](https://parable-three.vercel.app/r/hero-section.json) |
| Kanban Board (`kanban-board`) | block | motion | [Source](https://parable-three.vercel.app/r/kanban-board.json) |
| Mega Navbar (`mega-navbar`) | block | motion, lucide-react | [Source](https://parable-three.vercel.app/r/mega-navbar.json) |
| Multi-Step Form (`multi-step-form`) | block | motion, lucide-react | [Source](https://parable-three.vercel.app/r/multi-step-form.json) |
| Pricing Table (`pricing-table`) | block | motion, lucide-react | [Source](https://parable-three.vercel.app/r/pricing-table.json) |
| Progress Ring (`progress-ring`) | block | None declared | [Source](https://parable-three.vercel.app/r/progress-ring.json) |
| Revenue Chart (`revenue-chart`) | block | lucide-react | [Source](https://parable-three.vercel.app/r/revenue-chart.json) |
| Sign-In Slice (`sign-in-slice`) | block | motion | [Source](https://parable-three.vercel.app/r/sign-in-slice.json) |
| Stat Card (`stat-card`) | block | lucide-react | [Source](https://parable-three.vercel.app/r/stat-card.json) |
| Stats Band (`stats-band`) | block | None declared | [Source](https://parable-three.vercel.app/r/stats-band.json) |
| Testimonial Marquee (`testimonial-marquee`) | block | None declared | [Source](https://parable-three.vercel.app/r/testimonial-marquee.json) |
| Token Swap Card (`token-swap-card`) | block | motion | [Source](https://parable-three.vercel.app/r/token-swap-card.json) |
| Transaction List (`transaction-list`) | block | motion | [Source](https://parable-three.vercel.app/r/transaction-list.json) |
| Tweet Grid (`tweet-grid`) | block | motion | [Source](https://parable-three.vercel.app/r/tweet-grid.json) |
| ASCII Render (`ascii-render`) | effect | None declared | [Source](https://parable-three.vercel.app/r/ascii-render.json) |
| Balloon Burst (`balloon-burst`) | effect | None declared | [Source](https://parable-three.vercel.app/r/balloon-burst.json) |
| Border Beam (`border-beam`) | effect | None declared | [Source](https://parable-three.vercel.app/r/border-beam.json) |
| Cursor Image Trail (`cursor-image-trail`) | effect | None declared | [Source](https://parable-three.vercel.app/r/cursor-image-trail.json) |
| Eye Tracking (`eye-tracking`) | effect | motion | [Source](https://parable-three.vercel.app/r/eye-tracking.json) |
| Force Graph (`force-graph`) | effect | None declared | [Source](https://parable-three.vercel.app/r/force-graph.json) |
| Gravity Dots (`gravity-dots`) | effect | None declared | [Source](https://parable-three.vercel.app/r/gravity-dots.json) |
| Image Reveal (`image-reveal`) | effect | motion | [Source](https://parable-three.vercel.app/r/image-reveal.json) |
| Logo Carousel (`logo-carousel`) | effect | motion | [Source](https://parable-three.vercel.app/r/logo-carousel.json) |
| Magnet Lines (`magnet-lines`) | effect | None declared | [Source](https://parable-three.vercel.app/r/magnet-lines.json) |
| Matrix Rain (`matrix-rain`) | effect | None declared | [Source](https://parable-three.vercel.app/r/matrix-rain.json) |
| Orbit Icons (`orbit-icons`) | effect | lucide-react | [Source](https://parable-three.vercel.app/r/orbit-icons.json) |
| Pixel Canvas (`pixel-canvas`) | effect | None declared | [Source](https://parable-three.vercel.app/r/pixel-canvas.json) |
| Squircle (`squircle`) | effect | None declared | [Source](https://parable-three.vercel.app/r/squircle.json) |
| Animated Grid (`animated-grid`) | hero | None declared | [Source](https://parable-three.vercel.app/r/animated-grid.json) |
| Aurora Background (`aurora-background`) | hero | None declared | [Source](https://parable-three.vercel.app/r/aurora-background.json) |
| Caustics Background (`caustics-background`) | hero | None declared | [Source](https://parable-three.vercel.app/r/caustics-background.json) |
| Dither Aurora (`dither-aurora`) | hero | None declared | [Source](https://parable-three.vercel.app/r/dither-aurora.json) |
| Liquid Blobs (`liquid-blobs`) | hero | None declared | [Source](https://parable-three.vercel.app/r/liquid-blobs.json) |
| Parallax Hero (`parallax-hero`) | hero | motion | [Source](https://parable-three.vercel.app/r/parallax-hero.json) |
| Animated Input (`animated-input`) | interactive | motion | [Source](https://parable-three.vercel.app/r/animated-input.json) |
| Avatar Stack (`avatar-stack`) | interactive | None declared | [Source](https://parable-three.vercel.app/r/avatar-stack.json) |
| Combination Dial (`combination-dial`) | interactive | None declared | [Source](https://parable-three.vercel.app/r/combination-dial.json) |
| Command Palette (`command-palette`) | interactive | motion | [Source](https://parable-three.vercel.app/r/command-palette.json) |
| Compare Slider (`compare-slider`) | interactive | lucide-react | [Source](https://parable-three.vercel.app/r/compare-slider.json) |
| Drag Scroll Gallery (`drag-scroll-gallery`) | interactive | None declared | [Source](https://parable-three.vercel.app/r/drag-scroll-gallery.json) |
| Dynamic Island (`dynamic-island`) | interactive | motion | [Source](https://parable-three.vercel.app/r/dynamic-island.json) |
| Expandable Card (`expandable-card`) | interactive | motion | [Source](https://parable-three.vercel.app/r/expandable-card.json) |
| Family Button (`family-button`) | interactive | motion, lucide-react | [Source](https://parable-three.vercel.app/r/family-button.json) |
| Family Drawer (`family-drawer`) | interactive | motion | [Source](https://parable-three.vercel.app/r/family-drawer.json) |
| File Drop (`file-drop`) | interactive | motion, lucide-react | [Source](https://parable-three.vercel.app/r/file-drop.json) |
| Gooey Toggle (`gooey-toggle`) | interactive | motion, lucide-react | [Source](https://parable-three.vercel.app/r/gooey-toggle.json) |
| Hover Member Row (`hover-member-row`) | interactive | motion | [Source](https://parable-three.vercel.app/r/hover-member-row.json) |
| Image Zoom (`image-zoom`) | interactive | motion, lucide-react | [Source](https://parable-three.vercel.app/r/image-zoom.json) |
| Intro Disclosure (`intro-disclosure`) | interactive | motion | [Source](https://parable-three.vercel.app/r/intro-disclosure.json) |
| Liquid Metal Button (`liquid-metal-button`) | interactive | None declared | [Source](https://parable-three.vercel.app/r/liquid-metal-button.json) |
| Magnetic Dock (`magnetic-dock`) | interactive | motion | [Source](https://parable-three.vercel.app/r/magnetic-dock.json) |
| Morph Surface (`morph-surface`) | interactive | motion, lucide-react | [Source](https://parable-three.vercel.app/r/morph-surface.json) |
| Morph Tabs (`morph-tabs`) | interactive | motion, lucide-react | [Source](https://parable-three.vercel.app/r/morph-tabs.json) |
| Notification Stack (`notification-stack`) | interactive | motion | [Source](https://parable-three.vercel.app/r/notification-stack.json) |
| Orbit Card Stack (`orbit-card-stack`) | interactive | motion, lucide-react | [Source](https://parable-three.vercel.app/r/orbit-card-stack.json) |
| Peek Carousel (`peek-carousel`) | interactive | motion, lucide-react | [Source](https://parable-three.vercel.app/r/peek-carousel.json) |
| Rich Tooltip (`rich-tooltip`) | interactive | motion | [Source](https://parable-three.vercel.app/r/rich-tooltip.json) |
| Section Dots (`section-dots`) | interactive | motion | [Source](https://parable-three.vercel.app/r/section-dots.json) |
| Shift Card (`shift-card`) | interactive | motion | [Source](https://parable-three.vercel.app/r/shift-card.json) |
| Shimmer Button (`shimmer-button`) | interactive | None declared | [Source](https://parable-three.vercel.app/r/shimmer-button.json) |
| Spotlight Card (`spotlight-card`) | interactive | None declared | [Source](https://parable-three.vercel.app/r/spotlight-card.json) |
| Stepper (`stepper`) | interactive | lucide-react | [Source](https://parable-three.vercel.app/r/stepper.json) |
| Sticky Scroll Cards (`sticky-scroll-cards`) | interactive | motion | [Source](https://parable-three.vercel.app/r/sticky-scroll-cards.json) |
| Texture Button (`texture-button`) | interactive | None declared | [Source](https://parable-three.vercel.app/r/texture-button.json) |
| Theme Toggle (`theme-toggle`) | interactive | None declared | [Source](https://parable-three.vercel.app/r/theme-toggle.json) |
| Wallet Stack (`wallet-stack`) | interactive | motion | [Source](https://parable-three.vercel.app/r/wallet-stack.json) |
| Waveform Scrubber (`waveform-scrubber`) | interactive | None declared | [Source](https://parable-three.vercel.app/r/waveform-scrubber.json) |
| Dot Matrix Loader (`dot-matrix-loader`) | loader | None declared | [Source](https://parable-three.vercel.app/r/dot-matrix-loader.json) |
| Skeleton (`skeleton`) | loader | None declared | [Source](https://parable-three.vercel.app/r/skeleton.json) |
| Animated Counter (`animated-counter`) | text | None declared | [Source](https://parable-three.vercel.app/r/animated-counter.json) |
| Axis Specimen (`axis-specimen`) | text | None declared | [Source](https://parable-three.vercel.app/r/axis-specimen.json) |
| Gradient Heading (`gradient-heading`) | text | None declared | [Source](https://parable-three.vercel.app/r/gradient-heading.json) |
| Kinetic Text (`kinetic-text`) | text | motion | [Source](https://parable-three.vercel.app/r/kinetic-text.json) |
| Scroll Text Reveal (`scroll-text-reveal`) | text | motion | [Source](https://parable-three.vercel.app/r/scroll-text-reveal.json) |
| Split Flap (`split-flap`) | text | None declared | [Source](https://parable-three.vercel.app/r/split-flap.json) |
| Text Highlighter (`text-highlighter`) | text | motion | [Source](https://parable-three.vercel.app/r/text-highlighter.json) |
| Text Scramble (`text-scramble`) | text | None declared | [Source](https://parable-three.vercel.app/r/text-scramble.json) |
| Velocity Marquee (`velocity-marquee`) | text | None declared | [Source](https://parable-three.vercel.app/r/velocity-marquee.json) |

Dependencies above are declarations, not a verified complete dependency closure. All imports also require a compatible React/TSX environment and any referenced styling setup.

## Complete template inventory

| Template | Stable slug | Family | Stack | Live preview |
| --- | --- | --- | --- | --- |
| Quench | `quench` | parable | static | [Open](https://shellcat-com.github.io/quench/) |
| Peony | `peony` | parable | static | [Open](https://shellcat-com.github.io/peony/) |
| Beaufort | `beaufort` | parable | static | [Open](https://shellcat-com.github.io/beaufort/) |
| Cornice | `cornice` | parable | static | [Open](https://shellcat-com.github.io/cornice/) |
| Lather | `lather` | parable | static | [Open](https://shellcat-com.github.io/lather/) |
| Longbox | `longbox` | parable | static | [Open](https://shellcat-com.github.io/longbox/) |
| Oubliette | `oubliette` | parable | static | [Open](https://shellcat-com.github.io/oubliette/) |
| Dovetail | `dovetail` | parable | static | [Open](https://shellcat-com.github.io/dovetail/) |
| Fathom | `fathom` | parable | static | [Open](https://shellcat-com.github.io/fathom/) |
| Selvedge | `selvedge` | parable | static | [Open](https://shellcat-com.github.io/selvedge/) |
| Conche | `conche` | parable | astro | [Open](https://shellcat-com.github.io/conche/) |
| Yugen | `yugen` | parable | astro | [Open](https://shellcat-com.github.io/yugen/) |
| Nightcap | `nightcap` | parable | astro | [Open](https://shellcat-com.github.io/nightcap/) |
| Vitrine | `vitrine` | parable | astro | [Open](https://shellcat-com.github.io/vitrine/) |
| Deckle | `deckle` | parable | astro | [Open](https://shellcat-com.github.io/deckle/) |
| Rennet | `rennet` | parable | astro | [Open](https://shellcat-com.github.io/rennet/) |
| Halfstep | `halfstep` | parable | vite | [Open](https://shellcat-com.github.io/halfstep/) |
| Crux | `crux` | parable | vite | [Open](https://shellcat-com.github.io/crux/) |
| Splits | `splits` | parable | vite | [Open](https://shellcat-com.github.io/splits/) |
| Patchbay | `patchbay` | parable | vite | [Open](https://shellcat-com.github.io/patchbay/) |
| Endgame | `endgame` | parable | svelte | [Open](https://shellcat-com.github.io/endgame/) |
| Meeplewood | `meeplewood` | parable | svelte | [Open](https://shellcat-com.github.io/meeplewood/) |
| Mise | `mise` | parable | svelte | [Open](https://shellcat-com.github.io/mise/) |
| Glyphica | `glyphica` | parable | next | [Open](https://shellcat-com.github.io/glyphica/) |
| Redoubt | `redoubt` | parable | next | [Open](https://shellcat-com.github.io/redoubt/) |
| Earshot | `earshot` | parable | next | [Open](https://shellcat-com.github.io/earshot/) |
| Aperture Lab | `aperture-lab` | parable | static | [Open](https://shellcat-com.github.io/aperture-lab/) |
| Northbound | `northbound-ev` | parable | static | [Open](https://shellcat-com.github.io/northbound-ev/) |
| Perigee | `perigee-astro` | parable | static | [Open](https://shellcat-com.github.io/perigee-astro/) |
| Kiln Collective | `kiln-collective` | parable | astro | [Open](https://shellcat-com.github.io/kiln-collective/) |
| Meridian | `meridian-advisor` | parable | next | [Open](https://shellcat-com.github.io/meridian-advisor/) |
| Undertow | `undertow-festival` | parable | static | [Open](https://shellcat-com.github.io/undertow-festival/) |
| Fernweh | `fernweh-cabins` | parable | astro | [Open](https://shellcat-com.github.io/fernweh-cabins/) |
| Loop & Larder | `loop-and-larder` | parable | astro | [Open](https://shellcat-com.github.io/loop-and-larder/) |
| Halcyon Ring | `halcyon-ring` | parable | static | [Open](https://shellcat-com.github.io/halcyon-ring/) |
| Vantage Point | `vantage-point-studio` | parable | static | [Open](https://shellcat-com.github.io/vantage-point-studio/) |
| Static & Noise | `static-and-noise` | parable | static | [Open](https://shellcat-com.github.io/static-and-noise/) |
| Driftline | `driftline-ocean` | parable | static | [Open](https://shellcat-com.github.io/driftline-ocean/) |
| Fieldnote | `fieldnote-research` | parable | next | [Open](https://shellcat-com.github.io/fieldnote-research/) |
| Threadbare | `threadbare-resale` | parable | next | [Open](https://shellcat-com.github.io/threadbare-resale/) |
| Recess | `recess-learn` | parable | svelte | [Open](https://shellcat-com.github.io/recess-learn/) |
| Continuum Health | `continuum-health` | parable | static | [Open](https://shellcat-com.github.io/continuum-health/) |
| Backstage Pass | `backstage-pass` | parable | static | [Open](https://shellcat-com.github.io/backstage-pass/) |
| Longwave | `longwave-climate` | parable | static | [Open](https://shellcat-com.github.io/longwave-climate/) |
| The Marginalia | `the-marginalia` | parable | astro | [Open](https://shellcat-com.github.io/the-marginalia/) |
| Hangar 12 | `hangar-12` | parable | static | [Open](https://shellcat-com.github.io/hangar-12/) |
| Bramble | `bramble-home` | parable | astro | [Open](https://shellcat-com.github.io/bramble-home/) |
| Ledger & Vine | `ledger-and-vine` | parable | static | [Open](https://shellcat-com.github.io/ledger-and-vine/) |
| Overclock | `overclock-games` | parable | static | [Open](https://shellcat-com.github.io/overclock-games/) |
| Farebox | `farebox-transit` | parable | vite | [Open](https://shellcat-com.github.io/farebox-transit/) |
| Ninth Wave | `ninth-wave-surf` | parable | static | [Open](https://shellcat-com.github.io/ninth-wave-surf/) |
| Neon | `formwork-neon` | formwork | static | [Open](https://shellcat-com.github.io/formwork-neon/) |
| Aether | `formwork-aether` | formwork | static | [Open](https://shellcat-com.github.io/formwork-aether/) |
| Algorithm | `formwork-algorithm` | formwork | static | [Open](https://shellcat-com.github.io/formwork-algorithm/) |
| Atelier | `formwork-atelier` | formwork | static | [Open](https://shellcat-com.github.io/formwork-atelier/) |
| Aurelis | `formwork-aurelis` | formwork | static | [Open](https://shellcat-com.github.io/formwork-aurelis/) |
| Aurum | `formwork-aurum` | formwork | static | [Open](https://shellcat-com.github.io/formwork-aurum/) |
| Award | `formwork-award` | formwork | static | [Open](https://shellcat-com.github.io/formwork-award/) |
| Chroma | `formwork-chroma` | formwork | static | [Open](https://shellcat-com.github.io/formwork-chroma/) |
| Clay | `formwork-clay` | formwork | static | [Open](https://shellcat-com.github.io/formwork-clay/) |
| Contour | `formwork-contour` | formwork | static | [Open](https://shellcat-com.github.io/formwork-contour/) |
| Driftwear | `formwork-driftwear` | formwork | static | [Open](https://shellcat-com.github.io/formwork-driftwear/) |
| Farside | `formwork-farside` | formwork | static | [Open](https://shellcat-com.github.io/formwork-farside/) |
| Grid | `formwork-grid` | formwork | static | [Open](https://shellcat-com.github.io/formwork-grid/) |
| Halo | `formwork-halo` | formwork | static | [Open](https://shellcat-com.github.io/formwork-halo/) |
| Heliodon | `formwork-heliodon` | formwork | static | [Open](https://shellcat-com.github.io/formwork-heliodon/) |
| Isometria | `formwork-isometria` | formwork | static | [Open](https://shellcat-com.github.io/formwork-isometria/) |
| Meridian | `formwork-meridian` | formwork | static | [Open](https://shellcat-com.github.io/formwork-meridian/) |
| Monolith | `formwork-monolith` | formwork | static | [Open](https://shellcat-com.github.io/formwork-monolith/) |
| Nebula | `formwork-nebula` | formwork | static | [Open](https://shellcat-com.github.io/formwork-nebula/) |
| Phosphor | `formwork-phosphor` | formwork | static | [Open](https://shellcat-com.github.io/formwork-phosphor/) |
| Resonance | `formwork-resonance` | formwork | static | [Open](https://shellcat-com.github.io/formwork-resonance/) |
| Revolver | `formwork-revolver` | formwork | static | [Open](https://shellcat-com.github.io/formwork-revolver/) |
| Roastery | `formwork-roastery` | formwork | static | [Open](https://shellcat-com.github.io/formwork-roastery/) |
| Soma | `formwork-soma` | formwork | static | [Open](https://shellcat-com.github.io/formwork-soma/) |
| Sumi | `formwork-sumi` | formwork | static | [Open](https://shellcat-com.github.io/formwork-sumi/) |
| Velocity | `formwork-velocity` | formwork | static | [Open](https://shellcat-com.github.io/formwork-velocity/) |
| Zodiac | `formwork-zodiac` | formwork | static | [Open](https://shellcat-com.github.io/formwork-zodiac/) |

All template metadata was inventoried; only Fieldnote was opened as an individual live template in this pass. Preview links, repository ownership, assets and application behavior must be checked when promoting each entry. Names are not unique (for example, Meridian); use source ID plus slug as the identity.
