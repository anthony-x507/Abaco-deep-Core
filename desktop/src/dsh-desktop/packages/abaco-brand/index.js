/**
 * Host half: brand metadata available to other Host plugins (about, telemetry,
 * support URLs).
 */
export const BRAND = {
  productName: 'ABACO DEEP HARNES',
  shortName: 'Abaco',
  tagline: 'Centro de operaciones cerrajero, manos libres, sincronizado.',
  author: 'Anthony Sanchez',
  homepage: 'https://github.com/anthony-x507/Abaco-deep-Harnes',
  issues: 'https://github.com/anthony-x507/Abaco-deep-Harnes/issues',
  attribution: 'Fork of DataElement/dsh-desktop (MIT).',
}

export function apply(ctx) {
  ctx.abacoBrand = BRAND
}