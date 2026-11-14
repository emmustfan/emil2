import type { Metadata, MetadataRoute } from "next";
export function canIndex(
  env: { NODE_ENV?: string; SITE_INDEXING?: string } = process.env,
) {
  return env.NODE_ENV === "production" && env.SITE_INDEXING === "true";
}
export function publicMetadata(
  path: string,
  title: string,
  description?: string,
): Metadata {
  const base = new URL(process.env.APP_URL ?? "http://localhost:3000");
  const url = new URL(path, base).href;
  return {
    title,
    description,
    robots: { index: canIndex(), follow: canIndex() },
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      locale: "ru_RU",
      type: "website",
      images: [new URL("/opengraph-image", base).href],
    },
  };
}
export const privatePaths = [
  "/admin",
  "/teacher",
  "/student",
  "/cabinet",
  "/api",
  "/checkout",
  "/review",
  "/tutor",
  "/login",
  "/auth",
  "/onboarding",
  "/dev",
  "/demo",
];
export function robotsFor(base: string, index: boolean): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: index ? "/" : undefined,
      disallow: index ? privatePaths : ["/"],
    },
    sitemap: index ? new URL("/sitemap.xml", base).href : undefined,
  };
}
