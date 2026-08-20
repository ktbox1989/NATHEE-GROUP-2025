import manifest from "@/public-site/assets/gallery.json";

const canonicalOrigin = "https://natheegroup2025.com";

type ManifestItem = (typeof manifest.items)[number];

export type PublicFallbackGalleryItem = {
  id: string;
  title: string;
  caption: string | null;
  altText: string;
  categoryName: string;
  takenAt: string | null;
  location: string | null;
  thumbnailSrc: string;
  displaySrc: string;
  width: number;
  height: number;
};

function absolute(path: string): string {
  return `${canonicalOrigin}${path}`;
}

function categoryName(categoryId: string): string {
  return manifest.categories.find((category) => category.id === categoryId)?.label ?? "ผลงานจริง";
}

function toPublicItem(item: ManifestItem): PublicFallbackGalleryItem {
  return {
    id: item.id,
    title: item.title,
    caption: item.caption || null,
    altText: item.alt,
    categoryName: categoryName(item.category),
    takenAt: null,
    location: null,
    thumbnailSrc: absolute(item.thumbnailWebp || item.thumbnail),
    displaySrc: absolute(item.displayWebp || item.display),
    width: item.width,
    height: item.height,
  };
}

export function getPublicGalleryFallback(category?: string, limit = 24): PublicFallbackGalleryItem[] {
  return manifest.items
    .filter((item) => item.status === "PUBLISHED" && (!category || item.category === category))
    .sort((left, right) => Number(right.featured) - Number(left.featured) || left.order - right.order)
    .slice(0, Math.max(1, Math.min(limit, 24)))
    .map(toPublicItem);
}

export function getPublicGalleryFallbackCategories() {
  const used = new Set(manifest.items.filter((item) => item.status === "PUBLISHED").map((item) => item.category));
  return manifest.categories.filter((category) => used.has(category.id)).map((category) => ({ id: category.id, slug: category.id, name: category.label }));
}

export function getPublicMediaFallback(itemId: string): PublicFallbackGalleryItem | null {
  const item = manifest.items.find((candidate) => candidate.id === itemId && candidate.status === "PUBLISHED");
  return item ? toPublicItem(item) : null;
}
