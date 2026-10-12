/**
 * Complete, copyable design prompts written for image models such as Nano Banana Pro, Imagen, or GPT Image.
 *
 * Each prompt follows the same structure: a one-line brief, labelled sections for the main element, composition, materials or
 * finish, palette, and strict constraints, then an output specification. Placeholders in [SQUARE BRACKETS] are the only parts
 * meant to change between uses. The catalog is grouped the way working designers brief this kind of work, following the
 * categories in AmirMušić's public "50 design prompts" catalog (https://x.com/AmirMushich/status/2019073081881293302); the
 * prompt text here is original.
 */

export const DESIGN_GROUPS = {
  branding: { label: "Brand identity", description: "Logos, lettermarks, and whole brand kits from a single brief." },
  products: { label: "Branded products", description: "Product and packaging concepts carried by an existing brand's identity." },
  objects: { label: "3D objects", description: "Logos and marks rendered as physical materials with realistic lighting." },
  posters: { label: "Posters & illustration", description: "Editorial layouts, grids, and illustration styles for print or social." },
  icons: { label: "Icons & stickers", description: "Consistent asset sets for decks, documentation, and social content." },
  mockups: { label: "Mockups", description: "Real-world objects photographed with your logo or artwork applied." },
  apparel: { label: "Apparel", description: "Garments and sportswear rendered with fabric-accurate texture and fit." },
  typography: { label: "Typography", description: "Custom lettering, monograms, and typographic systems." },
} as const;

export type DesignGroup = keyof typeof DESIGN_GROUPS;

export interface DesignExample {
  /** Stable id used in the Examples page anchors and the `?design=` query parameter. */
  readonly id: string;
  readonly title: string;
  readonly group: DesignGroup;
  /** One sentence on what the prompt produces and which placeholders to fill. */
  readonly description: string;
  readonly prompt: string;
}

const EXAMPLES: readonly DesignExample[] = [
  {
    id: "brand-kit",
    title: "Brand kit from one brief",
    group: "branding",
    description: "A single board with logo, palette, type pairing, and three applications. Fill in the brand name, industry, and tone.",
    prompt: `Design a complete starter brand kit for "[BRAND NAME]", a [INDUSTRY] company whose personality is [THREE ADJECTIVES, e.g. calm, precise, generous].

LAYOUT:
One landscape presentation board on a neutral off-white background, divided into a clean 3 x 2 grid with equal gutters. Label each cell with a small, understated caption in the top-left corner.

CELLS, IN ORDER:
1. Primary logo: a wordmark for "[BRAND NAME]" with one simple geometric mark that could stand alone as an app icon.
2. Color palette: five swatches shown as tall rectangles with hex codes printed beneath them. One dominant color, one accent, three neutrals.
3. Typography: one heading typeface and one body typeface shown as "Aa" specimens with a two-line sample sentence set in each.
4. Business card: front and back, flat lay, slight shadow.
5. Social avatar and cover image: shown together inside a phone-screen frame.
6. Packaging or signage: one application that fits the industry (a label, a storefront sign, or an app splash screen).

STYLE RULES:
Everything in the kit must share the same geometry, spacing, and color logic so the board reads as one system. Flat, vector-like rendering with soft, realistic shadows only where a physical object is shown. No gradients, no stock photography, no decorative textures.

STRICT:
Spell "[BRAND NAME]" exactly, with no extra letters or alternative spellings. Do not add any other words, taglines, or lorem ipsum. Do not show people.

OUTPUT:
One image, 16:9, high resolution, sharp edges, print-ready contrast.`,
  },
  {
    id: "geometric-logo",
    title: "Swiss-style geometric logo",
    group: "branding",
    description: "Rebuilds any brand's mark from circles, squares, and a strict grid. Replace the brand name only.",
    prompt: `Reinterpret the logo of "[BRAND NAME]" as a Swiss-style geometric mark in the tradition of 1960s international typographic design.

CONSTRUCTION:
Build the mark only from circles, squares, and 45-degree diagonals placed on a visible 8 x 8 construction grid. The silhouette must still be recognizable as the original brand within one second. Keep the same proportions as the original; change the construction, not the identity.

COMPOSITION:
The mark sits centered on a square canvas. Below it, set "[BRAND NAME]" in a tight, lowercase grotesque sans-serif (Helvetica-like), letter-spaced slightly tight. Leave generous negative space: the mark occupies at most 40% of the canvas height.

GRID OVERLAY:
Show the construction grid as hairline rules at 15% opacity behind the mark, with small circles marking the key anchor points, as in a brand guidelines page.

COLOR:
Exactly two colors: one solid background and one solid ink color for the mark, the name, and the grid. Choose the pair from the brand's real palette. No gradients, no shadows, no textures.

STRICT:
Flat vector rendering with perfectly smooth edges. No 3D, no bevels, no additional text, no decorative elements beyond the grid.

OUTPUT:
One image, 1:1, high resolution.`,
  },
  {
    id: "product-concept",
    title: "Unexpected product concept by a brand",
    group: "products",
    description: "Puts a brand's identity on a product it has never made. Fill in the brand and the product category.",
    prompt: `Create a high-end product concept: a [PRODUCT, e.g. mechanical keyboard, espresso machine, road bike] designed and sold by "[BRAND NAME]".

DESIGN LOGIC:
Translate the brand's existing visual identity into industrial design: use its primary colors as the main body color and its accent color for one deliberate detail (a dial, a stitch, a button, a cap). Apply the logo once, small, in the place a real manufacturer would put it. The product must look like a plausible production unit, not a sticker on a generic object.

PHOTOGRAPHY:
Studio product photography on a seamless background in a muted tone that complements the brand palette. Three-quarter hero angle, slightly above eye level. Soft key light from the upper left, a large gradient reflection along the main surfaces, a faint contact shadow. 85mm lens look, everything in sharp focus.

MATERIALS:
Render materials truthfully: anodized aluminum, matte polymer, leather, or glass as the product requires. Show fine surface detail such as machining marks, grain, or seams at close range.

STRICT:
Spell "[BRAND NAME]" and reproduce its logo accurately. No additional text, no packaging, no hands, no people, no scene props beyond the product itself.

OUTPUT:
One image, 4:5, high resolution, photorealistic.`,
  },
  {
    id: "capsule-collection",
    title: "Branded souvenir capsule collection",
    group: "products",
    description: "A flat lay of six branded souvenirs that read as one collection. Replace the brand name and, optionally, the city.",
    prompt: `Design a capsule collection of six branded souvenirs for "[BRAND NAME]", themed around [PLACE OR EVENT, e.g. the Tokyo flagship opening].

THE SIX OBJECTS:
An enamel pin, a ceramic mug, a woven keychain, a matchbox, a folded tote bag, and a postcard. Each object carries the brand's logo or wordmark once, and all six share one motif drawn from the theme (a skyline, a landmark, a date, or a pattern), used consistently.

COMPOSITION:
Overhead flat lay on a solid, lightly textured paper background. Objects arranged in a loose 3 x 2 grid with even spacing, none overlapping, none cropped. Shadows are soft and fall in one direction.

COLOR SYSTEM:
Use the brand's primary color on at least half of the objects and its accent color on the rest. The background must contrast with both. No colors outside the brand palette except the natural material colors of ceramic, cotton, and cardboard.

MATERIALS:
Render each material accurately: glossy hard enamel, matte glazed ceramic, woven polyester, printed cardboard, natural cotton canvas, uncoated card stock.

STRICT:
Spell "[BRAND NAME]" exactly. No extra words, no price tags, no hands, no people.

OUTPUT:
One image, 4:5, high resolution, photorealistic.`,
  },
  {
    id: "metallic-logo",
    title: "Dark metallic logo render",
    group: "objects",
    description: "A brand mark cast in brushed metal under hard studio light. Replace the brand name only.",
    prompt: `Render the logo of "[BRAND NAME]" as a solid metal object.

OBJECT:
The logo is extruded 20 mm thick with slightly rounded edges and cast in dark gunmetal steel. The front face is brushed in one direction; the edges are polished to a mirror finish so they catch the light as thin bright lines.

LIGHTING:
Near-black studio environment. One hard key light from the upper right producing crisp highlights along the polished edges and a long specular streak on the brushed face. One dim cool rim light from the lower left to separate the object from the background. No fill light; let the shadow side fall into darkness.

CAMERA:
Three-quarter view, slightly below center so the object feels monumental. Shallow depth of field with the nearest edge in perfect focus. Subtle reflection of the object on a black polished floor.

STRICT:
Reproduce the logo's geometry and proportions exactly; do not restyle or simplify it. No text other than what the logo itself contains. No additional objects, no color apart from the metal and the cool rim light.

OUTPUT:
One image, 1:1, high resolution, photorealistic.`,
  },
  {
    id: "wax-seal",
    title: "Wax seal logo",
    group: "objects",
    description: "Presses a logo into a tactile wax seal on paper. Replace the brand name and the wax color.",
    prompt: `Create a photorealistic wax seal that carries the logo of "[BRAND NAME]".

SEAL:
A hand-pressed sealing wax disc, about 30 mm across, with naturally irregular edges and a thin spill of wax around the rim. The logo is debossed into the center, crisp enough to be read but with the slight softening of real pressed wax. Wax color: [COLOR, e.g. deep oxblood]. A faint metallic sheen on the raised ridges.

SURFACE:
The seal sits on a folded sheet of heavy, uncoated cotton paper in warm ivory, closing a flap. The paper shows visible fiber texture and a soft crease.

LIGHTING AND CAMERA:
Overhead macro photograph, lit from the upper left by a window-like soft light that reveals the relief of the seal. Extremely shallow depth of field centered on the logo; the paper edges fall gently out of focus.

STRICT:
Reproduce the logo accurately; do not add ornaments, borders, or letters that are not part of the mark. No other objects in frame, no hands, no additional text.

OUTPUT:
One image, 1:1, high resolution, photorealistic.`,
  },
  {
    id: "swiss-poster",
    title: "Swiss typographic poster",
    group: "posters",
    description: "A grid-driven poster using only type and one geometric form. Fill in the title, subtitle, and date.",
    prompt: `Design a Swiss International Style typographic poster.

CONTENT:
Headline: "[HEADLINE, e.g. Objects in Motion]"
Subtitle: "[SUBTITLE, e.g. An exhibition of kinetic design]"
Details: "[DATE AND VENUE, e.g. 12 to 30 March, Hall 4]"
Use these three strings exactly and nothing else.

GRID AND TYPE:
Portrait poster on a strict 12-column modular grid. Set everything in a single grotesque sans-serif (Helvetica or Akzidenz-Grotesk character). The headline is very large, flush left, in bold, and may break across two lines. The subtitle and details are small, set in regular weight, aligned to the same column edge, and placed in the lower third. Letter-spacing is tight, leading is tight, alignment is exact.

GRAPHIC ELEMENT:
One large geometric form (a circle, a rotated square, or a set of parallel bars) placed asymmetrically so it overlaps the headline, with the type set in front of it. The form is the only non-typographic element.

COLOR:
Three flat colors in total: one background, one for the geometric form, one for the type. Pure, unmodulated inks with no gradients, no textures, no shadows.

STRICT:
No photographs, no illustration, no decorative ornaments, no additional text, no mock frame or wall. The poster fills the whole canvas edge to edge.

OUTPUT:
One image, 2:3 portrait, high resolution, perfectly sharp type.`,
  },
  {
    id: "sport-poster",
    title: "Modern sport poster",
    group: "posters",
    description: "A match-day style poster built from one athlete photo, bold type, and a brand's colors. Fill in the sport, the brand, and the headline.",
    prompt: `Design a modern sport poster for [SPORT, e.g. basketball] in the visual identity of "[BRAND NAME]".

SUBJECT:
One athlete in a decisive moment of play (a jump, a sprint, a strike), shot from a low angle so the figure feels monumental. The athlete wears plain kit in the brand's colors with no visible third-party logos. The figure is cut out and placed against a flat background, with a slight halftone treatment applied to the photo.

TYPOGRAPHY:
Headline "[HEADLINE, e.g. Every Second Counts]" set in a condensed, heavy sans-serif, uppercase, very large, placed partly behind the athlete so the figure overlaps the letters. A single line of small caps beneath it reads "[DATE OR TAGLINE]". Use exactly these two strings.

COMPOSITION:
Portrait format. The headline anchors the top, the athlete fills the center and bleeds off the bottom edge, and a thin horizontal rule with the brand's logo sits at the very bottom. Add two or three thin diagonal stripes in the accent color to suggest motion.

COLOR:
Only the brand's primary color, its accent color, black, and white. The photo is duotoned into the primary and black.

STRICT:
Spell "[BRAND NAME]" and reproduce its logo exactly. No additional text, no extra logos, no watermark.

OUTPUT:
One image, 2:3 portrait, high resolution.`,
  },
  {
    id: "mixed-media-collage",
    title: "Mixed-media collage illustration",
    group: "posters",
    description: "A torn-paper and photo collage around one subject. Fill in the subject and the mood.",
    prompt: `Create a mixed-media collage illustration about [SUBJECT, e.g. a city waking up at dawn], with a mood that is [MOOD, e.g. hopeful and slightly nostalgic].

TECHNIQUE:
Combine three layers: cut-out black-and-white photographic fragments with torn, feathered edges; flat shapes in colored paper with visible fiber texture and slight misalignment; and hand-drawn marks in soft graphite and a single marker color. Let the layers overlap so that photo fragments show through gaps in the paper shapes.

COMPOSITION:
One clear focal subject occupies the center third. Supporting fragments radiate outward and become sparser toward the edges, leaving breathing room in two corners. Include one small handwritten word in pencil that names the subject: "[ONE WORD]".

COLOR:
A limited palette of four colors: two muted paper tones, one saturated accent, and the grayscale of the photographs. The background is warm cream paper with faint fold creases.

STRICT:
No digital gradients, no glossy effects, no clean vector shapes. Every edge should look cut, torn, or drawn. No additional words beyond the single handwritten one.

OUTPUT:
One image, 4:5, high resolution, with the paper texture visible at full size.`,
  },
  {
    id: "icon-set",
    title: "Minimal flat icon set",
    group: "icons",
    description: "Twelve matching icons for a product or deck, in one style. Fill in the topic and the accent color.",
    prompt: `Design a set of twelve matching icons for [TOPIC, e.g. a personal finance app].

THE ICONS:
Choose twelve concepts that a product on this topic actually needs (for example: account, transfer, budget, savings goal, bill, alert, card, report, settings, help, security, calendar). Each icon depicts one concept with the fewest possible shapes and must be recognizable at 24 px.

STYLE:
Flat, filled shapes with no outlines. Rounded corners of a consistent radius, consistent stroke widths wherever a line appears, and consistent optical weight across the set. Each icon sits inside the same invisible 64 x 64 square with the same padding. Think of the restrained, friendly style of Notion or Linear icons.

COLOR:
Two colors only: a dark ink color for the main shapes and one accent color, [ACCENT COLOR], used once per icon for a single small highlight. White background.

LAYOUT:
Present the twelve icons as a 4 x 3 grid with equal gutters on a plain white canvas. Beneath each icon, a short lowercase label in a small sans-serif naming the concept.

STRICT:
No gradients, no shadows, no 3D, no textures, no decorative frames. Every icon must share the same visual language so the set reads as one family.

OUTPUT:
One image, 4:3, high resolution, crisp edges.`,
  },
  {
    id: "sticker-pack",
    title: "Branded sticker pack",
    group: "icons",
    description: "Eight die-cut stickers that extend a brand's identity into playful shapes. Replace the brand name only.",
    prompt: `Design a sticker pack of eight die-cut stickers for "[BRAND NAME]".

THE STICKERS:
Each sticker is a different shape and idea, but all share the brand's colors, its typeface character, and one recurring motif taken from its logo. Include: the logo on its own, a wordmark in a speech bubble, a short slogan of your choosing in bold display type, a mascot-like object related to the brand's industry, a badge with the founding year "[YEAR]", a repeating pattern tile, an arrow or hand gesture, and a loud all-caps word.

RENDERING:
Each sticker has a thick white die-cut border, a thin printed outline, and a glossy vinyl finish with a soft highlight. Slight peel on one corner of two stickers. Realistic drop shadows.

LAYOUT:
Scatter the eight stickers across a plain, lightly textured gray background with small gaps between them, none overlapping, all fully visible. The composition is balanced but not a strict grid.

COLOR:
The brand's primary and accent colors, black, and white. Nothing else apart from the white borders.

STRICT:
Spell "[BRAND NAME]" exactly. No third-party logos, no additional text beyond what each sticker needs.

OUTPUT:
One image, 1:1, high resolution.`,
  },
  {
    id: "minimal-mockup",
    title: "Hyper-minimal product mockup",
    group: "mockups",
    description: "One object, one logo, one color. Fill in the object and the brand name.",
    prompt: `Create a hyper-minimal product mockup: a [OBJECT, e.g. matte water bottle] carrying the logo of "[BRAND NAME]".

OBJECT:
The object is finished in a single flat matte color taken from the brand's palette. The logo appears once, small and centered, printed in the brand's contrasting color with no outline and no distortion over the surface curvature.

SCENE:
The object stands alone, perfectly centered, on a seamless background in a slightly lighter or darker tone of the same color so the scene is monochrome apart from the logo. No props, no surface line, no horizon.

LIGHTING AND CAMERA:
Soft, diffused light from above and slightly in front, creating a gentle gradient across the object and one soft contact shadow beneath it. Straight-on eye-level view with a medium focal length, no perspective distortion, everything in focus.

STRICT:
Reproduce the logo exactly. No text, no additional branding, no reflections of a studio, no hands or people. The image should feel calm and almost empty.

OUTPUT:
One image, 4:5, high resolution, photorealistic.`,
  },
  {
    id: "duffle-mockup",
    title: "Branded duffle bag mockup",
    group: "mockups",
    description: "A lifestyle product shot of a duffle bag in a brand's identity. Replace the brand name only.",
    prompt: `Create a product mockup of a premium duffle bag made for "[BRAND NAME]".

BAG:
A structured weekender duffle in heavy canvas with full-grain leather handles, leather end caps, and brass hardware. The canvas is dyed in the brand's primary color; the leather is natural tan. The logo is embroidered once on the side panel, about 8 cm wide, in the brand's accent color, with visible thread texture. A small woven label with the wordmark sits near the zipper.

SCENE:
The bag rests on a pale concrete floor beside a plain wooden bench, photographed in a bright, quiet studio with a soft daylight look. Three-quarter view from slightly above, bag fully in frame, with the embroidered logo facing the camera.

LIGHTING:
Large soft window light from the left, gentle shadows to the right, subtle highlights on the brass and the leather grain.

STRICT:
Spell "[BRAND NAME]" exactly and reproduce the logo faithfully. No other logos, no tags with text, no people, no additional products.

OUTPUT:
One image, 4:5, high resolution, photorealistic.`,
  },
  {
    id: "sport-jersey",
    title: "Premium sport jersey",
    group: "apparel",
    description: "A football or basketball jersey designed as if a brand sponsored the team. Fill in the brand and the sport.",
    prompt: `Design a premium [SPORT, e.g. football] jersey for a fictional team sponsored and designed by "[BRAND NAME]".

GARMENT:
A modern athletic jersey in lightweight knit fabric with a visible mesh texture. Base color is the brand's primary color. The brand's accent color appears as a precise graphic element (a chest band, a sleeve cuff, or a subtle all-over pattern derived from the logo's geometry). The logo is placed on the left chest; a large player number "[NUMBER]" sits centered on the back. The brand's wordmark appears as the sponsor across the chest.

PRESENTATION:
Show the jersey twice side by side on an invisible mannequin: front view on the left, back view on the right, both straight-on. Clean, flat studio background in a neutral tone. Even, soft lighting that reveals the fabric texture and seams.

DETAILS:
Heat-applied graphics with a slight raised edge, flatlock seams, a small woven tag at the hem, and natural fabric drape with subtle folds.

STRICT:
Spell "[BRAND NAME]" exactly. No league or federation badges, no third-party manufacturer logos, no additional text other than the number and the brand's wordmark.

OUTPUT:
One image, 3:2, high resolution, photorealistic.`,
  },
  {
    id: "calligraphic-monogram",
    title: "Calligraphic monogram",
    group: "typography",
    description: "Turns a brand's first letter into a bespoke ornamental glyph. Replace the brand name only.",
    prompt: `Design a bespoke calligraphic monogram for "[BRAND NAME]".

THE LETTER:
Draw only the first letter of "[BRAND NAME]" as a single custom glyph in the spirit of luxury engraved monograms: a high-contrast broad-nib structure with one or two elegant swashes, a confident terminal, and perfectly balanced counters. It must read instantly as that letter from across a room. Do not use an existing typeface.

SUPPORTING TEXT:
Beneath the glyph, centered, set "[BRAND NAME]" in a small, widely letter-spaced uppercase serif, at roughly one tenth the height of the monogram.

COMPOSITION:
Square canvas with the monogram centered and occupying about half the height, with generous margins.

COLOR AND FINISH:
Exactly two flat colors: one solid background chosen to suit the brand's character and one solid ink color for the glyph and the text. Perfectly smooth vector-style edges. No gradients, no texture, no shadow, no embossing, no gold foil effect.

STRICT:
Only the single letter and the brand name may appear. No frames, no ornaments outside the glyph's own swashes, no extra words.

OUTPUT:
One image, 1:1, high resolution.`,
  },
  {
    id: "embossed-lettering",
    title: "Embossed lettering on paper",
    group: "typography",
    description: "A word pressed into heavy paper, photographed at an angle. Fill in the word.",
    prompt: `Create a photorealistic blind emboss of the word "[WORD]" on heavy paper.

TYPOGRAPHY:
Set "[WORD]" in a bold, wide geometric sans-serif, uppercase, tightly tracked, as a single line. The letters are raised about 1 mm from the surface with softly rounded edges, exactly as a real emboss die would produce.

PAPER:
Thick uncoated cotton paper in natural white with a fine, visible felt texture and a slightly deckled edge visible along one side.

LIGHTING AND CAMERA:
Raking light from the upper left at a low angle so the relief of the letters is defined by highlights on their upper edges and soft shadows beneath them. Camera at about 30 degrees to the surface, close enough that the word fills most of the frame, with shallow depth of field so the far letters soften slightly.

STRICT:
No ink, no foil, no color on the letters; the word is readable only through light and shadow. Spell "[WORD]" exactly. Nothing else on the paper, no other objects in frame.

OUTPUT:
One image, 3:2, high resolution, photorealistic.`,
  },
];

/** The design catalog, in presentation order: grouped by {@link DESIGN_GROUPS} order, then by catalog order. */
export const DESIGN_EXAMPLES: readonly DesignExample[] = (Object.keys(DESIGN_GROUPS) as DesignGroup[]).flatMap((group) => EXAMPLES.filter((example) => example.group === group));

export function getDesignExample(id: string): DesignExample | undefined {
  return DESIGN_EXAMPLES.find((example) => example.id === id);
}
