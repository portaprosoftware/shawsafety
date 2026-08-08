import ogImageSrc from '@images/social.png';

export const SITE = {
  title: 'Shaw Safety',
  tagline: 'Industrial Zip Ties & Hi-Vis Safety Gear',
  description:
    'Shaw Safety supplies fluorescent security zip ties and ANSI-rated hi-vis vests to intermodal hubs and fleets nationwide. UL 21S listed, DOT compliant, direct wholesale pricing, ships next business day.',
  description_short:
    'Fluorescent security zip ties and hi-vis safety vests for intermodal hubs and fleets. Direct wholesale pricing, ships next business day.',
  url: 'https://shawsafety.com',
  author: 'Shaw Safety',
};

export const SEO = {
  title: `${SITE.title}: ${SITE.tagline}`,
  description: SITE.description,
  structuredData: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    inLanguage: 'en-US',
    '@id': SITE.url,
    url: SITE.url,
    name: SITE.title,
    description: SITE.description,
    isPartOf: {
      '@type': 'WebSite',
      url: SITE.url,
      name: SITE.title,
      description: SITE.description,
    },
  },
};

export const OG = {
  locale: 'en_US',
  type: 'website',
  url: SITE.url,
  title: `${SITE.title}: Industrial Zip Ties & Hi-Vis Safety Gear`,
  description:
    'Secure every container for less. Shaw Safety stocks 11-inch fluorescent security zip ties in four high-visibility colors, plus ANSI/ISEA 107 Class 2 hi-vis vests. UL 21S listed, DOT compliant, volume pricing from $2.19 per 100-pack.',
  image: ogImageSrc,
};

/**
 * Trust marks shown under the hero. These are credential badges rather than
 * customer logos, so they stay accurate without naming specific accounts.
 */
export const trustMarks = [
  {
    label: 'Meets Intermodal Container Security Requirements',
    icon: 'container',
  },
  { label: 'UL 21S Listed', icon: 'shieldCheck' },
  { label: 'DOT Compliant Security Ties', icon: 'checkCircle' },
  { label: 'Direct Wholesale Pricing', icon: 'tag' },
  { label: 'Ships Next Business Day', icon: 'truck' },
];
