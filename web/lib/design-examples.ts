/**
 * Complete, copyable design prompts written for image models such as Nano Banana Pro, Imagen, or GPT Image.
 *
 * Each prompt follows the same structure: a one-line brief, labelled sections for the main element, composition, materials or
 * finish, palette, and strict constraints, then an output specification. Placeholders in [SQUARE BRACKETS] are the only parts
 * meant to change between uses. The catalog mirrors the fifty entries, numbering, and eight groups of AmirMušić's public
 * "50 design prompts" catalog (https://x.com/AmirMushich/status/2019073081881293302), whose entries link to his own posts;
 * the prompt text here is original.
 */

export const DESIGN_GROUPS = {
  products: { label: "Branded products", description: "Product and packaging concepts carried by an existing brand's identity." },
  branding: { label: "Brand identity", description: "Logos, lettermarks, and whole brand kits from a single brief." },
  objects: { label: "3D objects", description: "Logos and marks rendered as physical materials with realistic lighting." },
  posters: { label: "Posters & illustration", description: "Editorial layouts, grids, and illustration styles for print or social." },
  icons: { label: "Icons & stickers", description: "Consistent asset sets for decks, documentation, and social content." },
  mockups: { label: "Mockups", description: "Real-world objects photographed with your logo or artwork applied." },
  apparel: { label: "Apparel & fashion", description: "Garments, footwear, and campaigns rendered with fabric-accurate texture and fit." },
  typography: { label: "Typography", description: "Custom lettering, monograms, and typographic systems." },
} as const;

export type DesignGroup = keyof typeof DESIGN_GROUPS;

export interface DesignExample {
  /** Position in the catalog, 1 to 50, matching the source catalog's numbering. */
  readonly number: number;
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
    number: 1,
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
    number: 2,
    id: "premium-beverage",
    title: "Premium beverage by any brand",
    group: "products",
    description: "A luxury drink can or bottle that a non-beverage brand might launch. Fill in the brand and the drink type.",
    prompt: `Design a premium [DRINK TYPE, e.g. sparkling water, cold brew, tonic] launched by "[BRAND NAME]", a brand that does not normally make beverages.

CONTAINER:
A slim 330 ml aluminum can or a tall glass bottle, whichever better suits the brand's character. The container is finished in the brand's primary color with a soft-touch matte coating. The logo is the only graphic on the front, sized generously and positioned exactly as the brand would place it. A single thin line of the accent color wraps the top edge.

LABEL TYPOGRAPHY:
Product name "[DRINK TYPE]" set in the brand's typeface character, small, beneath the logo. No ingredient text, no barcode, no legal copy.

SCENE:
Studio photograph on a seamless background in a deeper tone of the brand's color. Container standing upright, slightly turned, with fine condensation droplets and one crisp vertical highlight from a softbox on the left. A second container lies on its side behind it, out of focus.

STRICT:
Spell "[BRAND NAME]" exactly. No fruit, no splashes, no ice cubes, no hands, no additional text.

OUTPUT:
One image, 4:5, high resolution, photorealistic.`,
  },
  {
    number: 3,
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
    number: 4,
    id: "souvenir-concepts",
    title: "Creative branded souvenir concepts",
    group: "products",
    description: "Four surprising souvenirs that extend a brand's identity into objects it would never sell. Replace the brand name.",
    prompt: `Invent four creative souvenir objects for "[BRAND NAME]" that reinterpret its identity in unexpected materials.

THE FOUR OBJECTS:
Choose four objects that play on the brand's industry or logo shape in a witty way (for example, a logo-shaped ice tray, a desk lamp whose shade is the logomark, a chess piece in the brand's colors, a tape dispenser shaped like its product). Each object must be instantly understandable and physically plausible.

PRESENTATION:
Four square panels arranged 2 x 2 with thin gutters on a plain off-white background. Each object is photographed alone on a matching off-white surface with soft, even studio light and a faint contact shadow. The same camera angle, three-quarter view from slightly above, in all four panels.

BRANDING:
The brand's primary color dominates each object, the accent color appears once per object, and the logo appears once per object at a realistic size. The colors must match the brand's real palette.

STRICT:
Spell "[BRAND NAME]" exactly. No captions, no price tags, no hands or people, no backgrounds other than the plain surface.

OUTPUT:
One image, 1:1, high resolution, photorealistic.`,
  },
  {
    number: 5,
    id: "product-designer",
    title: "Creative product designer brief",
    group: "products",
    description: "Puts the model in a product designer's seat and asks for a concept sheet with three views. Fill in the product and the design direction.",
    prompt: `Act as a senior industrial designer presenting a concept for a [PRODUCT, e.g. desk lamp, portable speaker, kettle] in the design direction "[DIRECTION, e.g. soft brutalism, 1970s Braun, organic minimalism]".

CONCEPT SHEET:
One landscape sheet on white paper texture, laid out like a design studio presentation. On the left two thirds, a large hero render of the product in three-quarter view. On the right third, stacked vertically: a front elevation, a side elevation, and a close-up detail of the main control or joint.

DESIGN:
Form follows the stated direction consistently across all views. Choose one primary material and one secondary material, and keep them identical in every view. Show honest manufacturing details: parting lines, fasteners, venting, cable exits.

ANNOTATIONS:
Add four short hand-lettered callouts in pencil pointing at specific features, each no more than four words. Add the product name "[PRODUCT NAME]" in a small sans-serif at the bottom left.

STRICT:
No people, no scene props, no brand logos. Every view must depict the same object with the same proportions.

OUTPUT:
One image, 16:9, high resolution, clean studio rendering.`,
  },
  {
    number: 6,
    id: "dieline-to-3d",
    title: "Dieline to 3D package",
    group: "products",
    description: "Takes a flat packaging dieline as the input image and returns the assembled box photographed. Attach the dieline.",
    prompt: `Using the attached flat dieline as the exact artwork, assemble it into a finished 3D package and photograph it.

ASSEMBLY:
Fold the dieline into a [BOX TYPE, e.g. tuck-end carton, mailer box, sleeve] with correct panel placement: the front panel faces the camera, side panels wrap correctly, the top flap closes cleanly. Keep every graphic, color, and piece of text from the dieline exactly where the folds place it, with no re-layout and no invented graphics.

MATERIAL:
Printed on [STOCK, e.g. uncoated kraft board, matte white folding carton, glossy coated board] with visible edge thickness, slight creasing at the folds, and accurate print finish.

SCENE:
Studio photograph on a neutral gray seamless background. Three-quarter view showing the front and one side, camera slightly above the box. Soft key light from the upper left and a gentle contact shadow.

STRICT:
Do not alter, add, or remove any artwork from the dieline. No additional objects, no hands, no text beyond what the dieline contains.

OUTPUT:
One image, 4:5, high resolution, photorealistic.`,
  },
  {
    number: 7,
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
    number: 8,
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
    number: 9,
    id: "glass-logo",
    title: "Glass logo",
    group: "branding",
    description: "A brand mark rendered as a thick, refractive glass object. Replace the brand name and the backdrop color.",
    prompt: `Render the logo of "[BRAND NAME]" as a single solid piece of clear glass.

OBJECT:
The logo is extruded about 25 mm thick with softly rounded edges, like a cast glass sculpture. The glass is flawless and highly refractive, bending the background through its body, with subtle internal caustics and thin bright highlights along every edge.

BACKDROP:
A smooth, out-of-focus gradient in [BACKDROP COLOR, e.g. soft lavender] so the refraction inside the glass is clearly visible. The object stands on a matching glossy surface that holds a faint reflection.

LIGHTING AND CAMERA:
Two large soft lights, one from the upper left and one from behind, so the edges glow while the faces stay transparent. Three-quarter view at eye level, medium focal length, the whole logo in focus.

STRICT:
Reproduce the logo's geometry exactly; do not simplify, restyle, or add elements. No text other than what the logo contains, no color tint in the glass, no additional objects.

OUTPUT:
One image, 1:1, high resolution, photorealistic.`,
  },
  {
    number: 10,
    id: "crowd-logo",
    title: "Logo formed by a crowd",
    group: "branding",
    description: "An aerial photograph of people arranged into a brand's logo. Replace the brand name and the location.",
    prompt: `Create an aerial photograph of a large crowd of people arranged to form the logo of "[BRAND NAME]".

FORMATION:
Hundreds of people, seen directly from above, stand shoulder to shoulder in the exact shape of the logo. Everyone inside the shape wears clothing in the brand's primary color; everyone outside it, filling the surrounding area, wears neutral gray and white. The logo reads clearly and accurately from the camera's height.

LOCATION:
[LOCATION, e.g. a city square, a stadium pitch, a beach at low tide], photographed on a bright overcast day with soft, shadowless light.

CAMERA:
Straight-down drone view, the logo centered and filling about 60% of the frame, slight lens falloff toward the corners. Individual people are visible as small figures with heads and shoulders.

STRICT:
Reproduce the logo's silhouette exactly, including counters and gaps formed by empty ground. No text, no overlays, no vehicles, no structures inside the logo area.

OUTPUT:
One image, 1:1, high resolution, photorealistic.`,
  },
  {
    number: 11,
    id: "product-branding-workflow",
    title: "Product branding board",
    group: "branding",
    description: "A one-page board that applies a brand to a specific product line in four stages. Fill in the brand and the product.",
    prompt: `Create a product branding board that takes "[BRAND NAME]" through four stages of branding a new [PRODUCT LINE, e.g. skincare range, coffee range, tool set].

BOARD LAYOUT:
One landscape board on a pale neutral background divided into four equal columns, each with a small numbered caption at the top.

THE FOUR STAGES:
1. Identity: the logo and a three-color palette with hex codes, plus one secondary mark derived from the logo for use on the product.
2. Packaging: the primary package for the line, front view, carrying the logo, the secondary mark, and the product name "[PRODUCT NAME]".
3. Range: three variants of the package side by side, differing only in one accent color and a variant name each.
4. In context: the product photographed in a realistic setting where it would be used or sold, with soft natural light.

CONSISTENCY:
The same logo, colors, type character, and material finish must appear in every column so the board reads as one system.

STRICT:
Spell "[BRAND NAME]" and "[PRODUCT NAME]" exactly. No lorem ipsum, no people, no third-party logos.

OUTPUT:
One image, 16:9, high resolution, clean presentation rendering.`,
  },
  {
    number: 12,
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
    number: 13,
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
    number: 14,
    id: "logo-retexture",
    title: "Logo retexturing",
    group: "objects",
    description: "Rebuilds a logo in a named material while keeping its geometry. Fill in the brand and the material.",
    prompt: `Rebuild the logo of "[BRAND NAME]" entirely out of [MATERIAL, e.g. polished walnut, terrazzo, brushed copper, woven rope, moss].

OBJECT:
The logo keeps its exact proportions and silhouette, extruded to a thickness that suits the material, with edges finished the way a craftsman would finish that material. The material must be believable up close: grain, pores, seams, fibers, or crystals visible at full resolution.

SCENE:
The object rests on a surface that complements the material (stone, linen, concrete, or raw plywood), photographed in a bright studio with a large soft window light from the left and a gentle shadow to the right.

CAMERA:
Three-quarter view from slightly above, medium focal length, the whole logo in focus, close enough that the material's texture fills the frame.

STRICT:
Do not restyle, simplify, or decorate the logo. No text other than what the logo contains, no other objects, no hands.

OUTPUT:
One image, 1:1, high resolution, photorealistic.`,
  },
  {
    number: 15,
    id: "branded-grillz",
    title: "Branded grillz",
    group: "objects",
    description: "A jewelry macro of gold teeth grills carrying a brand's logo. Replace the brand name and the metal.",
    prompt: `Create a jewelry product photograph of a set of custom grillz (removable teeth jewelry) designed for "[BRAND NAME]".

THE PIECE:
A six-tooth top grill cast in [METAL, e.g. 18k yellow gold, white gold, rose gold] with a high polish. The brand's logo is cut into the two central teeth as an inlay in the brand's primary color enamel, with the surrounding teeth set with small pavé stones in the accent color. Every tooth has the realistic contour of a dental impression.

PRESENTATION:
The grill sits on a black velvet jewelry tray, photographed as a macro shot from a slightly raised front angle. Hard, small key light from the upper right to produce sharp sparkle on the stones and crisp reflections on the metal, with a soft fill from the left.

STRICT:
Reproduce the logo accurately at this tiny scale. No mouth, no face, no hands, no text, no other jewelry.

OUTPUT:
One image, 4:5, high resolution, photorealistic macro.`,
  },
  {
    number: 16,
    id: "sticker-bombed-logo",
    title: "Sticker-bombed 3D logo",
    group: "objects",
    description: "A chunky 3D logo covered in overlapping stickers from the brand's own world. Replace the brand name.",
    prompt: `Render the logo of "[BRAND NAME]" as a chunky 3D object completely covered in overlapping stickers.

OBJECT:
The logo is extruded thick, with rounded edges, like a toy or a skateboard deck. Every visible surface is sticker-bombed: dozens of glossy vinyl stickers layered over each other, each one a small design in the brand's colors (its wordmark, its logomark, slogans of your choosing, stars, arrows, simple badges). A few stickers peel at the corners and show the slightly scuffed base color of the object beneath.

SCENE:
The object stands on a plain concrete floor against a flat matte wall in a lighter tint of the brand's primary color. Three-quarter view at eye level with a wide soft key light and a visible contact shadow.

STRICT:
The overall logo silhouette must remain instantly readable despite the stickers. All stickers must use only the brand's palette, black, and white. No third-party logos, no additional objects, no hands.

OUTPUT:
One image, 1:1, high resolution, photorealistic.`,
  },
  {
    number: 17,
    id: "photo-grid-tribute",
    title: "Photo grid tribute poster",
    group: "posters",
    description: "A tribute poster built from a grid of portraits with one headline. Fill in the subject and the headline; attach photos if you have them.",
    prompt: `Design a tribute poster for [SUBJECT, e.g. a retiring coach, a band's final tour, a company's founding team] built from a photo grid.

GRID:
Portrait poster with a 4 x 5 grid of twenty square photographs, equal gutters, edge to edge inside a slim margin. If photos are attached, use only those, repeating none; otherwise generate candid black-and-white portraits that fit the subject. Convert every image to the same high-contrast black-and-white treatment with a fine film grain.

OVERLAY:
Across the middle two rows, a solid band in [ACCENT COLOR] carries the headline "[HEADLINE]" set in a bold condensed sans-serif, uppercase, white, filling the band's width. Beneath the grid, a single small line reads "[SUBLINE, e.g. 1998 to 2026]".

STRICT:
Use exactly these two text strings and nothing else. No logos, no borders around individual photos, no color in the photographs.

OUTPUT:
One image, 2:3 portrait, high resolution, print-ready.`,
  },
  {
    number: 18,
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
    number: 19,
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
    number: 20,
    id: "animated-band-characters",
    title: "Early-2000s animated band characters",
    group: "posters",
    description: "Four stylized band members in the flat, gritty look of early-2000s animated music videos. Fill in the band concept.",
    prompt: `Illustrate a four-member virtual band for [BAND CONCEPT, e.g. a late-night synth trio plus a drummer from a seaside town] in the style of early-2000s animated music videos.

STYLE:
Flat cel-shaded characters with heavy black outlines of varying weight, slightly grotesque proportions (large heads, thin limbs, exaggerated hands), deadpan expressions, and a worn, printed look with subtle misregistration of the colors. Clothing is streetwear and vintage pieces with visible wear.

CHARACTERS:
Four distinct silhouettes, each with one memorable feature (a hairstyle, an eyepatch, a hat, a bandaged hand). They stand in a loose line, not posed symmetrically, as if waiting for a bus.

BACKGROUND AND COLOR:
A flat, dusty backdrop with one simple environmental hint (a lamppost, a wall, a van). A muted palette of five colors with one sour accent such as acid green or hot pink.

STRICT:
Original characters only; do not reproduce any existing band's members or artwork. No text, no logos, no gradients.

OUTPUT:
One image, 3:2, high resolution, flat illustration.`,
  },
  {
    number: 21,
    id: "character-sketch",
    title: "Professional character sketch sheet",
    group: "posters",
    description: "A concept-art sheet with turnaround, expressions, and a pose study for one character. Fill in the character brief.",
    prompt: `Create a professional character design sheet for [CHARACTER BRIEF, e.g. a weary lighthouse keeper in her sixties who repairs radios].

SHEET LAYOUT:
Landscape sheet on warm white paper. Left half: a three-view turnaround (front, three-quarter, side) of the full figure at the same scale, aligned on a common baseline with faint horizontal guide lines. Top right: a row of four head studies showing distinct expressions. Bottom right: one dynamic pose study and two small prop sketches that belong to the character.

TECHNIQUE:
Clean pencil line work with confident, varied line weight, light construction lines left visible, and a single flat wash of one muted color to indicate the main garment. Small handwritten notes in pencil call out two or three design details.

STRICT:
Every view must depict the same character with consistent proportions, hairstyle, and costume. No background scenes, no color beyond the single wash, no typed text.

OUTPUT:
One image, 16:9, high resolution, scanned-sketch look.`,
  },
  {
    number: 22,
    id: "photo-collage-caricature",
    title: "Urban photo-collage caricature",
    group: "posters",
    description: "A caricature built from a cut-out photographic head on a hand-drawn body in a city scene. Attach a reference photo or describe the person.",
    prompt: `Create an urban photo-collage caricature of [PERSON, e.g. the attached reference photo, or: a cheerful bike courier with a big grin].

TECHNIQUE:
The head is a cut-out photograph, slightly oversized, with a visible white cut edge and a thin drop shadow. The body is hand-drawn in loose black marker with exaggerated, simplified proportions and flat fills in two bold colors. The scene behind is a photograph of a city street, posterized into three tones and pushed to the background.

COMPOSITION:
Full figure, standing or mid-action, centered, with the head tilted for attitude. One hand-drawn speech bubble contains the word "[ONE WORD]" in handwritten capitals.

COLOR:
The street photo in grayscale, the body in [COLOR ONE] and [COLOR TWO], the bubble in white. Nothing else.

STRICT:
Keep the person recognizable and the caricature affectionate rather than mocking. No additional text, no logos.

OUTPUT:
One image, 4:5, high resolution.`,
  },
  {
    number: 23,
    id: "grid-poster",
    title: "Modular grid poster",
    group: "posters",
    description: "A poster where every element sits inside a visible modular grid. Fill in the title, the subject, and the date.",
    prompt: `Design a poster for [SUBJECT, e.g. a type design conference] on a visible modular grid.

GRID:
Portrait poster divided into a 6 x 9 grid of equal cells by hairline rules in a dark ink. Every element of the poster occupies whole cells: no element may cross a cell boundary unless it fills a rectangle of whole cells.

CONTENT:
The title "[TITLE]" in a heavy grotesque sans-serif fills a 6 x 2 block near the top. A single abstract image (a photograph of a texture, a shape, or a macro detail related to the subject) fills a 4 x 4 block offset to one side. Smaller cells carry "[DATE]", "[VENUE]", and a two-line description "[DESCRIPTION]" in a small regular weight. Several cells are left deliberately empty and filled with one flat color.

COLOR:
Three colors total: paper, ink, and one accent used for the filled cells and nothing else.

STRICT:
Use exactly the four text strings above. No gradients, no shadows, no decorative elements beyond the grid lines.

OUTPUT:
One image, 2:3 portrait, high resolution, sharp type.`,
  },
  {
    number: 24,
    id: "movie-poster",
    title: "Movie poster from reference images",
    group: "posters",
    description: "Composes a one-sheet from up to eight attached reference images and a title. Attach the images and fill in the title and tagline.",
    prompt: `Using the attached reference images (up to eight: the lead actors, a location, a key prop, and style references), design a theatrical one-sheet poster for a film titled "[TITLE]".

COMPOSITION:
Portrait one-sheet. The two lead characters from the attached photos are the dominant elements, composed in a classic layered arrangement: one large face in the upper half, a full-figure or action moment in the lower half, and the attached location filling the background with atmospheric depth. Keep every attached face accurate.

TYPOGRAPHY:
The title "[TITLE]" in a custom display treatment across the lower third, large and dimensional. Above it, the tagline "[TAGLINE]" in small, widely tracked capitals. At the very bottom, a realistic billing block in the standard condensed style, using the placeholder names provided or plausible invented ones.

COLOR AND MOOD:
A [GENRE, e.g. neo-noir thriller] palette: one dominant color, one accent, deep shadows, cinematic grading.

STRICT:
Use only the attached people; do not add other recognizable faces. Use exactly the title and tagline given. No studio logos, no rating badges, no review quotes.

OUTPUT:
One image, 27:40 portrait (theatrical one-sheet), high resolution.`,
  },
  {
    number: 25,
    id: "gift-tree",
    title: "Christmas tree of branded gifts",
    group: "posters",
    description: "A holiday key visual where a tree is built entirely from a brand's wrapped gifts. Replace the brand name.",
    prompt: `Create a holiday key visual in which a Christmas tree is built entirely from stacked, wrapped gift boxes branded for "[BRAND NAME]".

THE TREE:
Dozens of boxes in five sizes, stacked in tiers from large at the bottom to small at the top to form a clear tree silhouette. All wrapping uses only the brand's primary color, accent color, and white, in three repeating patterns: solid, a fine logo pattern, and thin stripes. Ribbons in the accent color, the logo printed on a gift tag on at least a third of the boxes. A single box at the top is the "star": the logomark rendered as a metallic ornament.

SCENE:
A quiet, warm interior with a wooden floor and a plain wall in a soft neutral tone. Window light from the left, a few small warm fairy lights woven between the boxes, a soft shadow on the floor.

STRICT:
Spell "[BRAND NAME]" exactly. No people, no pets, no other decorations, no text beyond the logo on the tags.

OUTPUT:
One image, 4:5, high resolution, photorealistic.`,
  },
  {
    number: 26,
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
    number: 27,
    id: "halftone-icons",
    title: "Halftoned minimal icon set",
    group: "icons",
    description: "Twelve icons in the minimal style but rendered with a vintage halftone shading. Fill in the topic.",
    prompt: `Design a set of twelve matching icons for [TOPIC, e.g. a travel planning app] in a minimal style with halftone shading.

THE ICONS:
Choose twelve concepts the product needs (for example: flight, hotel, map, passport, luggage, weather, currency, calendar, ticket, camera, route, alert). Each icon is a simple, chunky silhouette recognizable at 24 px.

STYLE:
Flat black shapes with rounded corners, a consistent optical weight across the set, and a single light source implied by a halftone dot gradient on one side of each shape. The halftone uses visible, evenly spaced dots that shrink toward the lit side, as in vintage print. Add a thin offset outline in [ACCENT COLOR] that is slightly misregistered, like a two-color letterpress print.

LAYOUT:
A 4 x 3 grid with equal gutters on a cream paper background with a faint paper texture. Beneath each icon, a lowercase label in a small monospaced font.

STRICT:
No gradients other than the halftone dots, no shadows, no 3D. Every icon must share the same dot size, light direction, and outline offset.

OUTPUT:
One image, 4:3, high resolution, crisp dots.`,
  },
  {
    number: 28,
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
    number: 29,
    id: "character-icons",
    title: "Minimalist character icons",
    group: "icons",
    description: "Nine tiny characters drawn from basic shapes, consistent enough to use as avatars. Fill in the cast.",
    prompt: `Design nine minimalist character icons for [CAST, e.g. the roles on a product team: designer, engineer, researcher, writer, manager, tester, analyst, support, intern].

CHARACTERS:
Each character is built from a circle head and a rounded-rectangle body with no neck, no hands, and no feet. Faces are two dots and one simple mouth line. Each character is distinguished by exactly one prop or clothing detail (glasses, a beanie, a headset, a notebook, a scarf), nothing more.

STYLE:
Flat fills, no outlines, consistent rounded geometry, and the same head-to-body ratio for all nine. Skin and hair tones vary across the cast in a friendly, inclusive mix. Props use a shared accent color, [ACCENT COLOR].

LAYOUT:
A 3 x 3 grid with equal gutters on a plain white background, each character inside an identical circular badge in a very light gray. Beneath each badge, a short lowercase label.

STRICT:
No gradients, no shadows, no textures, no backgrounds inside the badges beyond the flat gray. Every character must be readable at 32 px.

OUTPUT:
One image, 1:1, high resolution, crisp edges.`,
  },
  {
    number: 30,
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
    number: 31,
    id: "fast-food-leather-bag",
    title: "Fast food bag in leather",
    group: "mockups",
    description: "Remakes a brand's paper takeaway bag as a luxury leather object. Replace the brand name.",
    prompt: `Create a luxury product photograph of the familiar paper takeaway bag of "[BRAND NAME]" remade as a premium leather handbag.

THE BAG:
The silhouette, proportions, folds, and crimped top edge of the paper bag are kept exactly, but every surface is now full-grain pebbled leather in the bag's original paper color. The brand's logo is debossed into the front, the same size and position as on the paper original. Edges are hand-painted, stitching is tonal, and a slim leather carry handle replaces the paper handle.

SCENE:
Shot in a high-end fashion studio on a seamless background in a warm neutral tone. The bag stands upright, slightly turned, in soft directional light that shows the leather grain and the deboss relief. A faint reflection on a glossy floor.

STRICT:
Spell "[BRAND NAME]" and reproduce its logo and colors accurately. No food, no hands, no additional text, no other objects.

OUTPUT:
One image, 4:5, high resolution, photorealistic.`,
  },
  {
    number: 32,
    id: "crumpled-stickers",
    title: "Branded crumpled stickers",
    group: "mockups",
    description: "A brand's logo as a worn vinyl sticker on a real surface. Replace the brand name and the surface.",
    prompt: `Create a close-up photograph of a branded vinyl sticker for "[BRAND NAME]" that has been applied by hand and slightly crumpled.

THE STICKER:
A die-cut sticker of the brand's logo in its true colors, about 10 cm wide, printed on glossy white vinyl. It has been pressed onto the surface imperfectly: two or three soft creases run across it, one corner lifts slightly, and a small air bubble sits near the center. The print is clean but the vinyl shows fingerprints and a faint scuff.

SURFACE:
[SURFACE, e.g. a brushed steel lamppost, a skateboard deck, a laptop lid, a subway tile wall], photographed close so its material texture is clearly visible around the sticker.

LIGHTING AND CAMERA:
Natural daylight from one side, revealing the creases through highlights and tiny shadows. Macro lens, straight-on, the sticker sharp and the edges of the frame softly out of focus.

STRICT:
Reproduce the logo exactly; do not restyle it. No additional stickers, no text, no hands.

OUTPUT:
One image, 1:1, high resolution, photorealistic.`,
  },
  {
    number: 33,
    id: "beverage-packaging",
    title: "Premium beverage package design",
    group: "mockups",
    description: "A full packaging system for a drink: bottle, label, and carrier. Fill in the drink and the brand.",
    prompt: `Design a complete premium packaging system for [DRINK, e.g. a small-batch tonic water] from "[BRAND NAME]".

THE SYSTEM:
Show three items together: a 500 ml glass bottle with a printed label, a four-pack carrier in heavy folding board, and a single flat label shown unrolled beside them.

LABEL DESIGN:
A restrained label with the wordmark "[BRAND NAME]" as the dominant element, the product name "[DRINK]" beneath it in a smaller serif, and a single thin illustrated motif related to the ingredient. Paper stock with a tactile texture, one spot color in [PRIMARY COLOR], one foil detail in copper. No other text.

CARRIER:
The same motif enlarged as a pattern across the carrier, the wordmark on the front panel, a die-cut handle.

SCENE:
Studio photograph on a mid-gray seamless background with soft light from the upper left and a gentle contact shadow. The three items arranged in a shallow arc so each is fully visible.

STRICT:
Spell "[BRAND NAME]" and "[DRINK]" exactly. No ingredient text, no barcode, no legal copy, no props, no hands.

OUTPUT:
One image, 3:2, high resolution, photorealistic.`,
  },
  {
    number: 34,
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
    number: 35,
    id: "sneaker-collab",
    title: "Cross-brand sneaker collaboration",
    group: "mockups",
    description: "A sneaker that merges a footwear brand's silhouette with another brand's identity. Fill in both brands.",
    prompt: `Design a collaboration sneaker between the footwear brand "[FOOTWEAR BRAND]" and "[PARTNER BRAND]".

THE SHOE:
Use a classic silhouette from the footwear brand and recolor and re-material it in the partner brand's identity: the partner's primary color on the main panels, its accent color on the sole or laces, and one material swap that references the partner's industry (for example, a woven label, a rubber texture, or a metal eyelet finish). Place the partner's logo once on the heel tab or tongue and keep the footwear brand's own branding where it normally sits.

PRESENTATION:
A single shoe photographed in profile, lateral side, floating slightly above a seamless background in a tint of the partner's primary color. A second view of the sole, small, in the lower corner. Crisp studio light with a soft shadow beneath.

STRICT:
Reproduce both logos accurately and keep the silhouette faithful. No feet, no people, no extra text, no box.

OUTPUT:
One image, 4:5, high resolution, photorealistic.`,
  },
  {
    number: 36,
    id: "passport-cover",
    title: "Branded passport cover",
    group: "mockups",
    description: "A leather passport cover with a brand's mark, shown closed and open. Replace the brand name and the leather color.",
    prompt: `Create a product photograph of a leather passport cover designed by "[BRAND NAME]".

THE COVER:
Smooth full-grain leather in [LEATHER COLOR, e.g. deep forest green] with painted edges and tonal stitching. On the front, the brand's logomark is blind-embossed, centered, about 3 cm wide. Inside, the brand's wordmark is hot-foiled in a matching metallic on the left pocket, and the right pocket holds a plain passport.

PRESENTATION:
Two covers on a dark slate surface: one closed, lying flat and slightly angled, and one open behind it showing the interior. Soft overhead light with a gentle fall-off to the edges, a shallow depth of field centered on the embossed logo.

STRICT:
Spell "[BRAND NAME]" exactly and reproduce the logo faithfully. No country names or emblems on the passport, no other objects, no hands.

OUTPUT:
One image, 4:5, high resolution, photorealistic.`,
  },
  {
    number: 37,
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
    number: 38,
    id: "photo-campaign",
    title: "Photo campaign for any brand",
    group: "apparel",
    description: "A three-image fashion campaign in a brand's identity. Fill in the brand and the campaign idea.",
    prompt: `Create a three-image fashion photography campaign for "[BRAND NAME]" with the idea "[CAMPAIGN IDEA, e.g. the first warm day of spring]".

THE THREE IMAGES:
Presented side by side as a triptych with thin white gutters. Image one: a full-body shot of a model in motion. Image two: a tight portrait with a strong expression. Image three: a still-life detail of one garment or accessory. All three share the same location, light, and color grading.

STYLING:
Garments in the brand's primary and accent colors with the logo visible once per image at a realistic size, as a label, a print, or a hardware detail. Minimal styling, no competing brands.

PHOTOGRAPHY:
Natural light at golden hour or a single large softbox, a consistent film-like grade with soft contrast, 50 mm and 85 mm lenses, a slightly desaturated palette that lets the brand colors stand out.

STRICT:
Spell "[BRAND NAME]" exactly. No text overlays, no third-party logos, models diverse and natural.

OUTPUT:
One image, 3:1 triptych, high resolution, photorealistic.`,
  },
  {
    number: 39,
    id: "hypebeast-showroom",
    title: "Hypebeast showroom",
    group: "apparel",
    description: "A streetwear showroom dressed entirely in one brand's identity. Replace the brand name.",
    prompt: `Create an interior photograph of a streetwear showroom designed for "[BRAND NAME]".

SPACE:
A compact concrete gallery with a polished floor, one wall painted in the brand's primary color, and a long steel clothing rail holding twelve garments (hoodies, jackets, tees) in the brand's palette. A low plinth displays three pairs of sneakers and a stack of caps. The logo is applied large on the painted wall as a single matte vinyl graphic, and small on a swing tag visible on the nearest garment.

LIGHT AND CAMERA:
Cool daylight through a high window mixed with warm track lighting on the rail. Wide-angle view from the entrance, slightly low, with the painted wall as the focal point.

STRICT:
Spell "[BRAND NAME]" exactly; the garments carry only its branding. No people, no third-party logos, no additional text.

OUTPUT:
One image, 3:2, high resolution, photorealistic.`,
  },
  {
    number: 40,
    id: "winter-outerwear",
    title: "Cross-branded winter outerwear",
    group: "apparel",
    description: "A technical winter jacket that merges an outdoor brand with any other brand. Fill in both brands.",
    prompt: `Design a technical winter jacket as a collaboration between the outdoor brand "[OUTDOOR BRAND]" and "[PARTNER BRAND]".

THE JACKET:
A down-filled parka with a hood, baffled quilting, storm flap, and taped seams, built on the outdoor brand's construction. Color-blocked in the partner brand's primary and accent colors, with the partner's logo embroidered on the chest and the outdoor brand's logo on the sleeve, both at realistic sizes. One detail references the partner's industry: a woven label, a custom zipper pull, or an interior print.

PRESENTATION:
Front and back views on an invisible mannequin, side by side, against a plain light gray background with even studio light. Fabric sheen, down loft, and stitching rendered accurately. A small flat-lay detail of the zipper pull in the lower corner.

STRICT:
Reproduce both logos accurately. No people, no additional text, no scenery.

OUTPUT:
One image, 3:2, high resolution, photorealistic.`,
  },
  {
    number: 41,
    id: "clog-collab",
    title: "Foam clog collaboration",
    group: "apparel",
    description: "A molded foam clog reimagined in another brand's identity, with matching charms. Fill in both brands.",
    prompt: `Design a collaboration between the foam clog brand "[FOOTWEAR BRAND]" and "[PARTNER BRAND]".

THE CLOG:
The classic molded foam clog silhouette with its ventilation holes and pivoting heel strap, remade in the partner brand's primary color with the strap in its accent color. The partner's logo is molded into the heel strap rivet and printed small on the footbed. Five custom shoe charms designed from the partner brand's world (its logomark, a product icon, a slogan badge, a mascot-like object, a pattern tile) sit in the ventilation holes.

PRESENTATION:
One clog in three-quarter view and one in top view, side by side on a seamless background in a pale tint of the partner's primary color. Soft, even studio lighting showing the matte foam texture and the glossy charms.

STRICT:
Reproduce both logos accurately and keep the clog silhouette faithful. No feet, no text, no other objects.

OUTPUT:
One image, 3:2, high resolution, photorealistic.`,
  },
  {
    number: 42,
    id: "style-factory",
    title: "Style factory sheet",
    group: "apparel",
    description: "One outfit rendered in six distinct fashion styles on a single sheet. Fill in the base outfit.",
    prompt: `Take one base outfit, [BASE OUTFIT, e.g. a white shirt, black trousers, and leather boots], and render it in six distinct fashion styles on one sheet.

THE SIX STYLES:
1. Minimal tailoring, 2. Workwear, 3. Techwear, 4. 1970s vintage, 5. Avant-garde volume, 6. Luxury resort. Each version keeps the same three garment types but changes cut, fabric, proportion, and styling to express that style clearly.

PRESENTATION:
Six full-body studio shots of the same model in a 3 x 2 grid with thin white gutters, same neutral backdrop, same pose, same soft lighting, so only the styling changes. Beneath each panel, a short lowercase label naming the style.

STRICT:
No logos, no text other than the six labels, no changes to the model's appearance between panels.

OUTPUT:
One image, 3:2, high resolution, photorealistic.`,
  },
  {
    number: 43,
    id: "boxing-gloves",
    title: "Branded boxing gloves",
    group: "apparel",
    description: "A pair of leather boxing gloves in a brand's identity. Replace the brand name.",
    prompt: `Create a product photograph of a pair of professional boxing gloves designed for "[BRAND NAME]".

THE GLOVES:
16 oz lace-up gloves in full-grain leather, the body in the brand's primary color and the thumb and cuff in its accent color. The logo is embroidered large on the back of each hand and the wordmark is printed small along the cuff. Visible details: fine stitching, padded knuckle contour, waxed laces, a leather pull tab, and slight creasing where the glove flexes.

SCENE:
Both gloves on a dark gym floor, one upright and one lying on its side, with a rolled hand wrap in the accent color nearby. Hard side light from a high window, dust in the beam, a dark background that falls off to black.

STRICT:
Spell "[BRAND NAME]" exactly and reproduce the logo faithfully. No people, no ring, no additional text.

OUTPUT:
One image, 4:5, high resolution, photorealistic.`,
  },
  {
    number: 44,
    id: "brands-as-clubs",
    title: "Brands as sport clubs",
    group: "apparel",
    description: "Reimagines a brand as a football club with crest, kit, and scarf. Replace the brand name and the sport.",
    prompt: `Reimagine "[BRAND NAME]" as a [SPORT, e.g. football] club and design its identity.

THE CREST:
A club crest that converts the brand's logomark into a heraldic badge: a shield or roundel, the logomark as the central charge, the brand name as the club name, and a founding year "[YEAR]" beneath. Two colors only, taken from the brand's palette, plus a metallic outline.

THE KIT:
Home shirt and shorts in the brand's primary color with the accent color as a collar and cuff detail, the crest on the left chest, a number on the back.

THE SCARF:
A knitted supporter scarf in the club colors with the club name and the logomark repeated.

PRESENTATION:
One landscape board on a neutral background: crest large on the left, kit front and back on an invisible mannequin in the center, scarf laid flat on the right.

STRICT:
Spell "[BRAND NAME]" exactly. No real club or league emblems, no sponsor logos, no additional text.

OUTPUT:
One image, 16:9, high resolution, photorealistic.`,
  },
  {
    number: 45,
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
    number: 46,
    id: "retro-lettering",
    title: "American retro lettering",
    group: "typography",
    description: "A word in mid-century American sign-painter lettering with a drop shadow and inline. Fill in the word.",
    prompt: `Hand-letter the word "[WORD]" in mid-century American sign-painter style.

LETTERING:
Bold, slightly condensed uppercase letters with soft bracketed serifs, drawn on a gentle upward arc. A thin inline highlight runs through each letter, and a solid drop shadow offsets down and to the right. Beneath the word, a small script flourish in a contrasting casual brush style reads "[SUBLINE, e.g. est. 1962]".

RENDERING:
Flat enamel paint look with the slight ridges and imperfections of hand-painted brush strokes, a little paint texture at the edges, and perfectly balanced spacing.

COLOR:
Three colors: a cream base, a deep red for the letters, and a navy drop shadow, with the inline in cream. Background is a plain, slightly aged painted surface.

STRICT:
Spell "[WORD]" and "[SUBLINE]" exactly; no other text. No gradients, no digital glow, no photographic scene.

OUTPUT:
One image, 3:2, high resolution.`,
  },
  {
    number: 47,
    id: "text-animation-frames",
    title: "Frame-by-frame text animation sheet",
    group: "typography",
    description: "A sprite sheet of twelve frames that animate a word appearing. Fill in the word and the motion.",
    prompt: `Create a frame-by-frame animation sheet of the word "[WORD]" with the motion "[MOTION, e.g. letters bouncing in one by one, the word writing itself in a single stroke, letters assembling from scattered pieces]".

SHEET:
Twelve frames in a 4 x 3 grid with thin gutters on a plain white background, numbered 1 to 12 in a small label in each frame's corner. Frame 1 is the empty starting state, frame 12 is the finished, fully readable word, and the ten frames between show evenly spaced steps of the motion so the sequence reads smoothly when played at 12 frames per second.

TYPOGRAPHY:
A single bold geometric sans-serif, identical in size and position in every frame so the word lands in the same place. One flat color for the type, [COLOR], on white.

STRICT:
Use exactly the word "[WORD]". Keep the letterforms identical across frames; only the motion changes. No backgrounds, no effects, no extra text beyond the frame numbers.

OUTPUT:
One image, 4:3, high resolution, crisp edges.`,
  },
  {
    number: 48,
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
  {
    number: 49,
    id: "retro-type-rebrand",
    title: "Retro typographic rebrand",
    group: "typography",
    description: "Redraws a brand's wordmark as a 1970s-style typographic identity. Replace the brand name.",
    prompt: `Redesign the wordmark of "[BRAND NAME]" as a 1970s-style typographic identity.

THE WORDMARK:
Set "[BRAND NAME]" in a custom rounded, heavy, tightly spaced letterform with the ligatures and swelling curves typical of 1970s logotypes. Letters touch or overlap where they can. One letter carries a small custom detail derived from the current logo so the lineage is clear.

SYSTEM:
Show the wordmark large at the top, then a row of three variations beneath: an outline version, a stacked two-line version, and a version inside a rounded rectangle lockup. Below that, three color chips with hex codes.

COLOR:
A warm 1970s palette of three colors (for example, burnt orange, mustard, and brown) chosen to echo the brand's current primary color.

STRICT:
Spell "[BRAND NAME]" exactly. Flat vector rendering, no gradients, no textures, no mockups, no other text.

OUTPUT:
One image, 4:5, high resolution, sharp type.`,
  },
  {
    number: 50,
    id: "swiss-poster",
    title: "Swiss typographic poster",
    group: "typography",
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
];

/** The design catalog in catalog order, which also keeps each group's entries together. */
export const DESIGN_EXAMPLES: readonly DesignExample[] = [...EXAMPLES].sort((a, b) => a.number - b.number);

export function getDesignExample(id: string): DesignExample | undefined {
  return DESIGN_EXAMPLES.find((example) => example.id === id);
}
