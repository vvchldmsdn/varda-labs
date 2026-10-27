import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "./locale";
import type { Metadata } from "next";

export const getLocale = cache(async () => resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value));

export async function localizedMetadata(metadata: Metadata, englishTitle: string): Promise<Metadata> {
  return {...metadata, title: (await getLocale()) === "en" ? englishTitle : metadata.title};
}
