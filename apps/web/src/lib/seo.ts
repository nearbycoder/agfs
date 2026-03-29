export const SITE_NAME = "AGFS";
export const SITE_TITLE = "AGFS | AgentFilesystem";
export const SITE_URL = "https://agfs.dev";
export const DEFAULT_DESCRIPTION =
  "Private Cloudflare-native file storage for humans and AI agents. Store screenshots, logs, and artifacts, browse them in the web app, automate with the CLI, and share expiring previews.";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-card.svg`;
export const DEFAULT_OG_IMAGE_ALT = "AGFS social card with a folder mark and the tagline Private filesystem for AI agents.";
export const INDEX_ROBOTS = "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
export const NOINDEX_ROBOTS = "noindex, nofollow, noarchive, nosnippet";

type SeoOptions = {
  title: string;
  description?: string;
  path?: string;
  robots?: string;
  image?: string;
  imageAlt?: string;
  ogType?: "article" | "website";
};

export function pageTitle(section: string) {
  return `${section} | AGFS`;
}

export function buildCanonicalUrl(path = "/") {
  return new URL(path, SITE_URL).toString();
}

export function buildSeoHead(options: SeoOptions) {
  const description = options.description ?? DEFAULT_DESCRIPTION;
  const canonical = options.path ? buildCanonicalUrl(options.path) : undefined;
  const image = options.image ?? DEFAULT_OG_IMAGE;
  const imageAlt = options.imageAlt ?? DEFAULT_OG_IMAGE_ALT;
  const robots = options.robots ?? INDEX_ROBOTS;
  const ogType = options.ogType ?? "website";

  const meta = [
    { title: options.title },
    { name: "description", content: description },
    { name: "robots", content: robots },
    { name: "referrer", content: "strict-origin-when-cross-origin" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: "en_US" },
    { property: "og:type", content: ogType },
    { property: "og:title", content: options.title },
    { property: "og:description", content: description },
    ...(canonical ? [{ property: "og:url", content: canonical }] : []),
    { property: "og:image", content: image },
    { property: "og:image:alt", content: imageAlt },
    { property: "og:image:type", content: "image/svg+xml" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: options.title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: imageAlt },
  ];

  const links = canonical ? [{ rel: "canonical", href: canonical }] : [];

  return { meta, links };
}

export function buildStructuredDataMeta(structuredData: Record<string, unknown>) {
  return [{ "script:ld+json": structuredData }];
}

export const siteHeadLinks = [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "manifest", href: "/site.webmanifest" },
  { rel: "sitemap", href: "/sitemap.xml", type: "application/xml" },
];
